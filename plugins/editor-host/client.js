import { mountEditorHost } from './view.bundle.js'
export default function (ctx, sdk) {
  const views = new Map(),
    root = sdk.el('div', { class: 'editor-host-view' }),
    content = sdk.el('div', { class: 'note-editor-body' })
  sdk.mount('editor', root)
  let refresh = () => {}
  sdk.provide('editorHost', {
    register(owner, type, node) {
      if (views.has(type)) throw new Error('此格式已有编辑器：' + type)
      return owner.effect(() => {
        views.set(type, node)
        content.append(node)
        refresh()
        return () => {
          if (views.get(type) === node) views.delete(type)
          node.remove()
          refresh()
        }
      })
    }
  })
  refresh = mountEditorHost(ctx, sdk, root, content, views)
}
