import { renderMarkdown } from './markdown.js'
const node = (tag, className, text) => { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element }
const statusNames = { running: '进行中', done: '完成', error: '失败', stopped: '已停止' }
export const duration = (start, end = Date.now()) => `${Math.max(0, Math.floor((end - start) / 1000))} 秒`
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
  const element = node('section', 'turn'), header = node('div', 'turn-header'), label = node('strong'), meta = node('span'), list = node('div', 'trace-list')
  header.append(label, meta); element.append(header, list)
  element._parts = { header, label, meta, list, events: new Map() }
  return element
}
export function updateTurn(element, turn) {
  const { label, meta, list, events } = element._parts
  element.dataset.status = turn.status
  label.textContent = `${turn.mode === 'compact' ? '上下文压缩' : 'Agent'} · ${statusNames[turn.status] || turn.status} ${duration(turn.startedAt, turn.endedAt)}`
  meta.textContent = `${turn.model?.includes('flash') ? 'Flash' : 'Pro'} · ${turn.effort === 'off' ? '思考关闭' : (turn.effort || 'high').toUpperCase()}`
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
