export function mountPlainEditor(ctx, root) {
  const { h, useObserve } = ctx.ui
  function PlainEditor() {
    const model = useObserve(ctx, ctx.notebook),
      note = model.current()
    return (
      <textarea
        key={note?.id}
        id="content"
        aria-label="笔记正文"
        placeholder="写下此刻的想法…"
        maxLength={200000}
        spellCheck={false}
        value={ctx.noteFormats.typeOf(note) === 'plain' ? note?.content || '' : ''}
        disabled={model.busy || !model.editable}
        onChange={(e) => model.edit({ content: e.target.value })}
      />
    )
  }
  ctx.ui.mount(ctx, root, <PlainEditor />)
}
