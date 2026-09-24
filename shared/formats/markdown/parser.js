import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
// Task markers are generated tokens, never user-supplied HTML.
md.core.ruler.after('inline', 'task-markers', state => {
  for (let i = 2; i < state.tokens.length; i++) {
    const token = state.tokens[i], first = token.children?.[0]
    if (token.type !== 'inline' || state.tokens[i - 2].type !== 'list_item_open' || first?.type !== 'text') continue
    const match = /^\[([ xX])\]\s+/.exec(first.content)
    if (!match) continue
    first.content = first.content.slice(match[0].length)
    const checkbox = new state.Token('task_checkbox', 'input', 0)
    checkbox.meta = { checked: match[1] !== ' ' }; token.children.unshift(checkbox)
  }
})
md.renderer.rules.task_checkbox = (tokens, index) => `<input type="checkbox" disabled${tokens[index].meta.checked ? ' checked' : ''} aria-label="任务状态"> `
const renderLink = md.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options))
md.renderer.rules.link_open = (tokens, index, ...rest) => {
  tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer')
  return renderLink(tokens, index, ...rest)
}
const renderImage = md.renderer.rules.image
md.renderer.rules.image = (tokens, index, ...rest) => {
  tokens[index].attrSet('loading', 'lazy'); tokens[index].attrSet('referrerpolicy', 'no-referrer')
  return renderImage(tokens, index, ...rest)
}
let previous, parsed, environment
function parse(source) {
  if (source !== previous) { environment = {}; parsed = md.parse(source, environment); previous = source }
  return parsed
}
export const renderMarkdown = source => md.renderer.render(parse(source), md.options, environment)
function text(tokens) {
  return tokens.map(token => {
    if (token.type === 'task_checkbox') return token.meta.checked ? '☑ ' : '☐ '
    if (token.children) return text(token.children)
    if (['text', 'code_inline', 'code_block', 'fence'].includes(token.type)) return token.content
    if (['softbreak', 'hardbreak', 'paragraph_close', 'heading_close', 'tr_close', 'hr'].includes(token.type)) return '\n'
    if (['td_close', 'th_close'].includes(token.type)) return '\t'
    return ''
  }).join('')
}
export const markdownText = source => text(parse(source)).trim()
