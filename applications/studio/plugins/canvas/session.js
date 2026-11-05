import { createRegistry } from './registry.js'
import { mediaKind, mediaUrl, uploadMedia } from './media-client.js'

export async function createSession(ctx, sdk) {
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const fallbackView = { render() {}, dragging: () => false }, actions = createRegistry()
  let view = fallbackView, status = '已保存'
  const notice = { set textContent(value) { status = value; view.status?.(value) } }
  const render = () => view.render()
  const drafts = new Map(), undo = new Map(), redo = new Map()
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  let state = await api(''), boardId = sdk.storage.local.getItem('board'), queue = Promise.resolve(), stopped = false, held = false, editing = false, draftTimer, polling = false, epoch = 0, pendingEdits = 0, flushing, preparing = false
  const board = () => state.boards.find(b => b.id === boardId) || state.boards[0]
  boardId = board().id
  const viewportKey = id => 'viewport:' + id
  function savedViewport(id) {
    try {
      const value = JSON.parse(sdk.storage.local.getItem(viewportKey(id)))
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.zoom) && value.zoom >= .15 && value.zoom <= 3) return value
    } catch {}
    return { ...state.boards.find(item => item.id === id).viewport }
  }
  let viewport = savedViewport(boardId), renderedTitle = board().title
  const titleDraftId = '$board'
  const enqueue = action => { const task = queue.then(action); queue = task.catch(() => {}); return task }
  function rememberDrafts() {
    if (drafts.size) sdk.storage.local.setItem('drafts', JSON.stringify({ boardId, drafts: [...drafts] }))
    else sdk.storage.local.removeItem('drafts')
  }
  async function refresh({ fresh = false } = {}) {
    if (polling) { await polling; if (!fresh) return }
    if (stopped || (document.hidden && !fresh) || view.dragging() || drafts.size || pendingEdits) return
    const stamp = epoch
    const task = (async () => {
      const summary = fresh ? null : await api('/summary')
      if (stopped || stamp !== epoch || view.dragging() || drafts.size || pendingEdits) return
      if (!fresh && summary.revision === state.stateRevision) return
      const next = await api('')
      if (stopped || stamp !== epoch || view.dragging() || drafts.size || pendingEdits) return
      const changed = next.stateRevision !== state.stateRevision
      state = { ...next, assets: { ...state.assets, ...next.assets } }
      if (changed && !editing) render()
    })()
    polling = task
    try { await task } finally { if (polling === task) polling = false }
  }
  async function edit(operations, { expectedRevision, history = true, repaint = true, targetBoard = boardId } = {}) {
    pendingEdits++; epoch++
    return enqueue(async () => {
      if (stopped || held) throw Error('画布正在退出')
      const current = state.boards.find(b => b.id === targetBoard)
      const result = await api('/edit', { boardId: targetBoard, revision: expectedRevision ?? current.revision, operations })
      state.boards[state.boards.findIndex(b => b.id === targetBoard)] = result.board
      if (history) { const items = undo.get(targetBoard) || []; items.push(result.inverse); if (items.length > 40) items.shift(); undo.set(targetBoard, items); redo.set(targetBoard, []) }
      notice.textContent = '已保存'
      if (repaint && !editing && !view.dragging()) render()
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
      if (!node || Object.keys(entry.patch).some(key => !equal(node[key], entry.before[key]) && !equal(node[key], entry.patch[key]))) throw Error((id === titleDraftId ? '画板名称' : '这张卡片') + '已在其他页面修改，草稿已保留；请先复制草稿再载入最新画板')
    }
    state = { ...latest, assets: { ...state.assets, ...latest.assets } }
    await edit(entries.map(([id, entry]) => id === titleDraftId ? { type: 'rename', title: entry.patch.title } : { type: 'update', id, patch: entry.patch }), { expectedRevision: current.revision })
    for (const [id, entry] of entries) {
      // Focused inputs keep their DOM and captured node. Advance only fields we
      // just saved; polling must not hide a genuine edit from another page.
      if (id !== titleDraftId) view.syncRenderedNode?.(id, entry.patch)
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
    boardId = id; sdk.storage.local.setItem('board', id); viewport = savedViewport(id); view.choose?.(); render()
  }
  async function newBoard(title = '新的灵感画板') {
    await flush(); const created = await api('/boards', { title }); state.boards.push(created); await choose(created.id); return created
  }
  async function duplicateBoard(id = boardId) {
    await flush(); await saveViewport()
    const created = await api('/boards/' + encodeURIComponent(id) + '/copy', {})
    state.boards.push(created); await choose(created.id); return created
  }
  async function renameBoard(id, title) {
    await flush(); await edit([{ type: 'rename', title }], { targetBoard: id })
  }

  const imageUrl = (id, thumb = true) => '/api/studio/images/' + id + '.' + (thumb === 'small' ? 'small.webp' : thumb ? 'webp' : 'png')
  function rememberAsset(asset) { epoch++; state.assets[asset.id] = asset; render(); return asset }
  async function importImage(input) { return rememberAsset(await api('/import', input)) }
  async function saveViewport() {
    if (stopped || held) return
    // A viewport belongs to this browser, not to shared board content. Keeping it
    // local prevents every pan/zoom from invalidating and repainting other tabs.
    sdk.storage.local.setItem(viewportKey(boardId), JSON.stringify(viewport))
  }
  const editable = () => !stopped && !held && !preparing && !view.dragging() && !drafts.size && !editing
  const read = () => ({ board: structuredClone(board()), boards: state.boards.map(({ id, title }) => ({ id, title })), assets: structuredClone(state.assets), jobs: structuredClone(state.jobs || []), providers: structuredClone(state.providers || []), types: structuredClone(state.types || []), actions: actions.list().map(({ id, label, schema }) => ({ id, label, schema })), dirty: drafts.size > 0 })
  let recovered
  try { recovered = JSON.parse(sdk.storage.local.getItem('drafts')) } catch {}
  if (recovered?.boardId && state.boards.some(b => b.id === recovered.boardId) && Array.isArray(recovered.drafts)) { boardId = recovered.boardId; viewport = savedViewport(boardId); for (const [id, value] of recovered.drafts) drafts.set(id, value); notice.textContent = '已恢复未保存草稿'; sdk.toast('已恢复草稿，继续编辑会尝试保存；冲突时不会覆盖另一页面。') }
  const timer = setInterval(() => refresh().catch(() => {}), 1500)
  sdk.listen(window, 'beforeunload', event => { if (drafts.size) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => {
    preparing = true; view.hold?.(true)
    request.hold(() => { preparing = false; held = false; view.hold?.(false); render() })
    await flush(); await refresh({ fresh: true }); await saveViewport(); held = true; editing = false
  })
  ctx.effect(() => () => { stopped = true; clearTimeout(draftTimer); clearInterval(timer) })
  return {
    get state() { return state }, get boardId() { return boardId }, get stopped() { return stopped }, get held() { return held },
    get editing() { return editing }, set editing(value) { editing = value },
    get viewport() { return viewport }, set viewport(value) { viewport = value },
    get renderedTitle() { return renderedTitle }, set renderedTitle(value) { renderedTitle = value },
    drafts, undo, redo, titleDraftId, board, api, read, editable, edit, flush, draft, choose, newBoard, duplicateBoard, renameBoard, refresh, imageUrl, rememberAsset, importImage, saveViewport, mediaKind, mediaUrl,
    uploadMedia: (file, signal = sdk.signal, progress) => uploadMedia(file, api, signal, progress),
    async discardDrafts() { clearTimeout(draftTimer); drafts.clear(); rememberDrafts(); editing = false; await queue; await refresh(); render() },
  attachView(owner, next) {
      return owner.effect(() => { view = next; view.status?.(status); return () => { if (view === next) { view = fallbackView; editing = false } } })
    },
    actions,
    async execute(id, args = {}, source = 'user') {
      const action = actions.require(id)
      if (source === 'agent' && action.mutates !== false && (!editable() || args.revision !== board().revision)) throw Error('用户正在编辑或画布已变化，请重新 studio_read')
      if (action.mutates !== false) await flush()
      return action.run(args)
    },
  }
}
