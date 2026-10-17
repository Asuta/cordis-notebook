export function createLibraryUI(ctx, view, s, sdk) {
  const { el, button, api, safe } = view
  let data = { prompts: [], models: [], cards: [], results: [], suffixes: [], history: [] }, target, tab = 'favorites', cardFilter = 'all', stopped = false
  const history = el('dialog', { class: 'studio-library-dialog', 'aria-label': '提示词收藏与历史' })
  const promptList = el('div', { class: 'studio-prompt-list studio-scroll' }), tabs = el('div', { class: 'studio-library-tabs', role: 'tablist' })
  const editor = el('dialog', { class: 'studio-library-dialog studio-library-editor', 'aria-label': '编辑收藏' })
  const editorTitle = el('h2'), name = el('input', { 'aria-label': '收藏名称', maxLength: 120 }), content = el('textarea', { 'aria-label': '收藏提示词', maxLength: 24000, rows: 9 })
  const error = el('p', { class: 'studio-field-error', role: 'status' })
  const panel = el('section', { class: 'studio-library-panel', hidden: true, role: 'region', 'aria-label': '生成卡片收藏库' })
  const cards = el('div', { class: 'studio-saved-cards studio-scroll' })
  const cardFilters = el('div', { class: 'studio-library-tabs', role: 'tablist', 'aria-label': '收藏类型' })
  const suffixDialog = el('dialog', { class: 'studio-library-dialog', 'aria-label': '固定尾缀模板' }), suffixList = el('div', { class: 'studio-suffix-list studio-scroll' })
  let saving
  async function load() {
    const next = await api('/generation-library')
    if (!stopped) data = { prompts: [], models: [], cards: [], results: [], suffixes: [], history: [], ...next }
    return data
  }
  async function save(input) { data = await api('/generation-library', input); if (!stopped) { drawPrompts(); drawCards(); drawSuffixes() } }
  const header = (title, close) => { const head = el('div', { class: 'studio-dialog-head' }); head.append(typeof title === 'string' ? el('h2', {}, title) : title, button('关闭', close)); return head }
  function editPrompt(item) {
    saving = () => save({ kind: 'prompt', ...(item.id ? { id: item.id, updatedAt: item.updatedAt } : {}), title: name.value.trim(), prompt: content.value })
    editorTitle.textContent = item.id ? '编辑收藏提示词' : '收藏提示词'; name.value = item.title || item.prompt.trim().slice(0, 30); content.value = item.prompt; content.hidden = false; error.textContent = ''; editor.showModal(); name.focus()
  }
  function editSuffix(item = {}) {
    saving = async () => { await save({ kind: 'suffix', ...(item.id ? { id: item.id, updatedAt: item.updatedAt } : {}), title: name.value.trim(), text: content.value }); view.render() }
    editorTitle.textContent = item.id ? '编辑固定尾缀' : '新建固定尾缀'
    name.value = item.title || ''; content.value = item.text || ''; content.hidden = false; error.textContent = ''
    editor.showModal(); name.focus()
  }
  function drawSuffixes() {
    suffixList.replaceChildren(...data.suffixes.map(item => {
      const row = el('article', { class: 'studio-suffix-record' }), actions = el('div', { class: 'studio-library-actions' })
      row.append(el('strong', {}, item.title), el('p', {}, item.text))
      actions.append(button('编辑', () => editSuffix(item)), button('删除', async () => { await save({ action: 'delete', id: item.id }); view.render() }))
      row.append(actions); return row
    }))
    if (!data.suffixes.length) suffixList.append(el('p', { class: 'studio-library-empty' }, '还没有固定尾缀。新建后，它会出现在每张生成卡的提示词下方。'))
  }
  function drawPrompts() {
    for (const item of tabs.children) item.setAttribute('aria-selected', String(item.dataset.tab === tab))
    const entries = tab === 'favorites' ? data.prompts : data.history
    promptList.replaceChildren(...entries.map(item => {
      const row = el('article', { class: 'studio-prompt-record' }), actions = el('div', { class: 'studio-library-actions' })
      row.append(el('strong', {}, item.title || new Date(item.createdAt).toLocaleString()), el('p', {}, item.prompt))
      actions.append(button('使用', async () => {
        await view.flush(); const board = s.state.boards.find(board => board.id === target.boardId), node = board?.nodes.find(node => node.id === target.nodeId)
        if (!node) throw Error('生成卡片已删除')
        await view.edit([{ type: 'update', id: node.id, patch: { prompt: item.prompt } }], { targetBoard: target.boardId }); history.close()
      }, 'studio-primary'))
      if (tab === 'favorites') actions.append(button('编辑', () => editPrompt(item)), button('删除', () => save({ action: 'delete', id: item.id })))
      else actions.append(button('收藏', () => editPrompt({ prompt: item.prompt })))
      row.append(actions); return row
    }))
    if (!entries.length) promptList.append(el('p', { class: 'studio-library-empty' }, tab === 'favorites' ? '还没有收藏提示词。可以收藏当前提示词，或从历史记录中收藏。' : '还没有生成记录。只有发起生成的提示词才会出现在这里。'))
  }
  for (const [id, label] of [['favorites', '收藏'], ['history', '历史']]) {
    const tabButton = button(label, () => { tab = id; drawPrompts() }); tabButton.dataset.tab = id; tabButton.setAttribute('role', 'tab'); tabs.append(tabButton)
  }
  history.append(header('提示词收藏与历史', () => history.close()), tabs, button('收藏当前提示词', async () => {
    await view.flush(); const node = s.state.boards.find(board => board.id === target.boardId)?.nodes.find(node => node.id === target.nodeId)
    if (!node?.prompt.trim()) throw Error('请先填写提示词'); editPrompt({ prompt: node.prompt })
  }), promptList)
  const saveEditor = button('保存收藏', async () => {
    if (!name.value.trim()) { error.textContent = '请输入收藏名称'; return }
    if (!content.hidden && !content.value.trim()) { error.textContent = '请输入提示词'; return }
    saveEditor.disabled = true
    try { await saving(); if (!stopped) editor.close() } catch (failure) { error.textContent = failure.message } finally { saveEditor.disabled = false }
  }, 'studio-primary')
  editor.append(header(editorTitle, () => editor.close()), name, content, error, saveEditor)
  const dragType = 'application/x-cordis-generation-favorite'
  async function addCard(id, point) {
    await load(); const item = [...data.cards, ...data.results].find(item => item.id === id)
    if (!item) throw Error('收藏已被删除')
    await view.add('generator', { ...structuredClone(item.node), title: item.sourceTitle || item.title, ...(point || {}) })
  }
  const favoriteInfo = el('aside', { class: 'studio-favorite-info', role: 'tooltip', hidden: true })
  let favoriteInfoPinned = false, favoriteHideTimer, favoriteInfoOwner = null
  const hideFavoriteInfo = (force = false) => {
    if (favoriteInfoPinned && !force) return
    clearTimeout(favoriteHideTimer)
    favoriteInfo.hidden = true; favoriteInfoOwner = null
    if (force) favoriteInfoPinned = false
  }
  const scheduleFavoriteHide = () => {
    if (favoriteInfoPinned) return
    clearTimeout(favoriteHideTimer)
    favoriteHideTimer = setTimeout(() => hideFavoriteInfo(), 160)
  }
  function placeFavoriteInfo(anchor) {
    const rect = anchor.getBoundingClientRect(), width = Math.min(360, window.innerWidth - 24)
    const left = rect.right + 12 + width <= window.innerWidth ? rect.right + 12 : Math.max(12, rect.left - width - 12)
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - Math.min(460, window.innerHeight - 24) - 12))
    Object.assign(favoriteInfo.style, { left: Math.round(left) + 'px', top: Math.round(top) + 'px', width: Math.round(width) + 'px', maxHeight: `calc(100vh - ${Math.round(top) + 12}px)` })
  }
  function showFavoriteInfo(item, kind, asset, anchor, pinned = false) {
    clearTimeout(favoriteHideTimer)
    favoriteInfoPinned = pinned; favoriteInfoOwner = anchor
    const head = el('div', { class: 'studio-favorite-info-head' })
    const close = button('×', () => hideFavoriteInfo(true), 'studio-favorite-info-close')
    close.setAttribute('aria-label', '关闭参数信息')
    head.append(el('strong', {}, item.title), el('span', {}, kind === 'result' ? '生成结果' : '参数卡'), close)
    const meta = el('small', {}, (asset && kind === 'result' ? `${asset.kind === 'video' ? '视频' : '图片'} · ${asset.width || '?'} × ${asset.height || '?'}` + (asset.kind === 'video' ? ` · ${Number(asset.duration || 0).toFixed(1)} 秒` : '') + ' · ' : '') + (item.node.model || item.node.provider || '默认生成服务'))
    const prompt = el('p', { class: 'studio-favorite-info-prompt' }, item.node.prompt || item.node.textReferences?.map(ref => ref.text).join('\n') || '无提示词')
    const params = item.node.modelParameters && Object.keys(item.node.modelParameters).length
      ? Object.entries(item.node.modelParameters).map(([model, values]) => model + '\n' + JSON.stringify(values, null, 2)).join('\n\n')
      : JSON.stringify({ ratio: item.node.ratio, resolution: item.node.resolution }, null, 2)
    const info = el('div', { class: 'studio-favorite-info-params' })
    info.append(el('span', {}, '生成参数'), el('pre', {}, params))
    const references = el('small', {}, `参考素材 ${item.node.references?.length || 0} 份 · 文字输入 ${item.node.textReferences?.length || 0} 份`)
    favoriteInfo.replaceChildren(head, meta, prompt, info, references)
    favoriteInfo.hidden = false
    placeFavoriteInfo(anchor)
  }
  favoriteInfo.onpointerenter = () => clearTimeout(favoriteHideTimer)
  favoriteInfo.onpointerleave = () => scheduleFavoriteHide()
  function drawCards() {
    hideFavoriteInfo(true)
    for (const item of cardFilters.children) item.setAttribute('aria-selected', String(item.dataset.filter === cardFilter))
    const entries = [
      ...data.results.map(item => ({ item, kind: 'result' })),
      ...data.cards.map(item => ({ item, kind: 'card' })),
    ].filter(entry => cardFilter === 'all' || cardFilter === entry.kind)
    cards.replaceChildren(...entries.map(({ item, kind }) => {
      const row = el('article', { class: 'studio-saved-card is-' + kind, draggable: true }), actions = el('div', { class: 'studio-library-actions' })
      row.dataset.favorite = item.id
      row.tabIndex = 0
      const asset = kind === 'result' ? s.state.assets[item.assetId] : null
      if (kind === 'result') {
        const preview = el('div', { class: 'studio-result-favorite-preview is-' + (asset?.kind === 'video' ? 'video' : 'image') })
        if (asset) {
          preview.append(el(asset.kind === 'video' ? 'video' : 'img', asset.kind === 'video' ? { src: s.mediaUrl(asset) + '#t=0.1', muted: true, playsInline: true, preload: 'metadata' } : { src: s.mediaUrl(asset), alt: item.title, loading: 'lazy' }))
          if (asset.kind === 'video') preview.append(el('span', { class: 'studio-result-play', 'aria-hidden': 'true' }, '▶'))
          preview.append(el('span', { class: 'studio-result-favorite-kind' }, asset.kind === 'video' ? '▷ 视频' : '▧ 图片'))
        } else preview.append(el('span', { class: 'studio-result-missing' }, '结果素材不可用'))
        row.append(preview)
      }
      const copy = el('div', { class: 'studio-favorite-copy' })
      copy.append(el('strong', {}, item.title), el('small', {}, kind === 'result' ? `生成结果 · ${item.node.model || item.node.provider || '默认生成服务'}` : item.node.model || item.node.provider || '默认生成服务'))
      if (kind === 'card') copy.append(el('p', { class: 'studio-favorite-prompt' }, item.node.prompt || item.node.textReferences?.map(ref => ref.text).join('\n') || '无提示词'))
      row.append(copy)
      actions.append(button(kind === 'result' ? '添加参数卡' : '添加到画布', () => addCard(item.id), 'studio-primary'), button('参数信息', () => showFavoriteInfo(item, kind, asset, row, true)), button('删除', () => save({ action: 'delete', id: item.id }))); row.append(actions)
      row.onpointerenter = () => showFavoriteInfo(item, kind, asset, row)
      row.onpointerleave = () => scheduleFavoriteHide()
      row.onfocusin = () => showFavoriteInfo(item, kind, asset, row)
      row.onfocusout = () => scheduleFavoriteHide()
      row.ondragstart = event => { event.dataTransfer.setData(dragType, item.id); event.dataTransfer.effectAllowed = 'copy' }
      return row
    }))
    if (!entries.length) cards.append(el('p', { class: 'studio-library-empty' }, cardFilter === 'result' ? '还没有结果收藏。点击生成图片或视频标题栏的 ☆ 收藏结果和生成参数。' : cardFilter === 'card' ? '还没有参数卡收藏。点击生成卡片标题栏的 ☆ 收藏。' : '还没有收藏。可以收藏生成卡片，或收藏生成结果和对应参数。'))
  }
  for (const [id, label] of [['all', '全部'], ['card', '参数卡'], ['result', '结果']]) {
    const choice = button(label, () => { cardFilter = id; drawCards() })
    choice.dataset.filter = id; choice.setAttribute('role', 'tab'); cardFilters.append(choice)
  }
  panel.append(header('生成收藏库', () => { panel.hidden = true; hideFavoriteInfo(true) }), el('small', {}, '点击添加，或把收藏拖到画布'), cardFilters, cards)
  const openSuffixManager = async () => {
    await load(); if (stopped) return
    drawSuffixes()
    if (!suffixDialog.open) suffixDialog.showModal()
  }
  suffixDialog.append(
    header('固定尾缀模板', () => suffixDialog.close()),
    el('p', { class: 'studio-library-empty' }, '模板会出现在生成卡的提示词下方；每张卡片可以独立选择是否启用。'),
    button('＋ 新建固定尾缀', () => editSuffix(), 'studio-primary'),
    suffixList,
  )
  function suffixBar(node) {
    const wrap = el('div', { class: 'studio-prompt-suffixes', 'aria-label': '固定尾缀' })
    const snapshots = node.promptSuffixes || [], known = new Set(snapshots.map(item => item.id))
    const entries = [
      ...snapshots,
      ...data.suffixes.filter(item => !known.has(item.id)).map(item => ({ ...item, enabled: false, template: true })),
    ]
    for (const entry of entries) {
      const suffix = button(entry.title, safe(async () => {
        await view.flush()
        const board = s.state.boards.find(board => board.id === s.boardId), current = board?.nodes.find(item => item.id === node.id)
        if (!current) throw Error('生成卡片已删除')
        const values = structuredClone(current.promptSuffixes || []), index = values.findIndex(item => item.id === entry.id)
        if (index >= 0) values[index] = { ...values[index], enabled: !values[index].enabled }
        else values.push({ id: entry.id, title: entry.title, text: entry.text, enabled: true })
        await view.edit([{ type: 'update', id: node.id, patch: { promptSuffixes: values } }])
      }), 'studio-prompt-suffix')
      suffix.classList.toggle('is-active', !!entry.enabled)
      suffix.setAttribute('aria-pressed', String(!!entry.enabled))
      suffix.title = entry.enabled ? '点击后本次生成不再追加此尾缀' : '点击后在提示词末尾追加此尾缀'
      wrap.append(suffix)
    }
    wrap.append(button('管理尾缀', openSuffixManager, 'studio-suffix-manage'))
    return wrap
  }
  async function toggleResult(node) {
    await load()
    const existing = data.results.find(item => item.assetId === node.assetId)
    if (existing) { await save({ action: 'delete', id: existing.id }); return false }
    await view.flush()
    const board = s.state.boards.find(board => board.id === s.boardId)
    await save({ kind: 'result', title: node.title, boardId: board.id, nodeId: node.id, revision: board.revision })
    return true
  }
  function decorateResult(node, card) {
    if (!node.sourceNodeId || !node.assetId) return
    const favorite = data.results.find(item => item.assetId === node.assetId)
    const star = button(favorite ? '★' : '☆', safe(async () => { await toggleResult(node); view.render() }), 'studio-favorite-result')
    star.setAttribute('aria-label', favorite ? '取消收藏生成结果' : '收藏生成结果和参数')
    star.title = favorite ? '取消收藏结果' : '收藏结果与生成参数'
    card.querySelector('.studio-card-head')?.append(star)
    if (!favorite) return
    const drag = el('button', { type: 'button', class: 'studio-result-parameter', draggable: true, title: '拖到画布创建使用相同参数的生成卡片' }, '✦ 参数卡')
    drag.setAttribute('aria-label', '拖出生成参数卡')
    drag.ondragstart = event => { event.stopPropagation(); event.dataTransfer.setData(dragType, favorite.id); event.dataTransfer.effectAllowed = 'copy' }
    drag.onclick = safe(async event => {
      event.stopPropagation(); await load(); const item = data.results.find(item => item.id === favorite.id)
      if (item) await addCard(item.id, { x: Math.max(-100000, Math.min(100000, node.x + 320)), y: Math.max(-100000, Math.min(100000, node.y)) })
    })
    card.querySelector('.studio-image-foot')?.append(drag)
  }
  view.extend(ctx, 'generation-result-favorites', { refresh() {}, card: decorateResult })
  const openCards = async () => { await load(); if (!stopped) { drawCards(); hideFavoriteInfo(true); panel.hidden = false } }
  const libraryButton = button('★ 生成卡片收藏', openCards, 'studio-library-entry'); view.side.insertBefore(libraryButton, view.assetPanel)
  view.menu(ctx, { id: 'generator-library', label: '★ 卡片收藏', order: 35, run: openCards })
  sdk.listen(view.stage, 'dragover', event => { if ([...event.dataTransfer.types].includes(dragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } })
  sdk.listen(view.stage, 'drop', safe(async event => {
    const id = event.dataTransfer.getData(dragType); if (!id) return
    event.preventDefault(); event.stopPropagation(); const point = view.coordinates(event); await addCard(id, { x: Math.max(-100000, Math.min(100000, Math.round(point.x))), y: Math.max(-100000, Math.min(100000, Math.round(point.y))) })
  }))
  view.root.append(history, editor, panel, suffixDialog, favoriteInfo)
  ctx.effect(() => () => { stopped = true; clearTimeout(favoriteHideTimer); history.remove(); editor.remove(); panel.remove(); suffixDialog.remove(); favoriteInfo.remove(); libraryButton.remove() })
  void load().then(() => { if (!stopped) view.render() }).catch(error => { if (!stopped) sdk.toast(error.message) })
  return {
    load,
    suffixBar,
    isResultFavorite: assetId => data.results.some(item => item.assetId === assetId),
    toggleResult,
    isModelFavorite: (provider, model) => data.models.some(item => item.provider === provider && item.model === model),
    async toggleModel(provider, model) {
      const existing = data.models.find(item => item.provider === provider && item.model === model.id)
      await save(existing ? { action: 'delete', id: existing.id } : { kind: 'model', provider, model: model.id, title: model.label.slice(0, 120) })
    },
    async prompts(node) { await view.flush(); const boardId = s.boardId; await load(); if (stopped || boardId !== s.boardId) return; target = { boardId, nodeId: node.id }; drawPrompts(); history.showModal() },
    async favoriteCard(node) {
      await view.flush(); const boardId = s.boardId
      saving = async () => {
        const board = s.state.boards.find(board => board.id === boardId)
        await save({ kind: 'card', title: name.value.trim(), boardId, nodeId: node.id, revision: board.revision })
      }
      editorTitle.textContent = '收藏生成卡片'; name.value = node.title; content.hidden = true; error.textContent = ''; editor.showModal(); name.focus(); name.select()
    },
  }
}
