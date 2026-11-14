import { applyOperations } from './model.js'

const STORAGE = 'canvas-pending-edits-v1'
const copy = value => structuredClone(value)

// Local transactions and their history are independent of transport completion.
// Uncertain saves stay intact. Definite validation failures rebuild later edits
// from the acknowledged base instead of blocking all future saves.
export function createEditQueue({ state, api, storage, undo, redo, changed, report, busy }) {
  const pending = [], bases = new Map()
  let sending, failure, recoveryLog, recoveryBlocked = false, stopped = false, discarding = false
  const types = {
    get(id) {
      const descriptor = state().types?.find(type => type.id === id)
      return descriptor && { ...descriptor, defaults: () => copy(descriptor.defaults || {}), validate() {} }
    },
    require(id) { const type = this.get(id); if (!type) throw Error('卡片类型不可用，请启用对应插件'); return type },
  }
  const replace = board => { const index = state().boards.findIndex(item => item.id === board.id); if (index >= 0) state().boards[index] = board }
  function apply(board, operations) {
    const result = applyOperations(board, operations, state().assets, types)
    const previousNodes = new Map(board.nodes.map(node => [node.id, node]))
    // Built-in outputs can be derived locally. Plugin resolvers stay server-owned.
    for (const node of result.board.nodes) {
      const previous = previousNodes.get(node.id)
      if (node.type === 'text') node.resolvedOutput = { text: node.text }
      else if (['image', 'video'].includes(node.type) && node.assetId) node.resolvedOutput = { assetId: node.assetId, ...(node.type === 'video' ? { kind: 'video' } : {}) }
      else if (previous?.resolvedOutput && !operations.some(op => op.type === 'update' && op.id === node.id && [...Object.keys(op.patch), ...(op.unset || [])].some(key => !['x', 'y', 'title'].includes(key)))) node.resolvedOutput = copy(previous.resolvedOutput)
    }
    return result
  }
  function snapshot(entries = pending, boardBases = bases) {
    if (recoveryBlocked) {
      try { return JSON.parse(recoveryLog) }
      catch { return { version: 1, bases: [], entries: [], raw: recoveryLog } }
    }
    return { version: 1, bases: [...boardBases.values()], entries: entries.map(({ id, boardId, revision, operations }) => ({ id, boardId, revision, operations })) }
  }
  function persist(entries = pending, boardBases = bases) {
    if (recoveryBlocked) throw failure
    if (entries.length) storage.setItem(STORAGE, JSON.stringify(snapshot(entries, boardBases)))
    else storage.removeItem(STORAGE)
  }
  function status() { changed({ pending: pending.length, error: failure?.message || null }) }
  function completion(entry) {
    entry.saved = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject })
    // UI callers await local application; flush/agent callers await durability.
    void entry.saved.catch(() => {})
  }
  function recordHistory(entry, undoHistory = undo, redoHistory = redo) {
    const id = entry.boardId
    entry.historyBefore = { undo: [...(undoHistory.get(id) || [])], redo: [...(redoHistory.get(id) || [])] }
    if (entry.historyDirection) {
      const source = entry.historyDirection === 'undo' ? undoHistory : redoHistory, target = entry.historyDirection === 'undo' ? redoHistory : undoHistory
      const stack = [...(source.get(id) || [])], other = [...(target.get(id) || [])]
      entry.historySource = stack.pop()
      other.push(entry.result.inverse); source.set(id, stack); target.set(id, other)
    } else if (entry.history) {
      const stack = [...(undoHistory.get(id) || []), entry.result.inverse]
      if (stack.length > 40) stack.shift()
      undoHistory.set(id, stack); redoHistory.set(id, [])
    }
  }
  function rejectInvalid(entry, error) {
    const next = [], rejected = [entry], nextBases = new Map(bases)
    const nextUndo = new Map(undo), nextRedo = new Map(redo), inverses = new Map()
    nextUndo.set(entry.boardId, entry.historyBefore.undo)
    nextRedo.set(entry.boardId, entry.historyBefore.redo)
    let board = copy(bases.get(entry.boardId))
    for (const item of pending.slice(1)) {
      if (item.boardId !== entry.boardId) { next.push(item); continue }
      let operations = item.operations
      if (item.historyDirection) {
        const source = item.historyDirection === 'undo' ? nextUndo : nextRedo
        operations = source.get(item.boardId)?.at(-1)
        // Never turn an undo of a rejected edit into an undo of an older edit.
        if (!operations || operations !== (inverses.get(item.historySource) || item.historySource)) { rejected.push(item); continue }
      }
      let result
      try { result = apply(board, operations) }
      catch { rejected.push(item); continue }
      const rebased = { ...item, id: crypto.randomUUID(), revision: board.revision, operations: copy(operations), result }
      recordHistory(rebased, nextUndo, nextRedo)
      inverses.set(item.result.inverse, result.inverse)
      next.push(rebased); board = result.board
    }
    if (!next.some(item => item.boardId === entry.boardId)) nextBases.delete(entry.boardId)
    // Publish the rollback only after its replacement journal is durable.
    persist(next, nextBases)
    pending.splice(0, pending.length, ...next)
    bases.clear(); for (const [id, base] of nextBases) bases.set(id, base)
    undo.set(entry.boardId, nextUndo.get(entry.boardId)); redo.set(entry.boardId, nextRedo.get(entry.boardId))
    replace(board)
    for (const item of rejected) item.reject(error)
    status(); changed(null, true)
    report('操作未保存，已撤销无效修改' + (rejected.length > 1 ? '及依赖它的 ' + (rejected.length - 1) + ' 项操作' : '') + '：' + error.message)
  }
  function pump() {
    if (sending || failure || stopped || discarding || !pending.length) return sending
    sending = (async () => {
      while (pending.length && !stopped && !discarding) {
        const entry = pending[0]
        try {
          const input = { requestId: entry.id, boardId: entry.boardId, revision: entry.revision, operations: entry.operations }
          let response
          try {
            try { response = await api('/edit', input) }
            catch (error) {
              // An interrupted response may already be committed. Retry the SAME ID.
              if (error.status || stopped) throw error
              response = await api('/edit', input)
            }
          }
          catch (error) {
            if (error.status !== 400) throw error
            rejectInvalid(entry, error)
            continue
          }
          const remaining = pending.slice(1), nextBases = new Map(bases)
          // The displayed board may contain an in-progress pointer preview. Only
          // acknowledged operations belong in the recovery base. Persist before
          // removing the entry so a storage failure can safely retry the same ID.
          if (remaining.some(item => item.boardId === entry.boardId)) nextBases.set(entry.boardId, applyOperations(bases.get(entry.boardId), entry.operations, state().assets, types).board)
          else nextBases.delete(entry.boardId)
          persist(remaining, nextBases)
          pending.shift(); bases.clear(); for (const [id, base] of nextBases) bases.set(id, base)
          // Only merge resolver output for nodes that have not changed since send.
          // Never replace coordinates: a pointer gesture may be in progress.
          const live = state().boards.find(board => board.id === entry.boardId)
          let resolvedChanged = false
          if (live && live.revision === response.board.revision) {
            for (const node of live.nodes) {
              const canonical = response.board.nodes.find(item => item.id === node.id)
              if (!canonical || JSON.stringify(node.resolvedOutput) === JSON.stringify(canonical.resolvedOutput)) continue
              if (canonical.resolvedOutput) node.resolvedOutput = copy(canonical.resolvedOutput); else delete node.resolvedOutput
              resolvedChanged = true
            }
          }
          status()
          if (resolvedChanged && !busy()) changed(null, true)
          entry.resolve({ ...response, inverse: entry.result.inverse })
        } catch (error) {
          failure = error
          for (const item of pending) item.reject(error)
          status(); report('保存失败，本地修改已保留：' + error.message)
          break
        }
      }
    })().finally(() => { sending = null; if (pending.length && !failure && !stopped && !discarding) void pump() })
    return sending
  }
  function edit(operations, { targetBoard, expectedRevision, history = true, repaint = true, waitForSave = true, historyDirection } = {}) {
    if (stopped || discarding) throw Error('画布正在退出')
    if (recoveryBlocked) throw failure
    const before = state().boards.find(board => board.id === targetBoard)
    if (!before) throw Error('画板不存在')
    if (expectedRevision !== undefined && expectedRevision !== before.revision) throw Error('画布已变化，请重新读取')
    const frozen = copy(operations), result = apply(before, frozen)
    const entry = { id: crypto.randomUUID(), boardId: before.id, revision: before.revision, operations: frozen, result, history, historyDirection }
    completion(entry)
    if (!bases.has(before.id)) bases.set(before.id, copy(before))
    pending.push(entry)
    try { persist() } catch (error) { pending.pop(); if (!pending.some(item => item.boardId === before.id)) bases.delete(before.id); throw Error('无法保留未保存修改：' + error.message) }
    replace(result.board)
    recordHistory(entry)
    status(); if (repaint) changed(null, true)
    if (failure) entry.reject(failure); else void pump()
    return waitForSave ? entry.saved : Promise.resolve(result)
  }
  async function flush() {
    if (failure) throw failure
    while (pending.length) {
      if (failure) throw failure
      if (stopped) throw Error('画布已退出，修改尚未保存')
      await pump()
    }
  }
  // Keep recovery data even when it cannot be replayed against this installation.
  try {
    recoveryLog = storage.getItem(STORAGE)
    const saved = JSON.parse(recoveryLog || 'null')
    if (saved?.version === 1 && saved.entries?.length) {
      const recovered = new Map(saved.bases.map(board => [board.id, copy(board)]))
      const restored = []
      for (const item of saved.entries) {
        if (!state().boards.some(board => board.id === item.boardId) || !recovered.has(item.boardId)) throw Error('未保存修改所属画板不存在')
        const result = apply(recovered.get(item.boardId), item.operations), entry = { ...item, result, history: false }
        recordHistory(entry)
        recovered.set(item.boardId, result.board); completion(entry); restored.push(entry)
      }
      for (const board of saved.bases) bases.set(board.id, board)
      pending.push(...restored)
      for (const board of recovered.values()) replace(board)
      failure = Error('已恢复未保存修改，请重试保存；若有版本冲突，可导出修改后载入最新画板')
    }
    recoveryLog = undefined
  } catch (error) { recoveryBlocked = true; failure = Error('未保存修改恢复失败，请导出修改或恢复对应插件；放弃修改后才能继续编辑：' + error.message) }
  return {
    edit, flush, snapshot,
    get dirty() { return pending.length > 0 || !!failure },
    get error() { return failure?.message || null },
    get count() { return pending.length },
    async retry() {
      if (sending) await sending
      if (!pending.length && failure) throw failure
      failure = null; for (const entry of pending) completion(entry); status(); await flush()
    },
    async discard() {
      discarding = true
      try {
        if (sending) await sending
        storage.removeItem(STORAGE)
        for (const entry of pending) entry.reject(Error('未保存修改已放弃'))
        pending.length = 0; bases.clear(); undo.clear(); redo.clear(); failure = null; recoveryBlocked = false; recoveryLog = undefined; status()
      } finally { discarding = false }
    },
    stop() { stopped = true },
  }
}
