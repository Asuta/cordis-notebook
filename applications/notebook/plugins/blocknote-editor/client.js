import { mountBlockNote } from './view.jsx'
import { convertLegacy } from './migration.js'
import { createSchema } from './schema.jsx'
import { createIO } from './io.js'
export default function(ctx, sdk) {
  const controller = new AbortController()
  ctx.effect(() => () => controller.abort())
  sdk = { ...sdk, signal: controller.signal }
  const root = sdk.el('div', { class: 'blocknote-editor' })
  ctx.editorHost.register(ctx, 'blocknote', root)
  const schema = createSchema(ctx, sdk), io = sdk.provide('blockNoteIO', createIO(ctx, schema))
  mountBlockNote(ctx, sdk, root, schema)
  const copy = sdk.el('button', { type: 'button', 'aria-label': '复制为 BlockNote 页面' }, '复制为 BlockNote')
  copy.dataset.menuLabel = '复制为 BlockNote 页面'
  sdk.mount('toolbar', copy)
  let copying = false
  const refresh = () => {
    copy.hidden = !['block', 'markdown'].includes(ctx.notebook.current()?.type)
    copy.disabled = copying || ctx.notebook.busy || !ctx.notebook.editable || ctx.notebook.conflict
  }
  ctx.notebook.observe(ctx, refresh)
  sdk.listen(copy, 'click', async () => {
    if (copy.disabled || copy.hidden) return
    copying = true; refresh()
    try {
      const original = ctx.notebook.current()
      const { document, warnings } = original.type === 'markdown' ? { document: io.parse('markdown', original.markdown), warnings: ['Markdown 按可表示的块结构复制'] } : convertLegacy(original.document)
      ctx.blockNoteDocument.normalize(document)
      await ctx.notebook.create('blocknote', { title: (original.title || '无标题笔记').slice(0, 180) + '（BlockNote 副本）', document, parentId: original.parentId ?? null })
      if (sdk.signal.aborted) return
      sdk.toast(warnings.length ? '已创建副本，原笔记保留。' + warnings.join('；') : '已创建 BlockNote 副本，原笔记保留。')
    } catch (error) { sdk.toast(error.message) }
    finally { copying = false; refresh() }
  })
}
