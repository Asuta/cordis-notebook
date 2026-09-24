import { mountPlainEditor } from './view.bundle.js'
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'plain-editor' })
  ctx.editorHost.register(ctx, 'plain', root)
  mountPlainEditor(ctx, root)
}
