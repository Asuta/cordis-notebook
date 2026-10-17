import { randomUUID } from 'node:crypto'

const RESULT_WIDTH = 288, RESULT_GAP = 18, PENDING_RESULT_HEIGHT = 360
const nodeHeight = node => node.cardHeight || (node.type === 'generator' ? 820 : node.type === 'text' ? 230 : node.sourceNodeId ? node.assetId ? node.type === 'video' ? 420 : 400 : PENDING_RESULT_HEIGHT : 480)

// Reserve a real card in the same transaction as the task, so refresh and
// out-of-order completion never move one task into another task's frame.
export function resultPosition(board, source) {
  const x = source.x + 360 <= 99000 ? source.x + 360 : source.x - 360
  let y = source.y
  for (let i = 0; i <= board.nodes.length; i++) {
    if (y < -99500 || y > 99500) break
    const blockers = board.nodes.filter(node =>
      x < node.x + RESULT_WIDTH + RESULT_GAP && x + RESULT_WIDTH + RESULT_GAP > node.x &&
      y < node.y + nodeHeight(node) + RESULT_GAP && y + PENDING_RESULT_HEIGHT + RESULT_GAP > node.y)
    if (!blockers.length) return { x, y }
    const next = Math.max(...blockers.map(node => node.y + nodeHeight(node) + RESULT_GAP))
    if (next <= y) break
    y = next
  }
  throw Error('没有足够空间放置生成结果，请整理画板后重试')
}
export function reserveResult(tx, job) {
  if (job.resultNodeId) return
  const board = tx.board(job.boardId), source = board?.nodes.find(node => node.id === job.nodeId)
  if (!source || board.nodes.length >= 500) return
  job.resultNodeId = randomUUID()
  const count = board.nodes.filter(node => node.sourceNodeId === source.id).length
  const outputKind = job.outputKind || 'image'
  tx.edit(board.id, [{ type: 'add', node: { id: job.resultNodeId, type: outputKind, title: `生成结果 ${count + 1}`, ...resultPosition(board, source), sourceNodeId: source.id, jobId: job.id } }])
}
export function completeResults(tx, job, outputs, assetIds) {
  let board = tx.board(job.boardId)
  const source = board?.nodes.find(node => node.id === job.nodeId), frame = board?.nodes.find(node => node.id === job.resultNodeId && node.jobId === job.id)
  if (!source || job.resultNodeId && !frame) { job.error = '生成卡片或结果框已删除，结果保留在素材库'; return }
  let placed = 0
  for (const [index, output] of outputs.entries()) {
    board = tx.board(job.boardId)
    if (index === 0 && frame) {
      if (frame.type === output.kind) tx.edit(board.id, [{ type: 'update', id: frame.id, patch: { assetId: assetIds[index] } }])
      else {
        const edges = board.edges.filter(edge => edge.from === frame.id || edge.to === frame.id)
        tx.edit(board.id, [{ type: 'remove', ids: [frame.id] }, { type: 'add', node: { ...frame, type: output.kind, assetId: assetIds[index] } }, ...(edges.length ? [{ type: 'restore', nodes: [], edges }] : [])])
      }
    } else {
      if (board.nodes.length >= 500) break
      const count = board.nodes.filter(node => node.sourceNodeId === source.id).length
      tx.edit(board.id, [{ type: 'add', node: { id: randomUUID(), type: output.kind, assetId: assetIds[index], title: `生成结果 ${count + 1}`, ...resultPosition(board, source), sourceNodeId: source.id, jobId: job.id } }])
    }
    placed++
  }
  if (placed < outputs.length) job.error = '画板卡片已满，其余结果保留在素材库'
}
