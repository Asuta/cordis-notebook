import { randomUUID } from 'node:crypto'
import { invalid } from './model.js'

// Ordinary edits keep the whole selection in one undo transaction.
export function copySelection(board, nodeIds, types, assets, { offset = 40, limit = 100 } = {}) {
  if (!Array.isArray(nodeIds) || !nodeIds.length || new Set(nodeIds).size !== nodeIds.length) invalid('请选择要复制的卡片')
  const nodes = nodeIds.map(id => board.nodes.find(node => node.id === id))
  if (nodes.some(node => !node)) invalid('要复制的卡片不存在')
  const ids = new Map(nodes.map(node => [node.id, randomUUID()]))
  const edges = board.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
  const edgeIds = new Map(edges.map(edge => [edge.id, randomUUID()]))
  const context = { board, nodeIds: ids, edgeIds, types, assets }
  const dx = offset ? Math.min(offset, 100000 - Math.max(...nodes.map(node => node.x))) : 0
  const dy = offset ? Math.min(offset, 100000 - Math.max(...nodes.map(node => node.y))) : 0
  const operations = nodes.map(source => {
    const node = types.get(source.type)?.copy?.(structuredClone(source), context) || structuredClone(source)
    delete node.jobId
    if (node.sourceNodeId) { if (ids.has(node.sourceNodeId)) node.sourceNodeId = ids.get(node.sourceNodeId); else delete node.sourceNodeId }
    return { type: 'add', node: { ...node, id: ids.get(source.id), x: source.x + dx, y: source.y + dy } }
  })
  operations.push(...edges.map(edge => ({ type: 'connect', id: edgeIds.get(edge.id), from: ids.get(edge.from), to: ids.get(edge.to) })))
  if (operations.length > limit) invalid(limit === 100 ? '所选卡片和内部连线过多，请分批创建副本' : '画板内容过多，无法创建副本')
  return { operations, nodeIds: [...ids.values()], revision: board.revision }
}
