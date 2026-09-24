export default function(ctx, sdk) {
  const model = ctx.notebook
  const content = sdk.el('textarea', { id: 'content', placeholder: '写下此刻的想法…', maxLength: 200000, spellcheck: false, 'aria-label': '笔记正文' })
  ctx.editorHost.register(ctx, 'plain', content)
  sdk.listen(content, 'input', () => model.edit({ content: content.value }))
  model.observe(ctx, () => {
    const note = model.current(); content.disabled = model.busy || !model.editable
    if (ctx.noteFormats.typeOf(note) === 'plain' && content.value !== (note?.content || '')) content.value = note?.content || ''
  })
}
