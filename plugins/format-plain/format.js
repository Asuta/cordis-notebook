export const plainFormat = {
  type: 'plain', label: '普通笔记', icon: 'FileText', editor: 'plain',
  fields: ['content'], defaults: () => ({ content: '' }),
  normalize(data) {
    if (typeof data.content !== 'string') throw new Error('笔记正文必须是文本')
    return { content: data.content }
  },
  toText: data => data.content,
}
