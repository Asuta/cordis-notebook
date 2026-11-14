import { createRegistry } from './registry.js'
import { mediaKind, mediaUrl, uploadMedia } from './media-client.js'
import { createEditQueue } from './edit-queue.js'

export async function createSession(ctx, sdk) {
  const api = (path, body) => sdk.request('/api/studio' + path, body === undefined ? 'GET' : 'POST', body)
  const fallbackView = { render() {}, dragging: () => false }, actions = createRegistry()
  let view = fallbackView, status = '已保存'
  const notice = { set textContent(value) { status = value; view.status?.(value) } }
  const render = () => view.render()
  const drafts = new Map(), undo = new Map(), redo = new Map()
  const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
  let state = await api(''), boardId = sdk.storage.local.getItem('board'), stopped = false, held = false, editing = false, draftTimer, polling = false, epoch = 0, flushing, preparing = false
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
  // Session storage survives refresh without sharing one recovery journal across
  // browser tabs, which could otherwise overwrite or erase each other's edits.
  const edits = createEditQueue({ state: () => state, api, storage: sdk.storage.session || sdk.storage.local, undo, redo,
    busy: () => editing || view.dragging(), report: message => sdk.toast(message),
    changed(save, repaint = false) {
      if (save) notice.textContent = save.error ? '保存失败 · 修改已保留' : save.pending || drafts.size ? '正在保存…' : '已保存'
      if (repaint && !editing && !view.dragging()) render()
    },
  })
  if (edits.dirty) notice.textContent = '待保存修改已恢复 · 请重试保存'
  function rememberDrafts() {
    if (drafts.size) sdk.storage.local.setItem('drafts', JSON.stringify({ boardId, drafts: [...drafts] }))
    else sdk.storage.local.removeItem('drafts')
  }
  async function refresh({ fresh = false } = {}) {
    if (polling) { await polling; if (!fresh) return }
    if (stopped || (document.hidden && !fresh) || view.dragging() || drafts.size || edits.dirty) return
    const stamp = epoch
    const task = (async () => {
      const summary = fresh ? null : await api('/summary')
      if (stopped || stamp !== epoch || view.dragging() || drafts.size || edits.dirty) return
      if (!fresh && summary.revision === state.stateRevision) return
      const next = await api('')
      if (stopped || stamp !== epoch || view.dragging() || drafts.size || edits.dirty) return
      const changed = next.stateRevision !== state.stateRevision
      // The epoch check protects concurrent imports; this snapshot also removes
      // assets permanently deleted by another page.
      state = next
      if (changed && !editing) render()
    })()
    polling = task
    try { await task } finally { if (polling === task) polling = false }
  }
  async function edit(operations, options = {}) {
    if (stopped || held) throw Error('画布正在退出')
    epoch++
    return edits.edit(operations, { targetBoard: boardId, ...options })
  }
  async function historyStep(back) {
    await prepareEdit()
    const source = back ? undo : redo, stack = source.get(boardId) || []
    if (!stack.length) return
    return edit(stack.at(-1), { historyDirection: back ? 'undo' : 'redo', waitForSave: false })
  }
  // Ordinary local commands do not wait for older requests. Drafts still use
  // field-level conflict checks before becoming a transaction.
  async function prepareEdit() {
    if (drafts.size || flushing) await flush()
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
    if (!drafts.size) { await edits.flush(); return }
    const entries = [...drafts].map(([id, entry]) => [id, structuredClone(entry)])
    await edits.flush()
    const knownAssets = new Set(Object.keys(state.assets))
    const latest = await api('')
    const current = latest.boards.find(b => b.id === boardId)
    for (const [id, entry] of entries) {
      const node = id === titleDraftId ? current : current?.nodes.find(n => n.id === id)
      if (!node || Object.keys(entry.patch).some(key => !equal(node[key], entry.before[key]) && !equal(node[key], entry.patch[key]))) throw Error((id === titleDraftId ? '画板名称' : '这张卡片') + '已在其他页面修改，草稿已保留；请先复制草稿再载入最新画板')
    }
    const concurrentAssets = Object.fromEntries(Object.entries(state.assets).filter(([id]) => !knownAssets.has(id)))
    state = { ...latest, assets: { ...concurrentAssets, ...latest.assets } }
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
    notice.textContent = edits.error ? '保存失败 · 修改已保留' : edits.count ? '正在保存…' : '已保存'
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
  const editable = () => !stopped && !held && !preparing && !view.dragging() && !drafts.size && !editing && !edits.dirty
  const read = () => ({ board: structuredClone(board()), boards: state.boards.map(({ id, title }) => ({ id, title })), assets: structuredClone(state.assets), jobs: structuredClone(state.jobs || []), providers: structuredClone(state.providers || []), types: structuredClone(state.types || []), actions: actions.list().map(({ id, label, schema }) => ({ id, label, schema })), dirty: drafts.size > 0 || edits.dirty })
  let recovered
  try { recovered = JSON.parse(sdk.storage.local.getItem('drafts')) } catch {}
  if (recovered?.boardId && state.boards.some(b => b.id === recovered.boardId) && Array.isArray(recovered.drafts)) { boardId = recovered.boardId; viewport = savedViewport(boardId); for (const [id, value] of recovered.drafts) drafts.set(id, value); notice.textContent = '已恢复未保存草稿'; sdk.toast('已恢复草稿，继续编辑会尝试保存；冲突时不会覆盖另一页面。') }
  const timer = setInterval(() => refresh().catch(() => {}), 1500)
  sdk.listen(window, 'beforeunload', event => { if (drafts.size || edits.dirty) { event.preventDefault(); event.returnValue = '' } })
  ctx.on('plugins/before-stop', async request => {
    preparing = true; view.hold?.(true)
    request.hold(() => { preparing = false; held = false; view.hold?.(false); render() })
    await flush(); await refresh({ fresh: true }); await saveViewport(); held = true; editing = false
  })
  ctx.effect(() => () => { stopped = true; edits.stop(); clearTimeout(draftTimer); clearInterval(timer) })
  return {
    get state() { return state }, get boardId() { return boardId }, get stopped() { return stopped }, get held() { return held },
    get editing() { return editing }, set editing(value) { editing = value },
    get viewport() { return viewport }, set viewport(value) { viewport = value },
    get renderedTitle() { return renderedTitle }, set renderedTitle(value) { renderedTitle = value },
    drafts, undo, redo, titleDraftId, board, api, read, editable, edit, flush, prepareEdit, historyStep, draft, choose, newBoard, duplicateBoard, renameBoard, refresh, imageUrl, rememberAsset, importImage, saveViewport, mediaKind, mediaUrl,
    get saveError() { return edits.error },
    get pendingEdits() { return edits.count },
    retrySave: async () => { await edits.retry(); await flush(); await refresh({ fresh: true }) },
    exportPending: () => ({ ...edits.snapshot(), drafts: [...drafts], boardId }),
    uploadMedia: (file, signal = sdk.signal, progress) => uploadMedia(file, api, signal, progress),
    async discardDrafts() { clearTimeout(draftTimer); await edits.discard(); drafts.clear(); rememberDrafts(); editing = false; epoch++; await refresh({ fresh: true }); render() },
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
