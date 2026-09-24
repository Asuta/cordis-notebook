import { markdownText } from './markdown-parser.js'
export const markdownFormat = {
  type: 'markdown', label: 'Markdown 笔记', icon: 'M↓', editor: 'markdown', editorClass: 'is-markdown',
  fields: ['markdown'], defaults: () => ({ markdown: '' }),
  normalize(data) {
    if (typeof data.markdown !== 'string' || data.markdown.length > 200000) throw new Error('Markdown 源码必须是文本且不超过 200000 字符')
    return { markdown: data.markdown }
  },
  toText: data => markdownText(data.markdown),
}
