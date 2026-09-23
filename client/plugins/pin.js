export const inject = ['notebook']
export default function(ctx, sdk) {
  const model = ctx.notebook, filters = sdk.el('div', { class: 'filters' }), all = sdk.el('button', { class: 'active' }, '全部笔记'), pinned = sdk.el('button', {}, '已置顶'); filters.append(all, pinned); sdk.mount('list-filters', filters)
  sdk.listen(all, 'click', () => { model.filters.delete('pin'); all.classList.add('active'); pinned.classList.remove('active'); model.notify() })
  sdk.listen(pinned, 'click', () => { model.filters.set('pin', note => note.pinned); pinned.classList.add('active'); all.classList.remove('active'); model.notify() })
  const button = sdk.button('toolbar', '☆', async () => { if (!model.current()) return; model.edit({ pinned: !model.current().pinned }); await model.flush() }); button.setAttribute('aria-label', '置顶笔记')
  sdk.watch(model, () => { button.textContent = model.current()?.pinned ? '★' : '☆'; button.disabled = !model.current() || model.busy }); sdk.effect(() => () => { model.filters.delete('pin'); model.notify() })
}
