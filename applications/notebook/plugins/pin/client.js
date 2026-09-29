export default function(ctx, sdk) {
  const model = ctx.notebook, filters = sdk.el('div', { class: 'filters' }), pill = sdk.el('span', { class: 'filter-pill', 'aria-hidden': 'true' }), all = sdk.el('button', { class: 'active' }, '全部笔记'), pinned = sdk.el('button', {}, '已置顶')
  filters.append(pill, all, pinned); sdk.mount('list-filters', filters)
  const filter = model.registerFilter(ctx, 'pin', () => true)
  // 胶囊跟着当前激活按钮的真实盒子走，两个标签因此可以保持各自的自然宽度。
  const syncPill = () => {
    const active = all.classList.contains('active') ? all : pinned
    const box = active.getBoundingClientRect(), base = filters.getBoundingClientRect()
    filters.style.setProperty('--filter-pill-x', box.left - base.left + 'px')
    filters.style.setProperty('--filter-pill-width', box.width + 'px')
  }
  const select = (button, predicate) => () => {
    filter.update(predicate)
    all.classList.toggle('active', button === all); pinned.classList.toggle('active', button === pinned)
    // 先切换激活态再测量，避免字重变化后胶囊落在旧位置。
    syncPill()
  }
  sdk.listen(all, 'click', select(all, () => true))
  sdk.listen(pinned, 'click', select(pinned, note => note.pinned))
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : callback => setTimeout(callback, 0)
  frame(() => { syncPill(); filters.classList.add('ready') })
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => { syncPill(); filters.classList.add('ready') })
    observer.observe(filters); ctx.effect(() => () => observer.disconnect())
  }
  sdk.listen(window, 'resize', syncPill)
  const button = sdk.button('toolbar', '☆', async () => { if (!model.current()) return; model.edit({ pinned: !model.current().pinned }); await model.flush() }); button.setAttribute('aria-label', '置顶笔记')
  button.dataset.menuLabel = '置顶 / 取消置顶'
  model.observe(ctx, () => { button.textContent = model.current()?.pinned ? '★' : '☆'; button.disabled = !model.current() || model.busy || !model.editable })
}
