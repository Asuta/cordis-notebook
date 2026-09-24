export default function(ctx, sdk) {
  const model = ctx.notebook, button = sdk.button('toolbar', '↗ 导出', () => {
    const note = model.current(); if (!note) return
    const url = URL.createObjectURL(new Blob([`${note.title || '无标题笔记'}\n\n${note.content}`], { type: 'text/plain;charset=utf-8' })), link = sdk.el('a', { href: url, download: (note.title || '无标题笔记').replace(/[<>:"/\\|?*]/g, '_') + '.txt' }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }); button.setAttribute('aria-label', '导出文本'); model.observe(ctx, () => button.disabled = !model.current())
  const backup = sdk.button('toolbar', '导出页面 JSON', () => {
    const note = model.current(); if (!note) return
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'cordis-note', version: 1, note }, null, 2)], { type: 'application/json' }))
    const link = sdk.el('a', { href: url, download: (note.title || '笔记').replace(/[<>:"/\\|?*]/g, '_') + '.json' })
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  model.observe(ctx, () => { backup.disabled = !model.current() })
}
