export function createModelCatalog(ctx, view, s, sdk, select, library) {
  const { el, button, api } = view
  const dialog = el('dialog', { class: 'studio-model-dialog' }), title = el('h2', {}, 'WaveSpeed 模型目录')
  const search = el('input', { type: 'search', placeholder: '搜索名称、模型 ID 或描述', 'aria-label': '搜索模型' })
  const kind = el('select', { 'aria-label': '模型输出类型' }), type = el('select', { 'aria-label': '模型任务类型' })
  kind.append(el('option', { value: '' }, '图片和视频'), el('option', { value: 'image' }, '图片'), el('option', { value: 'video' }, '视频'))
  const status = el('p', { class: 'studio-catalog-status', role: 'status' }), list = el('div', { class: 'studio-model-list studio-scroll' })
  let target, provider, offset = 0, total = 0, timer, version = 0, stopped = false
  const previous = button('上一页', () => { offset = Math.max(0, offset - 30); return load() })
  const next = button('下一页', () => { offset += 30; return load() })
  const refresh = button('刷新目录', () => { offset = 0; return load(true) })
  const favorites = el('select', { 'aria-label': '模型收藏筛选' }); favorites.append(el('option', { value: '' }, '全部模型'), el('option', { value: '1' }, '★ 我的收藏'))
  async function load(force = false) {
    const stamp = ++version
    status.textContent = '正在加载模型目录…'; previous.disabled = next.disabled = true
    try {
      const query = new URLSearchParams({ q: search.value, kind: kind.value, type: type.value, offset: String(offset), limit: '30', favorites: favorites.value, ...(force ? { refresh: '1' } : {}) })
      const result = await api('/providers/' + provider.id + '/models?' + query)
      if (stopped || stamp !== version || !dialog.open) return
      total = result.total
      const selectedType = type.value
      type.replaceChildren(el('option', { value: '' }, '所有任务类型'), ...result.types.map(value => el('option', { value }, value)))
      type.value = result.types.includes(selectedType) ? selectedType : ''
      status.textContent = `目录共 ${result.catalogTotal} 个图片、视频模型 · 匹配 ${total} 个`
      list.replaceChildren(...result.items.map(model => {
        const row = el('div', { class: 'studio-model-result' })
        const choose = button(model.label, async () => {
          choose.disabled = true
          try { await select(target, provider, model.id); dialog.close() } finally { choose.disabled = false }
        })
        choose.disabled = !model.supported; choose.title = model.unsupportedReason || '选择此模型'
        const star = button(library.isModelFavorite(provider.id, model.id) ? '★ 已收藏' : '☆ 收藏', async () => {
          star.disabled = true
          try { await library.toggleModel(provider.id, model); await load() } finally { star.disabled = false }
        }); star.setAttribute('aria-label', '收藏模型 ' + model.id); row.append(star)
        row.append(choose, el('code', {}, model.id), el('span', { class: 'studio-model-tag' }, (model.outputKind === 'video' ? '视频' : '图片') + ' · ' + model.type), el('p', {}, model.description))
        if (model.basePrice !== null) row.append(el('small', {}, `起价 $${model.basePrice} · 实际费用以 WaveSpeed 为准`))
        if (!model.supported) row.append(el('small', { class: 'studio-field-error' }, model.unsupportedReason))
        return row
      }))
      if (!result.items.length) list.append(el('p', {}, '没有匹配的图片或视频模型'))
      previous.disabled = offset === 0; next.disabled = offset + 30 >= total
    } catch (error) { if (stamp === version && !stopped) { status.textContent = error.message; list.replaceChildren(); } }
  }
  search.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; void load() }, 250) }
  kind.onchange = () => { offset = 0; type.value = ''; void load() }
  type.onchange = () => { offset = 0; void load() }
  favorites.onchange = () => { offset = 0; void load() }
  const head = el('div', { class: 'studio-dialog-head' }), filters = el('div', { class: 'studio-model-filters' }), pages = el('div', { class: 'studio-model-pages' })
  head.append(title, button('关闭', () => dialog.close())); filters.append(search, kind, type, favorites, refresh); pages.append(previous, next)
  dialog.append(head, filters, status, list, pages); view.root.append(dialog)
  dialog.onclose = () => { version++; clearTimeout(timer) }
  ctx.effect(() => () => { stopped = true; version++; clearTimeout(timer); dialog.remove() })
  return async (node, selectedProvider) => {
    await view.flush(); target = { boardId: s.boardId, nodeId: node.id }; provider = selectedProvider; offset = 0
    await library.load(); if (stopped || target.boardId !== s.boardId) return
    title.textContent = provider.label + ' 图片、视频模型目录'; dialog.showModal(); search.focus(); await load()
  }
}
