export default function(ctx, sdk) {
  const model = ctx.notebook, filters = sdk.el('div', { class: 'filters' }), all = sdk.el('button', { class: 'active' }, '全部笔记'), pinned = sdk.el('button', {}, '已置顶'); filters.append(all, pinned); sdk.mount('list-filters', filters)
  const filter = model.registerFilter(ctx, 'pin', () => true)
  sdk.listen(all, 'click', () => { filter.update(() => true); all.classList.add('active'); pinned.classList.remove('active') })
  sdk.listen(pinned, 'click', () => { filter.update(note => note.pinned); pinned.classList.add('active'); all.classList.remove('active') })
  const button = sdk.button('toolbar', '☆', async () => { if (!model.current()) return; model.edit({ pinned: !model.current().pinned }); await model.flush() }); button.setAttribute('aria-label', '置顶笔记')
  model.observe(ctx, () => { button.textContent = model.current()?.pinned ? '★' : '☆'; button.disabled = !model.current() || model.busy })
}
