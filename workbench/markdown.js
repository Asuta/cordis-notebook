import MarkdownIt from 'markdown-it'
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index], escape = markdown.utils.escapeHtml
  let path = token.attrGet('src') || ''
  try { path = decodeURIComponent(path) } catch { path = '' }
  const attachment = /^\/api\/images\/[a-f0-9-]{36}$/.test(path)
  const local = !path.startsWith('//') && !path.startsWith('\\\\') && (!/^[a-z][\w+.-]*:/i.test(path) || /^[a-z]:[/\\]/i.test(path) || /^file:\/\/\//i.test(path))
  const src = attachment ? path : local && /\.(png|jpe?g|webp|gif)$/i.test(path) ? '/api/workspace-image?path=' + encodeURIComponent(path) : ''
  if (!src) return `<span class="image-alt">[图片：${escape(token.content)}]</span>`
  return `<a class="chat-image" href="${escape(src)}" target="_blank" rel="noopener noreferrer"><img src="${escape(src)}" alt="${escape(token.content || '图片')}" loading="lazy" decoding="async"></a>`
}
const validateLink = markdown.validateLink.bind(markdown)
markdown.validateLink = url => /^file:\/\/\/.*\.(png|jpe?g|webp|gif)$/i.test(url) || validateLink(url)
const linkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer')
  return linkOpen(tokens, index, options, env, renderer)
}
export function renderMarkdown(text) { return markdown.render(text || '') }
