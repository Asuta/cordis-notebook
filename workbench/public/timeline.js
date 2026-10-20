import { renderMarkdown } from './markdown.js'
const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element }
const setText = (element, value) => { value = String(value ?? ''); if (element.textContent !== value) element.textContent = value }
const setData = (element, key, value) => { value = String(value ?? ''); if (element.dataset[key] !== value) element.dataset[key] = value }
const setHidden = (element, value) => { value = !!value; if (element.hidden !== value) element.hidden = value }
const statusNames = { queued: '排队中', running: '进行中', done: '完成', error: '失败', stopped: '已停止' }
export const duration = (start, end = Date.now()) => { const seconds = Math.max(0, Math.floor(((end || Date.now()) - start) / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒` }
function modelTiming(event) {
  const timing = event.timing || {}, parts = [], seconds = ms => (ms / 1000).toFixed(1) + ' 秒'
  if (Number.isFinite(timing.preparationMs)) parts.push('请求准备 ' + seconds(timing.preparationMs))
  if (Number.isFinite(timing.responseWaitMs)) parts.push('响应头等待 ' + seconds(timing.responseWaitMs))
  if (Number.isFinite(timing.waitMs)) parts.push('首段等待 ' + seconds(timing.waitMs))
  else if (event.status === 'running' && Number.isFinite(timing.requestStartedAt)) parts.push('等待首段 ' + seconds(Math.max(0, Date.now() - timing.requestStartedAt)))
  if (Number.isFinite(timing.streamingMs)) parts.push('持续输出 ' + seconds(timing.streamingMs))
  else if (event.status === 'running' && Number.isFinite(timing.firstOutputAt)) parts.push('持续输出 ' + seconds(Math.max(0, Date.now() - timing.firstOutputAt)))
  return parts.length ? parts.join(' · ') + '\n首段指首次收到思考、正文或工具参数。等待包含网络、服务排队等时间，无法据此认定为模型思考；响应头等待包含在首段等待中。' : ''
}
export function markdownInto(element, text) {
  if (element._text === text) return
  element._text = text
  element.innerHTML = renderMarkdown(text)
  for (const pre of element.querySelectorAll('pre')) {
    const copy = node('button', 'copy-code', '复制'); copy.type = 'button'; copy.setAttribute('aria-label', '复制代码')
    copy.onclick = async () => { try { await navigator.clipboard.writeText(pre.querySelector('code').textContent); copy.textContent = '已复制' } catch { copy.textContent = '复制失败' } }
    pre.append(copy)
  }
}
export function createMessage(message) {
  const element = node('article', 'message ' + message.role)
  element.append(node('span', 'role', message.role === 'user' ? 'YOU' : message.role === 'assistant' ? 'AGENT' : '工作台'))
  for (const quote of message.attachments || []) element.append(node('div', 'quote', quote.label + '\n' + quote.text))
  if (message.images?.length) {
    const grid = node('div', 'message-images')
    for (const image of message.images) { const link = node('a'), img = node('img'); link.href = img.src = '/api/images/' + image.id; link.target = '_blank'; link.rel = 'noopener'; img.alt = `附件图片 ${image.width} × ${image.height}`; img.loading = 'lazy'; link.append(img); grid.append(link) }
    element.append(grid)
  }
  const text = node('div', 'text'); element.append(text)
  if (message.role === 'assistant') { text.classList.add('markdown'); markdownInto(text, message.text) } else text.textContent = message.text
  return element
}
export function createTurn() {
  const element = node('section', 'turn'), header = node('button', 'turn-header'), label = node('span'), meta = node('span', 'turn-meta'), list = node('div', 'trace-list')
  const disclosure = node('div', 'turn-disclosure'), inner = node('div', 'turn-process'), answer = node('div', 'turn-answer markdown'), notice = node('p', 'turn-notice')
  header.type = 'button'; header.setAttribute('aria-expanded', 'false')
  inner.id = 'process-' + crypto.randomUUID(); header.setAttribute('aria-controls', inner.id); inner.inert = true; inner.setAttribute('aria-hidden', 'true')
  const browserReport = node('details', 'browser-report')
  inner.append(list); disclosure.append(inner); header.append(label, meta); element.append(header, disclosure, notice, answer, browserReport)
  header.onclick = () => {
    const open = header.getAttribute('aria-expanded') !== 'true'
    header.setAttribute('aria-expanded', String(open)); element.classList.toggle('process-open', open)
    inner.inert = !open; inner.setAttribute('aria-hidden', String(!open))
    if (open) element._refresh?.()
    element.dispatchEvent(new CustomEvent('process-toggle', { bubbles: true }))
  }
  element._parts = { header, label, meta, list, answer, notice, browserReport, events: new Map() }
  return element
}

// Old records have no message IDs. Match the last completed assistant message
// against trailing text blocks instead of mistaking a tool preamble for a reply.
export function finalAnswer(turn, messages = []) {
  if (turn.status !== 'done') return null
  if (turn.finalAnswer) return turn.finalAnswer
  if (turn.presentationVersion) return null
  const textEvents = turn.events || [], last = textEvents.at(-1)
  if (last?.kind !== 'text') return null
  const message = messages.filter(m => m.role === 'assistant' && m.turnId === turn.id).at(-1)
  if (!message) return { text: last.text || '', eventIds: [last.id] }
  const ids = [], parts = []
  for (let i = textEvents.length - 1; i >= 0 && textEvents[i].kind === 'text'; i--) {
    ids.unshift(textEvents[i].id); parts.unshift(textEvents[i].text || '')
    if (parts.join('').trim() === message.text.trim()) return { text: message.text, eventIds: ids }
  }
  return null
}
export function updateTurn(element, turn, options = {}) {
  const { messages = [], commands = [], onTerminate } = options
  element._refresh = () => updateTurn(element, turn, options)
  updateBrowserReport(element._parts.browserReport, turn.browserVerification)
  const { label, meta, list, events, answer, notice } = element._parts
  setData(element, 'status', turn.status)
  const tools = turn.events.filter(event => event.kind === 'tool').length
  setText(label, `${turn.status === 'done' ? '用时' : statusNames[turn.status] || turn.status} ${duration(turn.startedAt, turn.endedAt)}${tools ? ` · ${tools} 次工具调用` : ''}`)
  setText(meta, `${turn.model === 'deepseek-flash' ? 'Flash' : turn.model || '模型未记录'} · ${turn.effort === 'off' ? '思考关闭' : (turn.effort || 'high').toUpperCase()}`)
  const final = finalAnswer(turn, messages)
  let visible = final
  if (turn.status === 'running') {
    const last = [...turn.events].reverse().find(e => e.kind === 'text')
    const current = turn.currentMessageId ? turn.events.filter(e => e.kind === 'text' && e.messageId === turn.currentMessageId) : last ? [last] : []
    visible = current.length ? { text: current.map(e => e.text || '').join(''), eventIds: current.map(e => e.id) } : null
  }
  setHidden(answer, !visible?.text); if (!answer.hidden) markdownInto(answer, visible.text)
  setHidden(notice, turn.status === 'done' && !!visible?.text && !final?.truncated)
  setData(notice, 'status', turn.status)
  setText(notice, turn.status === 'running' ? (turn.events.filter(e => e.status === 'running' && e.kind !== 'text').at(-1)?.name || '正在处理…')
    : turn.status === 'error' ? '本轮执行失败，展开过程查看原因。'
    : turn.status === 'stopped' ? '本轮已停止，已完成的操作和输出保留在执行过程中。'
    : final?.truncated ? '已达到单次输出长度限制，回复可能不完整。可以发送“继续”获取后续内容。'
    : turn.mode === 'compact' ? (turn.events.findLast(event => event.kind === 'compaction' && event.status === 'done')?.output || '上下文压缩已完成，展开查看详情。') : '本轮已结束，没有最终文字答复。')
  // Trace rows are expensive to build and update. Keep a closed process panel
  // to its summary; the header's refresh callback creates rows on first open.
  if (!element.classList.contains('process-open')) return
  const commandRows = updateCommands(element, commands, onTerminate)
  const commandsById = new Map(commands.map(command => [command.session_id, command]))
  const linked = new Set(), entries = [], visibleEvents = new Set()
  const outside = new Set(visible?.eventIds || [])
  for (const event of turn.events) {
    // Tool results provide the exact session link, including for older histories.
    // Polling calls keep their own place; only the launch is replaced by its live card.
    if (event.kind === 'tool' && ['exec_command', 'workspace_build', 'workspace_test'].includes(event.name)) {
      let sessionId
      try { sessionId = JSON.parse(event.output).session_id } catch {}
      if (commandsById.has(sessionId) && !linked.has(sessionId)) {
        linked.add(sessionId)
        entries.push({ row: commandRows.get(sessionId), at: event.startedAt ?? turn.startedAt ?? 0 })
        continue
      }
    }
    visibleEvents.add(event.id)
    let row = events.get(event.id)
    if (!row) {
      if (event.kind === 'text') row = node('div', 'trace-text markdown')
      else {
        row = node('details', 'trace-event'); const summary = node('summary'), icon = node('span', 'trace-icon'), title = node('span', 'trace-title'), state = node('span', 'trace-state')
        summary.append(icon, title, state)
        const content = node('div', 'trace-content'), input = node('pre', 'trace-input'), output = node('pre', 'trace-output'), prose = node('div', 'markdown')
        content.append(input, output, prose); row.append(summary, content)
        row._parts = { icon, title, state, input, output, prose }
      }
      events.set(event.id, row)
    }
    entries.push({ row, at: event.startedAt ?? turn.startedAt ?? 0 })
    setData(row, 'status', event.status)
    setHidden(row, outside.has(event.id))
    if (event.kind === 'text') markdownInto(row, (event.text || '') + (event.truncated ? '\n\n*界面记录已截断，完整记录保存在 Pi 会话中。*' : ''))
    else {
      const p = row._parts
      setText(p.icon, event.status === 'running' ? '◌' : event.status === 'error' ? '!' : event.kind === 'tool' ? '⌘' : '◇')
      let subject = ''
      if (event.input) { try { const args = JSON.parse(event.input); subject = args.path || args.pattern || args.command || args.name || '' } catch {} }
      const title = (event.kind === 'thinking' ? '思考' : event.name || '工作台') + (subject ? ' · ' + subject : '')
      setText(p.title, title)
      if (p.title.title !== title) p.title.title = title
      setText(p.state, `${statusNames[event.status] || ''} · ${duration(event.startedAt, event.endedAt)}`)
      setHidden(p.input, !event.input); if (p.input.textContent !== (event.input || '')) p.input.textContent = event.input || ''
      setHidden(p.output, !event.output); if (p.output.textContent !== (event.output || '')) p.output.textContent = event.output || ''
      const prose = event.kind === 'model' ? modelTiming(event) : event.text || ''
      setHidden(p.prose, !prose); markdownInto(p.prose, prose + (event.truncated ? '\n\n*界面记录已截断，完整记录保存在 Pi 会话中。*' : ''))
    }
  }
  for (const [id, row] of events) if (!visibleEvents.has(id)) { row.remove(); events.delete(id) }
  // A session snapshot may arrive before its launch result. Place it by start time
  // until the exact link arrives, reusing the same DOM node and expanded state.
  for (const command of commands) if (!linked.has(command.session_id)) {
    entries.push({ row: commandRows.get(command.session_id), at: command.startedAt ?? turn.startedAt ?? 0 })
  }
  entries.sort((a, b) => a.at - b.at)
  let previous = null
  for (const { row } of entries) {
    const expected = previous ? previous.nextSibling : list.firstChild
    if (expected !== row) list.insertBefore(row, expected)
    previous = row
  }
  let waiting = list.querySelector('.trace-waiting')
  if (turn.status === 'running' && !turn.events.some(event => event.status === 'running')) {
    if (!waiting) waiting = node('div', 'trace-waiting', '◌ 等待模型响应…')
    if (list.lastChild !== waiting) list.append(waiting)
  } else waiting?.remove()
  // Do not recreate existing <details>: expansion, text selection and output
  // scroll positions stay intact across tokens, heartbeat polls and SSE updates.
}

export function updateCommands(element, commands, onTerminate) {
  element._commands ||= { rows: new Map() }
  const { rows } = element._commands
  for (const [id, row] of rows) if (!commands.some(command => command.session_id === id)) { row.remove(); rows.delete(id) }
  for (const command of commands) {
    let row = rows.get(command.session_id)
    if (!row) {
      row = node('details', 'trace-event command-session')
      const summary = node('summary'), title = node('span', 'trace-title'), state = node('span', 'trace-state')
      summary.append(title, state)
      const content = node('div', 'trace-content'), meta = node('p', 'command-meta'), output = node('pre', 'trace-output'), stop = node('button', 'command-stop', '停止命令')
      stop.type = 'button'; content.append(meta, output, stop); row.append(summary, content)
      row._parts = { title, state, meta, output, stop }; rows.set(command.session_id, row)
    }
    const p = row._parts, running = command.status === 'running'
    setData(row, 'status', running ? 'running' : command.status === 'exited' && command.exit_code !== 0 ? 'error' : 'done')
    setText(p.title, `${command.background ? '后台服务' : '命令'} · ${command.command}`); if (p.title.title !== command.command) p.title.title = command.command
    const status = { running: '运行中', exited: '已退出', terminated: '已终止', interrupted: '已中断' }[command.status] || command.status
    setText(p.state, `${status}${command.exit_code != null ? ' · 退出码 ' + command.exit_code : ''} · ${duration(command.startedAt, command.endedAt)}`)
    setText(p.meta, `${command.workdir}${command.tty ? ' · PTY' : ''}${command.truncated ? ' · 仅显示最近输出' : ''}${command.error ? '\n' + command.error : ''}`)
    if (p.output.textContent !== command.output) {
      const follow = p.output.scrollHeight - p.output.scrollTop - p.output.clientHeight < 30
      p.output.textContent = command.output || ''
      if (follow) p.output.scrollTop = p.output.scrollHeight
    }
    setHidden(p.stop, !running); setText(p.stop, command.background ? '停止服务' : '停止命令')
    p.stop.onclick = async () => {
      p.stop.disabled = true
      try { await onTerminate?.(command.session_id) } finally { p.stop.disabled = false }
    }
  }
  return rows
}
export function developmentStatus(development) {
  const round = development?.blocked || development?.saving
  const phases = { unresponsive: '尚未响应', queued: '排队中', saving: '正在保存', confirmed: '已确认', failed: '保存失败' }
  if (!round) return { label: development?.pending ? '正在处理更新' : '热更新', details: '', attention: false }
  const clients = round.clients || []
  const details = clients.map(client => `${client.application}（${client.id.slice(0, 8)}）：${phases[client.phase] || '等待保存'}，已等待 ${Math.floor((client.elapsedMs || 0) / 1000)} 秒${client.error ? '；' + client.error : ''}`).join('\n')
  return { label: round.status === 'failed' ? '热更新未完成' : `热更新等待 ${clients.filter(client => client.phase !== 'confirmed').length} 个页面确认`,
    details: [round.message, details].filter(Boolean).join('\n'), attention: !!development.blocked || round.status === 'failed' }
}

function updateBrowserReport(element, report) {
  element.hidden = !report
  const signature = JSON.stringify(report)
  if (!report || element._signature === signature) return
  element._signature = signature
  const labels = { disabled: '用户关闭，未执行', 'not-run': '已开启，本轮未调用', running: '进行中', passed: '通过', failed: '失败', incomplete: '未完成', stopped: '已停止' }
  const summary = node('summary', '', '浏览器验收 · ' + (report.previousAttempts?.length ? '最新复测' : '') + (labels[report.status] || report.status))
  const text = node('p', '', report.summary || '')
  const errors = node('pre', '', (report.errors || []).join('\n'))
  const usageErrors = (report.steps || []).filter(step => step.errorKind === 'usage').length
  const notes = node('p', '', [...(report.gaps || []), ...(usageErrors ? [`记录了 ${usageErrors} 次调用参数错误，可修正；未计为产品验收失败。`] : [])].join('；'))
  const links = node('div', 'browser-artifacts')
  for (const screenshot of (report.screenshots || []).slice(-6)) {
    if (!/^\/api\/browser-artifacts\/[a-f0-9-]{36}\/[1-9][0-9]*\.jpg$/.test(screenshot.url)) continue
    const link = node('a'), image = node('img'); link.href = image.src = screenshot.url
    link.target = '_blank'; link.rel = 'noopener'; image.alt = '浏览器验收截图'; image.loading = 'lazy'; link.append(image); links.append(link)
  }
  if (/^\/api\/browser-artifacts\/[a-f0-9-]{36}\/report\.json$/.test(report.reportUrl || '')) {
    const link = node('a', '', '查看完整验收报告'); link.href = report.reportUrl; link.target = '_blank'; link.rel = 'noopener'; links.append(link)
  }
  const history = node('div', 'browser-attempts')
  for (const [index, previous] of (report.previousAttempts || []).entries()) {
    const attempt = node('details', 'browser-attempt')
    updateBrowserReport(attempt, previous)
    attempt.querySelector('summary').textContent = '第 ' + (index + 1) + ' 次验收 · ' + (labels[previous.status] || previous.status) + '（保留原始记录）'
    history.append(attempt)
  }
  const reason = node('p', '', report.retryReason ? '复测原因：' + report.retryReason : '')
  element.replaceChildren(summary, text, errors, notes, reason, links, history)
}
