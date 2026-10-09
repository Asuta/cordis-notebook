import { ratios, resolutions } from './model.js'
import { registerTools } from './tools.js'
import { cardBounds, fitView, arrangeCards, moveDelta, overlayPosition } from './geometry.js'

export default async function (ctx, sdk) {
  const el = sdk.el, uuid = () => crypto.randomUUID(), api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const root = el('main', { class: 'studio-app' }), side = el('aside', { class: 'studio-sidebar' }), main = el('section', { class: 'studio-main' })
  const toolbar = el('header', { class: 'studio-toolbar' }), stage = el('div', { class: 'studio-stage', tabIndex: 0, 'aria-label': '无限画布' })
  const world = el('div', { class: 'studio-world' }), cards = el('div', { class: 'studio-cards' })
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('studio-wires')
  const boardList = el('nav', { class: 'studio-boards', 'aria-label': '画板列表' }), assetsList = el('div', { class: 'studio-assets' })
  const boardTitle = el('input', { class: 'studio-board-title', 'aria-label': '画板名称', maxLength: 120 }), notice = el('span', { class: 'studio-status' }, '已保存')
  const zoomLabel = el('select', { 'aria-label': '画布缩放' }), empty = el('div', { class: 'studio-empty' })
  const contextTools = el('div', { class: 'studio-context-tools', role: 'toolbar', 'aria-label': '所选卡片工具', hidden: true })
  const bottomControls = el('div', { class: 'studio-bottom-controls' }), dock = el('div', { class: 'studio-action-dock', role: 'toolbar', 'aria-label': '画布工具' })
  const selectionBox = el('div', { class: 'studio-selection-box', hidden: true }), returnViews = new Map()
  const selected = new Set(), drafts = new Map(), undo = new Map(), redo = new Map(), renderedNodes = new Map()
  let state = await api(''), boardId = sdk.storage.local.getItem('board'), queue = Promise.resolve(), stopped = false, held = false, editing = false, drag = null, connecting = null, space = false, draftTimer, viewTimer, polling = false, epoch = 0, pendingEdits = 0, flushing, selectionSignature = ''
  const board = () => state.boards.find(b => b.id === boardId) || state.boards[0]
  boardId = board().id
  let viewport = { ...board().viewport }
  const titleDraftId = '$board'
  let renderedTitle = board().title
  const imageUrl = (id, thumb = true) => `/api/studio/images/${id}.${thumb ? 'webp' : 'png'}`
  const safe = action => async event => { try { await action(event) } catch (error) { notice.textContent = '操作未完成'; sdk.toast(error.message) } }
  const button = (text, action, cls = '') => {
    const b = el('button', { type: 'button', class: cls }, text)
    // Keep the input focused until click: blur can save and replace the button
    // between pointerdown and pointerup, losing the browser's click entirely.
    b.onpointerdown = event => { if (event.button === 0 && editing) event.preventDefault() }
    b.onclick = safe(event => { b.focus(); return action(event) })
    return b
  }
  const enqueue = action => { const task = queue.then(action); queue = task.catch(() => {}); return task }
  function rememberDrafts() {
    if (drafts.size) sdk.storage.local.setItem('drafts', JSON.stringify({ boardId, drafts: [...drafts] }))
    else sdk.storage.local.removeItem('drafts')
  }
  async function refresh() {
    if (stopped || polling || drag || drafts.size || pendingEdits) return
    const stamp = epoch
    polling = true
    try { const next = await api(''); if (stopped || stamp !== epoch || drag || drafts.size || pendingEdits) return; const changed = JSON.stringify(next) !== JSON.stringify(state); state = { ...next, assets: { ...state.assets, ...next.assets } }; if (changed && !editing) render() }
    finally { polling = false }
  }
  async function edit(operations, { expectedRevision, history = true, targetBoard = boardId } = {}) {
    pendingEdits++; epoch++
    return enqueue(async () => {
      if (stopped || held) throw Error('画布正在退出')
      const current = state.boards.find(b => b.id === targetBoard)
      const result = await api('/edit', { boardId: targetBoard, revision: expectedRevision ?? current.revision, operations })
      state.boards[state.boards.findIndex(b => b.id === targetBoard)] = result.board
      if (history) { const items = undo.get(targetBoard) || []; items.push(result.inverse); if (items.length > 40) items.shift(); undo.set(targetBoard, items); redo.set(targetBoard, []) }
      notice.textContent = '已保存'
      if (!editing && !drag) render()
      return result
    }).finally(() => { pendingEdits-- })
  }
  function draft(node, key, value) {
    let entry = drafts.get(node.id)
    if (!entry) { entry = { before: structuredClone(node), patch: {} }; drafts.set(node.id, entry) }
    entry.patch[key] = value; rememberDrafts(); notice.textContent = '正在保存…'
    clearTimeout(draftTimer); draftTimer = setTimeout(() => flush().catch(error => sdk.toast(error.message)), 450)
  }
  function flush() {
    if (flushing) return flushing
    flushing = flushDrafts().finally(() => { flushing = null })
    return flushing
  }
  async function flushDrafts() {
    clearTimeout(draftTimer)
    if (!drafts.size) { await queue; return }
    const entries = [...drafts].map(([id, entry]) => [id, structuredClone(entry)])
    await queue
    const latest = await api('')
    const current = latest.boards.find(b => b.id === boardId)
    for (const [id, entry] of entries) {
      const node = id === titleDraftId ? current : current?.nodes.find(n => n.id === id)
      if (!node || Object.keys(entry.patch).some(key => node[key] !== entry.before[key] && node[key] !== entry.patch[key])) throw Error((id === titleDraftId ? '画板名称' : '这张卡片') + '已在其他页面修改，草稿已保留；请先复制草稿再载入最新画板')
    }
    state = { ...latest, assets: { ...state.assets, ...latest.assets } }
    await edit(entries.map(([id, entry]) => id === titleDraftId ? { type: 'rename', title: entry.patch.title } : { type: 'update', id, patch: entry.patch }), { expectedRevision: current.revision })
    for (const [id, entry] of entries) {
      // Focused inputs keep their DOM and captured node. Advance only fields we
      // just saved; polling must not hide a genuine edit from another page.
      const rendered = renderedNodes.get(id)
      if (rendered) Object.assign(rendered, entry.patch)
      if (id === titleDraftId) renderedTitle = entry.patch.title
      const live = drafts.get(id)
      if (JSON.stringify(live?.patch) === JSON.stringify(entry.patch)) drafts.delete(id)
      else if (live) live.before = { ...live.before, ...entry.patch }
    }
    rememberDrafts()
    if (drafts.size) return flushDrafts()
  }
  async function choose(id) {
    await flush(); await saveViewport()
    boardId = id; sdk.storage.local.setItem('board', id); viewport = { ...board().viewport }; selected.clear(); connecting = null; render()
  }
  async function newBoard(title = '新的灵感画板') {
    await flush(); const created = await api('/boards', { title }); state.boards.push(created); await choose(created.id); return created
  }
  const position = () => {
    const point = { x: Math.round((stage.clientWidth / 2 - viewport.x) / viewport.zoom - 140), y: Math.round((stage.clientHeight / 2 - viewport.y) / viewport.zoom - 130) }
    while (board().nodes.some(n => Math.abs(n.x - point.x) < 300 && Math.abs(n.y - point.y) < 280)) point.x += 340
    return point
  }
  async function add(type, extra = {}) { await flush(); const id = uuid(); await edit([{ type: 'add', node: { id, type, ...position(), ...extra } }]); selected.clear(); selected.add(id); render(); fit(); return id }
  async function connect(from, to) { connecting = null; await flush(); await edit([{ type: 'connect', id: uuid(), from, to }]); notice.textContent = '已连接输入'; render() }
  async function generate(nodeId, expectedRevision) {
    if (expectedRevision !== undefined && (drafts.size || board().revision !== expectedRevision)) throw Error('画布已变化，请重新读取')
    await flush()
    const job = await api('/generate', { boardId, nodeId, revision: expectedRevision ?? board().revision, requestId: uuid() })
    await refresh(); return job
  }
  function rememberAsset(asset) { epoch++; state.assets[asset.id] = asset; render(); return asset }
  async function importImage(input) { return rememberAsset(await api('/import', input)) }
  async function upload(file, extra = {}) {
    if (file.size > 20 * 1024 * 1024) throw Error('图片不能超过 20 MB')
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file) })
    const targetBoard = boardId, asset = rememberAsset(await api('/upload', { name: file.name, base64: data }))
    await edit([{ type: 'add', node: { id: uuid(), type: 'image', title: file.name, assetId: asset.id, ...position(), ...extra } }], { targetBoard })
    return asset
  }
  async function historyStep(back) {
    await flush(); const source = back ? undo : redo, target = back ? redo : undo, stack = source.get(boardId) || []
    if (!stack.length) return
    const result = await edit(stack.at(-1), { history: false }); stack.pop()
    const next = target.get(boardId) || []; next.push(result.inverse); target.set(boardId, next); render()
  }
  const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true })
  fileInput.onchange = safe(async () => { for (const file of fileInput.files) await upload(file); fileInput.value = '' })
  const settings = el('dialog', { class: 'studio-dialog' }), viewer = el('dialog', { class: 'studio-viewer' })
  const viewerStage = el('div', { class: 'studio-viewer-stage', 'aria-label': '图片预览区域' }), viewerImage = el('img', { alt: '图片预览', draggable: false }), viewerZoom = el('span', { class: 'studio-viewer-zoom' }, '100%'), viewerDownload = el('a', { download: '' }, '下载原图')
  const viewerView = { zoom: 1, fit: 1, x: 0, y: 0, drag: null }
  const applyViewerView = () => { viewerImage.style.transform = `translate(-50%,-50%) translate(${viewerView.x}px,${viewerView.y}px) scale(${viewerView.zoom})`; viewerZoom.textContent = Math.round(viewerView.zoom * 100) + '%' }
  const zoomViewer = (next, px = 0, py = 0) => {
    const target = Math.min(8, Math.max(0.05, next)), ratio = target / viewerView.zoom
    viewerView.x = px - (px - viewerView.x) * ratio; viewerView.y = py - (py - viewerView.y) * ratio
    viewerView.zoom = target; applyViewerView()
  }
  const fitViewer = () => {
    const rect = viewerStage.getBoundingClientRect(), width = viewerImage.naturalWidth || rect.width, height = viewerImage.naturalHeight || rect.height
    viewerView.fit = Math.min(rect.width / width, rect.height / height, 1) || 1
    viewerView.zoom = viewerView.fit; viewerView.x = 0; viewerView.y = 0; applyViewerView()
  }
  const resetViewer = () => { viewerView.zoom = 1; viewerView.x = 0; viewerView.y = 0; applyViewerView() }
  const endViewerDrag = event => {
    if (!viewerView.drag) return
    viewerView.drag = null; viewerStage.classList.remove('grabbing')
    if (event?.pointerId !== undefined && viewerStage.hasPointerCapture?.(event.pointerId)) viewerStage.releasePointerCapture?.(event.pointerId)
  }
  viewerImage.draggable = false
  viewerImage.onload = () => { if (viewer.open) fitViewer() }
  viewerStage.onwheel = event => {
    event.preventDefault()
    const rect = viewerStage.getBoundingClientRect()
    zoomViewer(viewerView.zoom * Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2)
  }
  viewerStage.onpointerdown = event => {
    if (event.button !== 0) return
    event.preventDefault(); viewerView.drag = { x: event.clientX - viewerView.x, y: event.clientY - viewerView.y }
    viewerStage.setPointerCapture?.(event.pointerId); viewerStage.classList.add('grabbing')
  }
  viewerStage.onpointermove = event => {
    if (!viewerView.drag) return
    viewerView.x = event.clientX - viewerView.drag.x; viewerView.y = event.clientY - viewerView.drag.y; applyViewerView()
  }
  viewerStage.onpointerup = endViewerDrag
  viewerStage.onpointercancel = endViewerDrag
  viewerStage.ondblclick = () => { if (Math.abs(viewerView.zoom - viewerView.fit) < 0.001) resetViewer(); else fitViewer() }
  const viewerBar = el('div', { class: 'studio-viewer-bar' })
  viewerBar.append(button('关闭预览', () => viewer.close()),
    button('−', () => zoomViewer(viewerView.zoom / 1.25), 'studio-viewer-out'), viewerZoom,
    button('＋', () => zoomViewer(viewerView.zoom * 1.25), 'studio-viewer-in'),
    button('适应窗口', fitViewer), button('1:1', resetViewer),
    el('span', { class: 'studio-viewer-hint' }, '滚轮缩放 · 拖动平移 · 双击切换'),
    viewerDownload)
  viewerStage.append(viewerImage)
  viewer.append(viewerBar, viewerStage)
  const serviceUrl = el('input', { 'aria-label': '图片接口地址' }), model = el('input', { 'aria-label': '图片模型' }), key = el('input', { type: 'password', autocomplete: 'new-password', 'aria-label': '图片 API Key', placeholder: '留空保留已配置 Key' })
  settings.append(el('h2', {}, '图片服务'), el('p', {}, 'AI Pixel · Key 仅存储在本机服务端'), el('label', {}, '接口地址'), serviceUrl, el('label', {}, '模型'), model, el('label', {}, 'API Key'), key,
    button('保存设置', async () => { state.config = await api('/config', { baseUrl: serviceUrl.value, model: model.value, apiKey: key.value }); key.value = ''; settings.close(); render() }, 'studio-primary'), button('取消', () => { key.value = ''; settings.close() }))
  function showSettings() { serviceUrl.value = state.config.baseUrl; model.value = state.config.model; key.value = ''; settings.showModal() }
  function viewImage(id) {
    const asset = state.assets[id]
    viewerView.drag = null; viewerImage.src = imageUrl(id, false); viewerImage.alt = asset.name
    viewerDownload.href = imageUrl(id, false); viewerDownload.download = asset.name + '.png'
    viewer.showModal(); resetViewer()
    if (viewerImage.complete && viewerImage.naturalWidth) fitViewer()
  }
  side.append(el('div', { class: 'studio-brand' }, '✳ 灵感画布'), el('p', { class: 'studio-tagline' }, '让想法，有形可见。'), button('＋ 新建画板', () => newBoard(), 'studio-new-board'), boardList,
    el('div', { class: 'studio-sidebar-label' }, '素材库'), assetsList, button('⚙ 图片服务', showSettings, 'studio-settings'))
  const undoButton = button('↶', () => historyStep(true)), redoButton = button('↷', () => historyStep(false))
  undoButton.title = '撤销 Ctrl+Z'; redoButton.title = '重做 Ctrl+Shift+Z'
  dock.append(button('＋ 文字', () => add('text')), button('↑ 图片', () => fileInput.click()), button('✦ 生成卡片', () => add('generator'), 'studio-primary'), undoButton, redoButton)
  toolbar.append(boardTitle, notice,
    button('载入最新', async () => {
      if (drafts.size && !window.confirm('本页未保存草稿将被放弃，请先复制需要保留的文字。是否载入已保存画板？')) return
      clearTimeout(draftTimer); drafts.clear(); rememberDrafts(); editing = false; await queue; await refresh(); render(); notice.textContent = '已载入最新画板'
    }))
  boardTitle.onfocus = () => { editing = true; updateSelectionTools() }
  boardTitle.oninput = () => draft({ id: titleDraftId, title: renderedTitle }, 'title', boardTitle.value)
  boardTitle.onblur = safe(async () => { editing = false; await flush(); if (!drafts.size) render() })
  empty.append(el('div', { class: 'studio-empty-symbol' }, '✳'), el('h1', {}, '给灵感一片空白'), el('p', {}, '放入图片，写下想法，连接到生成卡片。'), button('创建第一张生成卡片', () => add('generator'), 'studio-primary'), el('small', {}, '也可以把图片拖到这里，或让右侧 Agent 帮你搭建画布。'))
  const controls = el('div', { class: 'studio-viewport-controls' })
  controls.setAttribute('role', 'toolbar'); controls.setAttribute('aria-label', '画布导航')
  for (const n of [15, 25, 50, 75, 100, 125, 150, 200, 300]) zoomLabel.append(el('option', { value: String(n) }, n + '%'))
  const customZoom = el('option', { value: 'custom', disabled: true }); zoomLabel.prepend(customZoom)
  zoomLabel.onchange = () => zoom(Number(zoomLabel.value) / 100)
  const focusButton = button('聚焦所选', () => focusView(true)), returnButton = button('返回视图', returnView)
  controls.append(button('−', () => zoom(viewport.zoom / 1.2)), zoomLabel, button('＋', () => zoom(viewport.zoom * 1.2)), button('适应画布', () => focusView(false)), focusButton, returnButton)
  const hint = el('div', { class: 'studio-canvas-hint' }, '空白拖动平移 · 滚轮缩放 · Shift 框选 · Esc 退出编辑/选择')
  bottomControls.append(dock, controls)
  world.append(svg, cards); stage.append(world, empty, selectionBox, contextTools, bottomControls, hint); main.append(toolbar, stage); root.append(side, main, fileInput, settings, viewer); sdk.mount('app', root)
  function transform() {
    world.style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.zoom})`
    const percent = Math.round(viewport.zoom * 100)
    customZoom.textContent = percent + '%'; zoomLabel.value = [15, 25, 50, 75, 100, 125, 150, 200, 300].includes(percent) ? String(percent) : 'custom'
    stage.style.backgroundSize = `${24 * viewport.zoom}px ${24 * viewport.zoom}px`; stage.style.backgroundPosition = `${viewport.x}px ${viewport.y}px`
    placeContextTools()
  }
  function zoom(value, x = stage.clientWidth / 2, y = stage.clientHeight / 2) {
    value = Math.max(.15, Math.min(3, value)); const factor = value / viewport.zoom
    viewport.x = x - (x - viewport.x) * factor; viewport.y = y - (y - viewport.y) * factor; viewport.zoom = value; transform(); scheduleViewport()
  }
  const selectedNodes = () => board().nodes.filter(n => selected.has(n.id))
  function cardSize(node) {
    const item = [...cards.children].find(item => item.dataset.node === node.id)
    return { width: item?.offsetWidth || 288, height: item?.offsetHeight || (node.type === 'generator' ? 400 : node.type === 'image' ? 360 : 230) }
  }
  const bottomInset = () => (bottomControls.offsetHeight || 48) + 32
  function fit(nodes = board().nodes) {
    const next = fitView(cardBounds(nodes, cardSize), stage.clientWidth, stage.clientHeight, bottomInset(), selected.size && !editing ? (contextTools.offsetHeight || 48) + 24 : 32)
    viewport = next || (nodes.length ? viewport : { x: 60, y: 60, zoom: 1 })
    transform(); scheduleViewport()
  }
  function focusView(selectionOnly) {
    if (selectionOnly && !selected.size) return
    returnViews.set(boardId, { ...viewport }); fit(selectionOnly ? selectedNodes() : board().nodes); updateSelectionTools()
  }
  function returnView() {
    const previous = returnViews.get(boardId)
    if (!previous) return
    viewport = previous; returnViews.delete(boardId); transform(); scheduleViewport(); updateSelectionTools()
  }
  async function removeSelection() {
    await flush(); if (selected.size) await edit([{ type: 'remove', ids: [...selected] }]); selected.clear(); render()
  }
  async function arrange(direction) {
    await flush()
    const operations = arrangeCards(selectedNodes(), direction, cardSize)
    if (operations.length > 100) throw Error('请每次选择不超过 100 张卡片进行排列。')
    if (operations.length) await edit(operations)
  }
  async function duplicateSelection() {
    await flush()
    const nodes = selectedNodes(), ids = new Map(nodes.map(n => [n.id, uuid()]))
    if (!nodes.length) return
    const delta = moveDelta(nodes, 40, 40)
    const operations = nodes.map(n => ({ type: 'add', node: { ...n, id: ids.get(n.id), x: n.x + delta.x, y: n.y + delta.y } }))
    for (const edge of board().edges) if (ids.has(edge.from) && ids.has(edge.to)) operations.push({ type: 'connect', id: uuid(), from: ids.get(edge.from), to: ids.get(edge.to) })
    if (operations.length > 100) throw Error('所选卡片和内部连线过多，请分批创建副本。')
    await edit(operations); selected.clear(); ids.forEach(id => selected.add(id)); render()
  }
  function placeContextTools() {
    if (contextTools.hidden || !stage.clientWidth || !stage.clientHeight) return
    const bounds = cardBounds(selectedNodes(), cardSize)
    if (!bounds) return
    contextTools.style.maxHeight = Math.max(0, stage.clientHeight - bottomInset() - 16) + 'px'
    const position = overlayPosition({ x: viewport.x + bounds.x * viewport.zoom, y: viewport.y + bounds.y * viewport.zoom,
      width: bounds.width * viewport.zoom, height: bounds.height * viewport.zoom }, contextTools.offsetWidth, contextTools.offsetHeight, stage.clientWidth, stage.clientHeight, bottomInset())
    contextTools.style.left = position.x + 'px'; contextTools.style.top = position.y + 'px'
  }
  function updateSelectionTools() {
    const nodes = selectedNodes(), signature = JSON.stringify([boardId, editing, nodes.map(n => [n.id, n.type, n.title])])
    for (const card of cards.children) card.classList.toggle('selected', selected.has(card.dataset.node))
    focusButton.disabled = !nodes.length; returnButton.disabled = !returnViews.has(boardId)
    contextTools.hidden = !nodes.length || editing || !!drag
    if (signature !== selectionSignature) {
      selectionSignature = signature
      contextTools.replaceChildren()
      if (nodes.length) {
        contextTools.append(el('span', { class: 'studio-selection-label' }, nodes.length > 1 ? `已选 ${nodes.length} 张卡片` : ({ text: '文字灵感', image: '图片', generator: '生成卡片' }[nodes[0].type])), button('聚焦', () => focusView(true)))
        if (nodes.length === 1) {
          const node = nodes[0]
          if (node.type === 'image') contextTools.append(button('预览图片', () => viewImage(node.assetId)))
          else contextTools.append(button(node.type === 'text' ? '编辑文字' : '编辑提示词', () => cards.querySelector(`[data-node="${node.id}"] textarea`)?.focus()))
        } else contextTools.append(button('水平排列', () => arrange('horizontal')), button('垂直排列', () => arrange('vertical')))
        contextTools.append(button('创建副本', duplicateSelection), button('删除所选', removeSelection, 'studio-danger'))
      }
    }
    placeContextTools()
  }
  function scheduleViewport() { clearTimeout(viewTimer); viewTimer = setTimeout(() => saveViewport().catch(error => sdk.toast(error.message)), 500) }
  async function saveViewport() { clearTimeout(viewTimer); if (!stopped && !held) await edit([{ type: 'viewport', viewport: { ...viewport } }], { history: false }) }
  function wirePath(from, to) { const distance = Math.max(70, Math.abs(to.x - from.x) * .45); return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}` }
  function paintWires() {
    svg.replaceChildren()
    for (const edge of board().edges) {
      const a = board().nodes.find(n => n.id === edge.from), b = board().nodes.find(n => n.id === edge.to)
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', wirePath({ x: a.x + 288, y: a.y + 38 }, { x: b.x, y: b.y + 38 })); path.dataset.edge = edge.id
      path.onclick = safe(async event => { event.stopPropagation(); await edit([{ type: 'disconnect', id: edge.id }]) }); const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = '点击断开连线'; path.append(title); svg.append(path)
    }
    for (const result of board().nodes.filter(n => n.type === 'image' && n.sourceNodeId)) {
      const source = board().nodes.find(n => n.id === result.sourceNodeId)
      if (!source) continue
      const path = document.createElementNS(svg.namespaceURI, 'path')
      path.classList.add('studio-result-wire'); path.setAttribute('d', wirePath({ x: source.x + 288, y: source.y + 38 }, { x: result.x, y: result.y + 38 }))
      const title = document.createElementNS(svg.namespaceURI, 'title'); title.textContent = '生成结果来源'; path.append(title); svg.append(path)
    }
  }
  function field(node, prop, area = false) {
    const value = drafts.get(node.id)?.patch[prop] ?? node[prop]
    const input = el(area ? 'textarea' : 'input', { value, 'aria-label': node.title + (prop === 'prompt' ? ' 提示词' : prop === 'text' ? ' 文字内容' : ' 标题'), maxLength: area ? 12000 : 120 })
    input.onfocus = () => { editing = true; selected.clear(); selected.add(node.id); updateSelectionTools() }
    input.oninput = () => draft(node, prop, input.value)
    input.onblur = safe(async () => { editing = false; await flush(); if (!drafts.size) render() })
    input.onkeydown = event => {
      if (event.isComposing || event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); selected.clear(); selected.add(node.id)
      input.blur(); stage.focus({ preventScroll: true }); updateSelectionTools()
    }
    return input
  }
  function renderCard(node) {
    const card = el('article', { class: `studio-card studio-${node.type}${selected.has(node.id) ? ' selected' : ''}` }); card.dataset.node = node.id
    card.style.left = node.x + 'px'; card.style.top = node.y + 'px'
    const head = el('div', { class: 'studio-card-head' }); head.dataset.handle = node.id
    const title = el('span', {}, node.title); title.title = '双击修改卡片标题'
    title.ondblclick = event => { event.stopPropagation(); const input = field(node, 'title'); title.replaceWith(input); input.focus(); input.select() }
    head.append(el('span', { class: 'studio-kind' }, { text: 'T', image: '▧', generator: '✦' }[node.type]), title)
    const port = button(node.type === 'generator' ? '输入' : '连接', () => {})
    port.className = 'studio-port ' + (node.type === 'generator' ? 'input' : 'output'); port.title = node.type === 'generator' ? '接入参考图或文字' : '拖动或点击连接到生成卡片'
    port.dataset[node.type === 'generator' ? 'input' : 'output'] = node.id; card.append(head, port)
    if (node.type === 'text') card.append(field(node, 'text', true))
    if (node.type === 'image') {
      const asset = state.assets[node.assetId], image = el('img', { src: imageUrl(node.assetId), alt: node.title, draggable: false, loading: 'lazy' })
      image.ondblclick = () => viewImage(node.assetId)
      const foot = el('div', { class: 'studio-image-foot' }); foot.append(el('small', {}, `${asset.width} × ${asset.height}`), button('预览', () => viewImage(node.assetId)), el('a', { href: imageUrl(node.assetId, false), download: asset.name + '.png' }, '下载'))
      card.append(image, foot)
    }
    if (node.type === 'generator') {
      card.append(field(node, 'prompt', true))
      const options = el('div', { class: 'studio-generation-options' })
      for (const [prop, values] of [['ratio', ratios], ['resolution', resolutions]]) {
        const select = el('select', { 'aria-label': node.title + (prop === 'ratio' ? ' 比例' : ' 分辨率') })
        for (const value of values) select.append(el('option', { value }, value))
        select.value = node[prop]; select.onchange = safe(async () => { await flush(); await edit([{ type: 'update', id: node.id, patch: { [prop]: select.value } }]) }); options.append(select)
      }
      const inputs = el('div', { class: 'studio-inputs' }), incoming = board().edges.filter(e => e.to === node.id)
      inputs.append(el('small', {}, incoming.length ? '输入顺序' : '拖入连线，或直接填写提示词'))
      incoming.forEach((edge, index) => {
        const from = board().nodes.find(n => n.id === edge.from), row = el('div')
        row.append(el('span', {}, `${index + 1}. ${from.title}`), button('↑', async () => { if (!index) return; const ids = incoming.map(e => e.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await edit([{ type: 'reorder', id: node.id, edges: ids }]) }), button('×', () => edit([{ type: 'disconnect', id: edge.id }])))
        inputs.append(row)
      })
      const jobs = state.jobs.filter(j => j.boardId === boardId && j.nodeId === node.id), job = jobs.at(-1), busy = ['queued', 'running'].includes(job?.status)
      const run = button(busy ? '■ 停止生成' : '✦ 生成图片', () => busy ? api('/cancel', { id: job.id }).then(refresh) : generate(node.id), busy ? '' : 'studio-primary')
      const status = el('div', { class: 'studio-job-status' }, job ? ({ queued: '排队中', running: '正在生成…', succeeded: '已生成 · 结果保留在右侧', failed: '生成失败', interrupted: '生成已中断' }[job.status] + (job.error ? ' · ' + job.error : '')) : state.config.hasKey ? state.config.model : '请先配置图片服务')
      card.append(options, inputs, status, run)
    }
    return card
  }
  function render() {
    if (stopped || drag || editing) return
    const restoreFocus = cards.contains(document.activeElement)
    for (const id of selected) if (!board().nodes.some(n => n.id === id)) selected.delete(id)
    renderedTitle = board().title
    boardTitle.value = drafts.get(titleDraftId)?.patch.title ?? renderedTitle
    boardList.replaceChildren(...state.boards.map(b => button(b.title, () => choose(b.id), b.id === boardId ? 'active' : '')))
    assetsList.replaceChildren(...Object.values(state.assets).reverse().map(asset => { const b = button('', () => add('image', { assetId: asset.id, title: asset.name })); b.title = '添加到画布：' + asset.name; b.append(el('img', { src: imageUrl(asset.id), alt: asset.name, loading: 'lazy' })); return b }))
    renderedNodes.clear()
    for (const item of cards.children) resizeObserver?.unobserve(item)
    cards.replaceChildren(...board().nodes.map(node => {
      const rendered = structuredClone(node)
      renderedNodes.set(node.id, rendered)
      return renderCard(rendered)
    })); empty.hidden = board().nodes.length > 0
    for (const item of cards.children) resizeObserver?.observe(item)
    if (restoreFocus) stage.focus({ preventScroll: true })
    undoButton.disabled = !undo.get(boardId)?.length; redoButton.disabled = !redo.get(boardId)?.length
    paintWires(); transform(); updateSelectionTools()
  }
  const coordinates = event => { const rect = stage.getBoundingClientRect(); return { x: (event.clientX - rect.left - viewport.x) / viewport.zoom, y: (event.clientY - rect.top - viewport.y) / viewport.zoom } }
  sdk.listen(stage, 'pointerdown', event => {
    if (held || stopped || event.button > 1 || drag || event.target.closest('.studio-context-tools,.studio-bottom-controls')) return
    const pan = space || event.button === 1
    const output = event.target.closest('[data-output]'), input = event.target.closest('[data-input]')
    if (!pan && output) { connecting = output.dataset.output; notice.textContent = '选择生成卡片的输入圆点'; event.preventDefault(); return }
    if (!pan && input) { if (connecting) void safe(() => connect(connecting, input.dataset.input))(); return }
    if (!pan && event.target.closest('button,input,textarea,select,a,path')) return
    const card = event.target.closest('[data-node]')
    if (card && !pan && event.button === 0) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) { selected.has(card.dataset.node) ? selected.delete(card.dataset.node) : selected.add(card.dataset.node); updateSelectionTools(); return }
      if (!event.target.closest('[data-handle]')) { selected.clear(); selected.add(card.dataset.node); stage.focus({ preventScroll: true }); updateSelectionTools(); return }
      if (!selected.has(card.dataset.node)) { selected.clear(); selected.add(card.dataset.node) }
      drag = { type: 'nodes', start: coordinates(event), nodes: board().nodes.filter(n => selected.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })) }
    } else {
      if (!pan && event.shiftKey) { drag = { type: 'select', start: coordinates(event), selected: new Set(selected), extend: event.ctrlKey || event.metaKey }; if (!drag.extend) selected.clear() }
      else { if (!pan) selected.clear(); drag = { type: 'pan', x: event.clientX, y: event.clientY, before: { ...viewport } } }
    }
    Object.assign(drag, { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, moved: false })
    stage.setPointerCapture?.(event.pointerId); stage.focus({ preventScroll: true }); event.preventDefault(); updateSelectionTools()
  })
  function movePointer(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 4) drag.moved = true
    if (!drag.moved) return
    if (drag.type === 'pan') { viewport.x = Math.max(-100000, Math.min(100000, drag.before.x + event.clientX - drag.x)); viewport.y = Math.max(-100000, Math.min(100000, drag.before.y + event.clientY - drag.y)); transform() }
    else {
      const point = coordinates(event)
      if (drag.type === 'nodes') {
        const delta = moveDelta(drag.nodes, point.x - drag.start.x, point.y - drag.start.y)
        for (const before of drag.nodes) {
          const node = board().nodes.find(n => n.id === before.id); node.x = before.x + delta.x; node.y = before.y + delta.y
          const item = cards.querySelector(`[data-node="${node.id}"]`); item.style.left = node.x + 'px'; item.style.top = node.y + 'px'
        }; paintWires()
      } else {
        selectionBox.hidden = false
        Object.assign(selectionBox.style, { left: viewport.x + Math.min(point.x, drag.start.x) * viewport.zoom + 'px',
          top: viewport.y + Math.min(point.y, drag.start.y) * viewport.zoom + 'px',
          width: Math.abs(point.x - drag.start.x) * viewport.zoom + 'px', height: Math.abs(point.y - drag.start.y) * viewport.zoom + 'px' })
        for (const node of board().nodes) {
          const size = cardSize(node), inside = node.x + size.width >= Math.min(point.x, drag.start.x) && node.x <= Math.max(point.x, drag.start.x) && node.y + size.height >= Math.min(point.y, drag.start.y) && node.y <= Math.max(point.y, drag.start.y)
          if (inside || (drag.extend && drag.selected.has(node.id))) selected.add(node.id); else selected.delete(node.id)
        }
        updateSelectionTools()
      }
    }
  }
  sdk.listen(stage, 'pointermove', movePointer)
  function cancelGesture() {
    if (!drag) return
    const previous = drag; drag = null
    if (previous.type === 'nodes') for (const before of previous.nodes) Object.assign(board().nodes.find(n => n.id === before.id), before)
    if (previous.type === 'pan') viewport = previous.before
    if (previous.type === 'select') { selected.clear(); previous.selected.forEach(id => selected.add(id)) }
    if (stage.hasPointerCapture?.(previous.pointerId)) stage.releasePointerCapture(previous.pointerId)
    selectionBox.hidden = true; render()
  }
  const release = safe(async event => {
    if (connecting) { const input = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-input]'); if (input) await connect(connecting, input.dataset.input) }
    if (!drag || event.pointerId !== drag.pointerId) return
    movePointer(event)
    const previous = drag; drag = null
    if (stage.hasPointerCapture?.(previous.pointerId)) stage.releasePointerCapture(previous.pointerId)
    selectionBox.hidden = true
    if (previous.type === 'nodes' && previous.moved) {
      const operations = previous.nodes.map(old => { const n = board().nodes.find(n => n.id === old.id); const patch = { x: n.x, y: n.y }; Object.assign(n, old); return { type: 'update', id: old.id, patch } })
        .filter(op => previous.nodes.some(n => n.id === op.id && (n.x !== op.patch.x || n.y !== op.patch.y)))
      try { if (operations.length) await edit(operations) }
      finally { render() }
    } else if (previous.type === 'pan' && previous.moved) await saveViewport()
    render()
  })
  sdk.listen(window, 'pointerup', release); sdk.listen(stage, 'pointercancel', cancelGesture)
  sdk.listen(stage, 'lostpointercapture', cancelGesture)
  sdk.listen(window, 'blur', () => { space = false; connecting = null; cancelGesture() })
  sdk.listen(stage, 'wheel', event => { if (event.target.closest('textarea,select,.studio-context-tools,.studio-bottom-controls')) return; event.preventDefault(); if (drag) return; const rect = stage.getBoundingClientRect(); zoom(viewport.zoom * Math.exp(-event.deltaY * .001), event.clientX - rect.left, event.clientY - rect.top) })
  sdk.listen(window, 'keydown', safe(async event => {
    if (event.isComposing || !root.contains(event.target) || event.target.closest('input,textarea,select') || settings.open || viewer.open) return
    if (event.code === 'Space') { space = true; event.preventDefault() }
    if (event.key === 'Escape') { if (drag) { cancelGesture(); return }; connecting = null; selected.clear(); render() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); board().nodes.forEach(n => selected.add(n.id)); updateSelectionTools() }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); await historyStep(!event.shiftKey) }
    if (event.key === 'Delete' && selected.size) { event.preventDefault(); await edit([{ type: 'remove', ids: [...selected] }]); selected.clear(); render() }
  }))
  const resizeObserver = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(placeContextTools) : null
  resizeObserver?.observe(stage); resizeObserver?.observe(cards); resizeObserver?.observe(contextTools)
  sdk.listen(window, 'keyup', event => { if (event.code === 'Space') space = false })
  sdk.listen(stage, 'dragover', event => event.preventDefault())
  sdk.listen(stage, 'drop', safe(async event => { event.preventDefault(); let offset = 0; for (const file of event.dataTransfer.files) { await upload(file, { ...coordinates(event), y: coordinates(event).y + offset }); offset += 50 } }))
  sdk.listen(window, 'paste', safe(async event => { if (event.target.closest('input,textarea')) return; const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); for (const file of files) await upload(file) } }))
  let recovered
  try { recovered = JSON.parse(sdk.storage.local.getItem('drafts')) } catch {}
  if (recovered?.boardId && state.boards.some(b => b.id === recovered.boardId) && Array.isArray(recovered.drafts)) { boardId = recovered.boardId; viewport = { ...board().viewport }; for (const [id, value] of recovered.drafts) drafts.set(id, value); notice.textContent = '已恢复未保存草稿'; sdk.toast('已恢复草稿，继续编辑会尝试保存；冲突时不会覆盖另一页面。') }
  const timer = setInterval(() => refresh().catch(() => {}), 1500)
  sdk.listen(window, 'beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => {
    await flush(); await saveViewport(); held = true; root.inert = true
    request.hold(() => { held = false; root.inert = false })
  })
  ctx.effect(() => () => { stopped = true; resizeObserver?.disconnect(); clearTimeout(draftTimer); clearTimeout(viewTimer); clearInterval(timer); settings.remove(); viewer.remove() })
  registerTools(sdk, { read: () => ({ board: structuredClone(board()), boards: state.boards.map(({ id, title }) => ({ id, title })), assets: structuredClone(state.assets), jobs: structuredClone(state.jobs), dirty: drafts.size > 0 }),
    editable: () => !stopped && !held && !drag && !drafts.size && !editing,
    edit: async (operations, revision) => { const result = await edit(operations, { expectedRevision: revision }); render(); return result },
    generate, choose, newBoard, api, refresh, position, imageUrl, importImage,
  })
  render()
}
