export function createLibraryUI(ctx, view, s, sdk) {
  const { el, button, api, safe } = view
  let data = { prompts: [], models: [], cards: [], history: [] }, target, tab = 'favorites', stopped = false
  const history = el('dialog', { class: 'studio-library-dialog', 'aria-label': '提示词收藏与历史' })
  const promptList = el('div', { class: 'studio-prompt-list studio-scroll' }), tabs = el('div', { class: 'studio-library-tabs', role: 'tablist' })
  const editor = el('dialog', { class: 'studio-library-dialog studio-library-editor', 'aria-label': '编辑收藏' })
  const editorTitle = el('h2'), name = el('input', { 'aria-label': '收藏名称', maxLength: 120 }), content = el('textarea', { 'aria-label': '收藏提示词', maxLength: 24000, rows: 9 })
  const error = el('p', { class: 'studio-field-error', role: 'status' })
  const panel = el('section', { class: 'studio-library-panel', hidden: true, role: 'region', 'aria-label': '生成卡片收藏库' })
  const cards = el('div', { class: 'studio-saved-cards studio-scroll' })
  let saving
  async function load() { const next = await api('/generation-library'); if (!stopped) data = next; return data }
  async function save(input) { data = await api('/generation-library', input); if (!stopped) { drawPrompts(); drawCards() } }
  const header = (title, close) => { const head = el('div', { class: 'studio-dialog-head' }); head.append(typeof title === 'string' ? el('h2', {}, title) : title, button('关闭', close)); return head }
  function editPrompt(item) {
    saving = () => save({ kind: 'prompt', ...(item.id ? { id: item.id, updatedAt: item.updatedAt } : {}), title: name.value.trim(), prompt: content.value })
    editorTitle.textContent = item.id ? '编辑收藏提示词' : '收藏提示词'; name.value = item.title || item.prompt.trim().slice(0, 30); content.value = item.prompt; content.hidden = false; error.textContent = ''; editor.showModal(); name.focus()
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
    await load(); const item = data.cards.find(item => item.id === id)
    if (!item) throw Error('收藏已被删除')
    await view.add('generator', { ...structuredClone(item.node), title: item.title, ...(point || {}) })
  }
  function drawCards() {
    cards.replaceChildren(...data.cards.map(item => {
      const row = el('article', { class: 'studio-saved-card', draggable: true }), actions = el('div', { class: 'studio-library-actions' })
      row.dataset.favorite = item.id
      row.append(el('strong', {}, item.title), el('small', {}, item.node.model || item.node.provider || '默认生成服务'), el('p', {}, item.node.prompt || item.node.textReferences?.map(ref => ref.text).join('\n') || '无提示词'))
      const parameters = el('details'), preview = el('pre', {}, JSON.stringify({ parameters: item.node.modelParameters || { ratio: item.node.ratio, resolution: item.node.resolution }, references: item.node.references?.length || 0, textInputs: item.node.textReferences?.length || 0 }, null, 2))
      parameters.append(el('summary', {}, '查看参数与引用'), preview); row.append(parameters)
      actions.append(button('添加到画布', () => addCard(item.id), 'studio-primary'), button('删除', () => save({ action: 'delete', id: item.id }))); row.append(actions)
      row.ondragstart = event => { event.dataTransfer.setData(dragType, item.id); event.dataTransfer.effectAllowed = 'copy' }
      return row
    }))
    if (!data.cards.length) cards.append(el('p', { class: 'studio-library-empty' }, '点击生成卡片标题栏的 ☆，保存提示词、参数和参考素材。收藏后可以点击添加，或拖到画布。'))
  }
  panel.append(header('生成卡片收藏库', () => { panel.hidden = true }), el('small', {}, '点击添加，或把收藏拖到画布'), cards)
  const openCards = async () => { await load(); if (!stopped) { drawCards(); panel.hidden = false } }
  const libraryButton = button('★ 生成卡片收藏', openCards); view.side.insertBefore(libraryButton, view.assetsList)
  view.menu(ctx, { id: 'generator-library', label: '★ 卡片收藏', order: 35, run: openCards })
  sdk.listen(view.stage, 'dragover', event => { if ([...event.dataTransfer.types].includes(dragType)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } })
  sdk.listen(view.stage, 'drop', safe(async event => {
    const id = event.dataTransfer.getData(dragType); if (!id) return
    event.preventDefault(); event.stopPropagation(); const point = view.coordinates(event); await addCard(id, { x: Math.max(-100000, Math.min(100000, Math.round(point.x))), y: Math.max(-100000, Math.min(100000, Math.round(point.y))) })
  }))
  view.root.append(history, editor, panel)
  ctx.effect(() => () => { stopped = true; history.remove(); editor.remove(); panel.remove(); libraryButton.remove() })
  return {
    load,
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
