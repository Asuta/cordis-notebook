import { provideMounts } from './ui-slots.js'
export default function(ctx, sdk) {
  const model = ctx.notebook, heading = sdk.el('div', { class: 'section-heading' }), title = sdk.el('h2'), add = sdk.el('button', { class: 'new' }, '＋ 新建')
  heading.append(title, add); sdk.mount('sidebar', heading)
  const filters = sdk.el('div', { class: 'list-filters' }); sdk.mount('sidebar', filters)
  provideMounts(sdk, 'noteListUI', { filters })
  const list = sdk.el('div', { class: 'note-list' }); sdk.mount('sidebar', list); sdk.mount('sidebar', sdk.el('div', { class: 'sidebar-footer' }, '每一个想法，都值得被留下。'))
  sdk.listen(add, 'click', () => model.create().catch(error => sdk.toast(error.message)))
  model.observe(ctx, () => {
    title.textContent = `我的笔记 ${model.notes.length}`; add.disabled = model.busy; list.replaceChildren()
    for (const note of model.visible()) {
      const button = sdk.el('button', { class: 'note-card' + (note.id === model.selected ? ' selected' : '') })
      button.append(sdk.el('div', { class: 'card-title' }, (note.pinned ? '★ ' : '') + (note.title || '无标题笔记')), sdk.el('p', { class: 'card-preview' }, note.content || '还没有内容，开始记录吧…'), sdk.el('div', { class: 'card-date' }, new Date(note.updatedAt).toLocaleDateString('zh-CN')))
      button.onclick = () => model.choose(note.id).catch(error => sdk.toast(error.message)); list.append(button)
    }
    if (!list.children.length) list.append(sdk.el('div', { class: 'no-results' }, '没有笔记，创建一篇或调整筛选。'))
  })
}
