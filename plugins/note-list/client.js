import { mountNoteList } from './view.bundle.js'
export default function (ctx, sdk) {
  const root = sdk.el('div', { class: 'note-navigation' }),
    filters = sdk.el('div', { class: 'list-filters' })
  sdk.mount('sidebar', root)
  sdk.provide('noteListUI', {
    mount(owner, name, node) {
      if (name !== 'filters') throw new Error('noteListUI 未提供扩展位：' + name)
      owner.effect(() => {
        filters.append(node)
        return () => node.remove()
      })
      return node
    }
  })
  mountNoteList(ctx, sdk, root, filters)
}
