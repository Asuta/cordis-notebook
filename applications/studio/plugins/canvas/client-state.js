import { createHash } from 'node:crypto'

export function clientStateRevision(store, snapshots) {
  // Include plugin/config changes too. A fresh store instance invalidates clients
  // after a backend restart, even when its in-memory counter starts over.
  return createHash('sha256').update(JSON.stringify([store.revision?.(), store.types.list().map(({ id, label, fields, accepts, output }) => ({ id, label, fields, accepts, output })), snapshots.list().map(item => [item.id, item.revision ? item.revision() : item.read()])])).digest('hex')
}

export function serializeClientBoard(board, types) {
  const result = structuredClone(board)
  for (const node of result.nodes) {
    delete node.resolvedOutput
    const type = types.get(node.type)
    if (!type?.resolve) continue
    let value
    try { value = type.resolve(structuredClone(node)) } catch { continue }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const output = {}
    if (typeof value.text === 'string') output.text = value.text
    if (typeof value.assetId === 'string') output.assetId = value.assetId
    if (value.kind === 'image' || value.kind === 'video') output.kind = value.kind
    if (Object.keys(output).length) node.resolvedOutput = output
  }
  return result
}

export function serializeClientState(store, snapshots) {
  const state = {
    ...store.read(),
    ...Object.assign({}, ...snapshots.list().map(item => item.read())),
    types: store.types.list().map(({ id, label, fields, accepts, output, defaults }) => ({ id, label, fields, accepts, output, defaults: defaults() })),
    stateRevision: clientStateRevision(store, snapshots),
  }
  state.boards = state.boards.map(board => serializeClientBoard(board, store.types))
  return state
}
