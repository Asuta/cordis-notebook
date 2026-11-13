import { el } from './ui.js'

// Text is always constructed with text nodes. Neither stories nor ruby use HTML.
export function renderText(node, line, count = Infinity) {
  const fragments = document.createDocumentFragment()
  let remaining = count
  for (const segment of line.segments || [{ text: line.text || '……' }]) {
    if (remaining <= 0) break
    const chars = Array.from(segment.text), shown = chars.slice(0, remaining).join('')
    remaining -= chars.length
    const span = el(segment.ruby ? 'ruby' : 'span', '', shown)
    if (segment.color) span.style.color = segment.color
    if (segment.bold) span.style.fontWeight = '700'
    if (segment.italic) span.style.fontStyle = 'italic'
    if (segment.ruby && shown.length === segment.text.length) span.append(el('rt', '', segment.ruby))
    fragments.append(span)
  }
  node.replaceChildren(fragments)
}
