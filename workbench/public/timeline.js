import { renderMarkdown } from './markdown.js'
const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element }
const statusNames = { running: '进行中', done: '完成', error: '失败', stopped: '已停止' }
export const duration = (start, end = Date.now()) => { const seconds = Math.max(0, Math.floor(((end || Date.now()) - start) / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒` }
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
  inner.append(list); disclosure.append(inner); header.append(label, meta); element.append(header, disclosure, notice, answer)
  header.onclick = () => {
    const open = header.getAttribute('aria-expanded') !== 'true'
    header.setAttribute('aria-expanded', String(open)); element.classList.toggle('process-open', open)
    inner.inert = !open; inner.setAttribute('aria-hidden', String(!open))
    element.dispatchEvent(new CustomEvent('process-toggle', { bubbles: true }))
  }
  element._parts = { header, label, meta, list, answer, notice, events: new Map() }
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
export function updateTurn(element, turn, messages = []) {
  const { label, meta, list, events, answer, notice } = element._parts
  element.dataset.status = turn.status
  const tools = turn.events.filter(event => event.kind === 'tool').length
  label.textContent = `${turn.status === 'done' ? '用时' : statusNames[turn.status] || turn.status} ${duration(turn.startedAt, turn.endedAt)}${tools ? ` · ${tools} 次工具调用` : ''}`
  meta.textContent = `${turn.model?.includes('flash') ? 'Flash' : 'Pro'} · ${turn.effort === 'off' ? '思考关闭' : (turn.effort || 'high').toUpperCase()}`
  const final = finalAnswer(turn, messages)
  let visible = final
  if (turn.status === 'running') {
    const last = [...turn.events].reverse().find(e => e.kind === 'text')
    const current = turn.currentMessageId ? turn.events.filter(e => e.kind === 'text' && e.messageId === turn.currentMessageId) : last ? [last] : []
    visible = current.length ? { text: current.map(e => e.text || '').join(''), eventIds: current.map(e => e.id) } : null
  }
  const outside = new Set(visible?.eventIds || [])
  answer.hidden = !visible?.text; if (!answer.hidden) markdownInto(answer, visible.text)
  notice.hidden = turn.status === 'done' && !!visible?.text && !final?.truncated
  notice.dataset.status = turn.status
  notice.textContent = turn.status === 'running' ? (turn.events.filter(e => e.status === 'running' && e.kind !== 'text').at(-1)?.name || '正在处理…')
    : turn.status === 'error' ? '本轮执行失败，展开过程查看原因。'
    : turn.status === 'stopped' ? '本轮已停止，已完成的操作和输出保留在执行过程中。'
    : final?.truncated ? '已达到单次输出长度限制，回复可能不完整。可以发送“继续”获取后续内容。'
    : turn.mode === 'compact' ? '上下文压缩已完成，展开查看详情。' : '本轮已结束，没有最终文字答复。'
  for (const event of turn.events) {
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
      events.set(event.id, row); list.append(row)
    }
    row.dataset.status = event.status
    row.hidden = outside.has(event.id)
    if (event.kind === 'text') markdownInto(row, (event.text || '') + (event.truncated ? '\n\n*界面记录已截断，完整记录保存在 Pi 会话中。*' : ''))
    else {
      const p = row._parts
      p.icon.textContent = event.status === 'running' ? '◌' : event.status === 'error' ? '!' : event.kind === 'tool' ? '⌘' : '◇'
      let subject = ''
      if (event.input) { try { const args = JSON.parse(event.input); subject = args.path || args.pattern || args.command || args.name || '' } catch {} }
      p.title.textContent = (event.kind === 'thinking' ? '思考' : event.name || '工作台') + (subject ? ' · ' + subject : '')
      p.title.title = p.title.textContent
      p.state.textContent = `${statusNames[event.status] || ''} · ${duration(event.startedAt, event.endedAt)}`
      p.input.hidden = !event.input; if (p.input.textContent !== (event.input || '')) p.input.textContent = event.input || ''
      p.output.hidden = !event.output; if (p.output.textContent !== (event.output || '')) p.output.textContent = event.output || ''
      p.prose.hidden = !event.text; markdownInto(p.prose, (event.text || '') + (event.truncated ? '\n\n*界面记录已截断，完整记录保存在 Pi 会话中。*' : ''))
    }
  }
  let waiting = list.querySelector('.trace-waiting')
  if (turn.status === 'running' && !turn.events.some(event => event.status === 'running')) {
    if (!waiting) { waiting = node('div', 'trace-waiting', '◌ 等待模型响应…'); list.append(waiting) }
  } else waiting?.remove()
  // Do not recreate existing <details>: expansion, text selection and output
  // scroll positions stay intact across tokens, heartbeat polls and SSE updates.
}
