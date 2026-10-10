export const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
export function string(value, max, label) {
  if (typeof value !== 'string' || value.length > max) invalid(label + '格式无效')
  return value
}
export function validateBoard(board, assets, types) {
  string(board.title, 120, '画板名称')
  if (!Array.isArray(board.nodes) || board.nodes.length > 500 || !Array.isArray(board.edges) || board.edges.length > 1500) invalid('画板最多 500 张卡片、1500 条连线')
  const ids = new Set()
  for (const node of board.nodes) {
    if (!/^[\w-]{1,80}$/.test(node.id) || ids.has(node.id)) invalid('卡片 ID 无效或重复')
    ids.add(node.id)
    if (typeof node.type !== 'string' || !/^[a-z][a-z0-9-]*$/.test(node.type)) invalid('卡片类型无效')
    for (const coordinate of [node.x, node.y]) if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 100000) invalid('卡片坐标无效')
    string(node.title, 120, '卡片标题')
    types?.get(node.type)?.validate(node, assets)
  }
  const edgeIds = new Set(), pairs = new Set()
  for (const edge of board.edges) {
    const from = board.nodes.find(node => node.id === edge.from), to = board.nodes.find(node => node.id === edge.to)
    if (!/^[\w-]{1,80}$/.test(edge.id) || edgeIds.has(edge.id) || pairs.has(edge.from + ':' + edge.to)) invalid('连线重复或 ID 无效')
    if (!from || !to) invalid('连线端点不存在')
    edgeIds.add(edge.id); pairs.add(edge.from + ':' + edge.to)
  }
  const v = board.viewport
  if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || Math.abs(v.x) > 100000 || Math.abs(v.y) > 100000 || !Number.isFinite(v.zoom) || v.zoom < .15 || v.zoom > 3) invalid('画布视角无效')
  return board
}
// Inverse operations carry preconditions checked inside the store transaction.
// Only compare the data the inverse can overwrite or remove, not revision or
// unrelated fields (e.g. moving a card must not prevent undoing its text).
function historyState(board, op) {
  const node = id => board.nodes.find(n => n.id === id) || null
  switch (op.type) {
    case 'update': {
      const current = node(op.id)
      return current && { type: current.type, fields: Object.fromEntries([...Object.keys(op.patch), ...(op.unset || [])].map(key => [key, current[key]])) }
    }
    case 'remove': return { nodes: op.ids.map(node), edges: board.edges.filter(e => op.ids.includes(e.from) || op.ids.includes(e.to)) }
    case 'restore': return { nodes: board.nodes.map(n => ({ id: n.id, type: n.type })), edges: board.edges }
    case 'connect': return { edges: board.edges, from: node(op.from)?.type ?? null, to: node(op.to)?.type ?? null }
    case 'disconnect': return board.edges.find(e => e.id === op.id) || null
    case 'reorder': return board.edges.filter(e => e.to === op.id)
    case 'rename': return board.title
    case 'viewport': return board.viewport
  }
}
function insertItems(list, items, positions) {
  if (positions === undefined) { list.push(...structuredClone(items)); return }
  if (!Array.isArray(positions) || positions.length !== items.length) invalid('恢复位置无效')
  for (let i = 0; i < items.length; i++) {
    const index = positions[i]
    if (!Number.isInteger(index) || index < 0 || index > list.length || (i > 0 && index <= positions[i - 1])) invalid('恢复位置无效')
    list.splice(index, 0, structuredClone(items[i]))
  }
}
export function applyOperation(board, operation, assets, types) {
  const next = structuredClone(board), op = operation || {}
  if (Object.hasOwn(op, 'expected') && JSON.stringify(historyState(board, op)) !== JSON.stringify(op.expected)) {
    throw Object.assign(Error('撤销或重做冲突：相关内容已被其他页面或后续操作修改，本次操作未写入'), { status: 409 })
  }
  let inverse
  switch (op.type) {
    case 'add': {
      const n = op.node || {}, definition = types.require(n.type)
      const defaults = definition.defaults()
      if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults) || Object.keys(defaults).some(key => !definition.fields.includes(key))) invalid('卡片默认值包含未声明字段')
      const node = { id: n.id, type: n.type, x: n.x ?? 80, y: n.y ?? 80, title: n.title ?? definition.label, ...structuredClone(defaults) }
      for (const key of definition.fields) if (Object.hasOwn(n, key)) node[key] = structuredClone(n[key])
      for (const key of ['sourceNodeId', 'jobId']) if (Object.hasOwn(n, key)) { string(n[key], 80, '来源标记'); node[key] = n[key] }
      next.nodes.push(node); inverse = { type: 'remove', ids: [node.id] }; break
    }
    case 'update': {
      const node = next.nodes.find(item => item.id === op.id)
      if (!node) invalid('卡片不存在')
      const allowed = ['x', 'y', 'title', ...(types.get(node.type)?.fields || [])]
      const unset = op.unset ?? []
      if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch) || !Array.isArray(unset) || new Set(unset).size !== unset.length || unset.some(key => Object.hasOwn(op.patch, key)) || [...Object.keys(op.patch), ...unset].some(key => !allowed.includes(key))) invalid('不能修改这些卡片字段')
      const keys = [...Object.keys(op.patch), ...unset]
      // Missing fields must survive JSON transport in undo/redo requests.
      inverse = { type: 'update', id: node.id, patch: Object.fromEntries(keys.filter(key => node[key] !== undefined).map(key => [key, node[key]])) }
      const missing = keys.filter(key => node[key] === undefined)
      if (missing.length) inverse.unset = missing
      Object.assign(node, op.patch)
      for (const key of unset) delete node[key]
      break
    }
    case 'remove': {
      if (!Array.isArray(op.ids) || !op.ids.length || op.ids.some(id => !next.nodes.some(n => n.id === id))) invalid('请选择存在的卡片')
      const nodes = next.nodes.filter(n => op.ids.includes(n.id)), edges = next.edges.filter(e => op.ids.includes(e.from) || op.ids.includes(e.to))
      const nodePositions = nodes.map(n => next.nodes.indexOf(n)), edgePositions = edges.map(e => next.edges.indexOf(e))
      next.nodes = next.nodes.filter(n => !op.ids.includes(n.id)); next.edges = next.edges.filter(e => !edges.includes(e))
      inverse = { type: 'restore', nodes, edges, nodePositions, edgePositions }; break
    }
    case 'restore':
      if (!Array.isArray(op.nodes) || !Array.isArray(op.edges)) invalid('恢复内容无效')
      insertItems(next.nodes, op.nodes, op.nodePositions); insertItems(next.edges, op.edges, op.edgePositions)
      inverse = { type: 'remove', ids: op.nodes.map(n => n.id) }; break
    case 'connect': {
      const from = next.nodes.find(n => n.id === op.from), to = next.nodes.find(n => n.id === op.to)
      // A history restore may preserve edges whose provider is temporarily absent.
      if (!op.expected || (types.get(from?.type) && types.get(to?.type))) {
        if (!from || !to || !types.require(to.type).accepts?.includes(types.require(from.type).output)) invalid('只能连接兼容的卡片输入与输出')
      }
      insertItems(next.edges, [{ id: op.id, from: op.from, to: op.to }], op.index === undefined ? undefined : [op.index]); inverse = { type: 'disconnect', id: op.id }; break
    }
    case 'disconnect': {
      const index = next.edges.findIndex(edge => edge.id === op.id)
      if (index < 0) invalid('连线不存在')
      const [edge] = next.edges.splice(index, 1); inverse = { type: 'connect', ...edge, index }; break
    }
    case 'reorder': {
      const incoming = next.edges.filter(edge => edge.to === op.id)
      if (!Array.isArray(op.edges) || op.edges.length !== incoming.length || new Set(op.edges).size !== incoming.length || op.edges.some(id => !incoming.some(e => e.id === id))) invalid('输入顺序无效')
      inverse = { type: 'reorder', id: op.id, edges: incoming.map(e => e.id) }
      next.edges = [...next.edges.filter(e => e.to !== op.id), ...op.edges.map(id => incoming.find(e => e.id === id))]; break
    }
    case 'rename': inverse = { type: 'rename', title: next.title }; next.title = op.title; break
    case 'viewport': inverse = { type: 'viewport', viewport: next.viewport }; next.viewport = structuredClone(op.viewport); break
    default: invalid('未知画布操作')
  }
  validateBoard(next, assets, types)
  next.revision++
  inverse.expected = structuredClone(historyState(next, inverse))
  return { board: next, inverse }
}
