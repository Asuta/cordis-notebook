export const createMarkdownFormat = markdown => ({
  type: 'markdown', label: 'Markdown 笔记', icon: 'FileCode2', editor: 'markdown', editorLayout: 'wide',
  fields: ['markdown'], defaults: () => ({ markdown: '' }),
  normalize(data) {
    if (typeof data.markdown !== 'string' || data.markdown.length > 200000) throw new Error('Markdown 源码必须是文本且不超过 200000 字符')
    return { markdown: data.markdown }
  },
  toText: data => markdown.toText(data.markdown),
})
