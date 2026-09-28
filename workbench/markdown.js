import MarkdownIt from 'markdown-it'
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true })
markdown.renderer.rules.image = (tokens, index) => `<span class="image-alt">[图片：${markdown.utils.escapeHtml(tokens[index].content)}]</span>`
const linkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options))
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer')
  return linkOpen(tokens, index, options, env, renderer)
}
export function renderMarkdown(text) { return markdown.render(text || '') }
