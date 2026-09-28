import { mountPlainEditor } from './view.jsx'
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'plain-editor' })
  ctx.editorHost.register(ctx, 'plain', root)
  mountPlainEditor(ctx, root)
  sdk.agent?.selection(root, () => {
    const input = root.querySelector('textarea'), note = ctx.notebook.current()
    if (!input || input.selectionStart === input.selectionEnd || !note) return null
    const start = input.selectionStart, end = input.selectionEnd, value = input.value
    return { text: value.slice(start, end), label: note.title || '笔记选区', noteId: note.id, apply(text) {
      if (!input.isConnected || ctx.notebook.current()?.id !== note.id || ctx.notebook.current()?.content !== note.content || input.value !== value || ctx.notebook.busy || !ctx.notebook.editable) throw Error('笔记或选区已变化，请重新添加')
      input.focus(); input.setSelectionRange(start, end)
      if (!document.execCommand('insertText', false, text)) throw Error('当前编辑器不支持保留撤销的替换')
      ctx.notebook.edit({ content: input.value })
      return ctx.notebook.flush().then(() => ({ updated: true }))
    } }
  })
}
