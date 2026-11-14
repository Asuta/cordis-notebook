import { applyOperation, historyState } from './model.js'

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const clean = board => {
  const result = structuredClone(board)
  for (const node of result.nodes) delete node.resolvedOutput
  return result
}

// Compare the data each operation can overwrite, not the entire board revision.
// Structural operations deliberately keep stricter guards than field updates.
export function rebaseOperations(before, latest, operations, assets, types) {
  let local = clean(before), remote = clean(latest)
  for (const op of operations) {
    if (!equal(historyState(local, op), historyState(remote, op))) {
      const node = before.nodes.find(node => node.id === op.id || op.ids?.includes(node.id))
      const subject = node ? `卡片“${node.title}”` : '画板'
      const names = { x: '位置', y: '位置', title: '名称', text: '正文', prompt: '提示词', frameWidth: '尺寸', frameHeight: '尺寸', mediaWidth: '尺寸', opacity: '透明度' }
      const fields = op.type === 'update' ? `（${[...new Set([...Object.keys(op.patch), ...(op.unset || [])].map(key => names[key] || '卡片内容'))].join('、')}）` : ''
      throw Object.assign(Error(`${subject}${fields}存在冲突：相关内容已被修改或删除，本地修改已保留`), { status: 409, code: 'CANVAS_EDIT_CONFLICT' })
    }
    local = applyOperation(local, op, assets, types, { inPlace: true, validate: false }).board
    remote = applyOperation(remote, op, assets, types, { inPlace: true, validate: false }).board
  }
  return { before: local }
}
