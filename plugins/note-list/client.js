export default function(ctx, sdk) {
  const model = ctx.notebook, heading = sdk.el('div', { class: 'section-heading' }), title = sdk.el('h2'), add = sdk.el('button', { class: 'new' }, '＋ 新建')
  heading.append(title, add); sdk.mount('sidebar', heading)
  const menu = sdk.el('div', { class: 'note-create-menu', hidden: true })
  const closeMenu = () => { menu.hidden = true; add.setAttribute('aria-expanded', 'false') }
  add.setAttribute('aria-expanded', 'false')
  ctx.noteFormats.observe(ctx, () => {
    menu.replaceChildren(); closeMenu()
    for (const { type, label } of ctx.noteFormats.list()) {
      const button = sdk.el('button', { type: 'button' }, label)
      button.onclick = () => { closeMenu(); model.create(type).catch(error => sdk.toast(error.message)) }
      menu.append(button)
    }
    add.disabled = model.busy || !ctx.noteFormats.list().length
  })
  heading.append(menu)
  const filters = sdk.el('div', { class: 'list-filters' }); sdk.mount('sidebar', filters)
  sdk.provide('noteListUI', { mount(owner, name, node) {
    if (name !== 'filters') throw new Error('noteListUI 未提供扩展位：' + name)
    owner.effect(() => { filters.append(node); return () => node.remove() })
    return node
  } })
  const list = sdk.el('div', { class: 'note-list' }); sdk.mount('sidebar', list); sdk.mount('sidebar', sdk.el('div', { class: 'sidebar-footer' }, '每一个想法，都值得被留下。'))
  sdk.listen(add, 'click', () => { menu.hidden = !menu.hidden; add.setAttribute('aria-expanded', String(!menu.hidden)) })
  sdk.listen(document, 'click', event => { if (!heading.contains(event.target)) closeMenu() })
  sdk.listen(heading, 'keydown', event => { if (event.key === 'Escape') { closeMenu(); add.focus() } })
  model.observe(ctx, () => {
    title.textContent = `我的笔记 ${model.notes.length}`; add.disabled = model.busy || !ctx.noteFormats.list().length; list.replaceChildren()
    for (const note of model.visible()) {
      const button = sdk.el('button', { class: 'note-card' + (note.id === model.selected ? ' selected' : '') })
      const format = ctx.noteFormats.get(ctx.noteFormats.typeOf(note)), icon = format?.icon || (!format ? '◻' : '')
      button.append(sdk.el('div', { class: 'card-title' }, (icon ? icon + ' ' : '') + (note.pinned ? '★ ' : '') + (note.title || '无标题笔记')), sdk.el('p', { class: 'card-preview' }, note.content || '还没有内容，开始记录吧…'), sdk.el('div', { class: 'card-date' }, new Date(note.updatedAt).toLocaleDateString('zh-CN')))
      button.onclick = () => model.choose(note.id).catch(error => sdk.toast(error.message)); list.append(button)
    }
    if (!list.children.length) list.append(sdk.el('div', { class: 'no-results' }, '没有笔记，创建一篇或调整筛选。'))
  })
}
