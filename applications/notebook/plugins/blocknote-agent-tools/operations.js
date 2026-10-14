const placements = ['start', 'end', 'before', 'after', 'inside']
const object = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('块操作参数无效或包含未知字段')
}
function locate(blocks, id) {
  for (const [index, block] of blocks.entries()) {
    if (block.id === id) return { block, siblings: blocks, index }
    const child = locate(block.children, id)
    if (child) return child
  }
}
function find(document, id) {
  if (typeof id !== 'string') throw Error('请提供块 ID')
  const result = locate(document.blocks, id)
  if (!result) throw Error('块不存在，请重新读取：' + id)
  return result
}
function destination(document, op) {
  const placement = op.placement || 'end'
  if (!placements.includes(placement)) throw Error('placement 无效')
  if (['start', 'end'].includes(placement)) {
    if (op.targetId !== undefined) throw Error('start/end 不接受 targetId')
    return { siblings: document.blocks, index: placement === 'start' ? 0 : document.blocks.length }
  }
  const target = find(document, op.targetId)
  return placement === 'inside' ? { siblings: target.block.children, index: target.block.children.length }
    : { siblings: target.siblings, index: target.index + Number(placement === 'after') }
}
function patchBlock(service, block, patch) {
  object(patch, ['type', 'text', 'content', 'props'])
  if (!Object.keys(patch).length) throw Error('patch 不能为空')
  if ('type' in patch && (typeof patch.type !== 'string' || !patch.type)) throw Error('块类型无效')
  if ('text' in patch && 'content' in patch) throw Error('text 与 content 不能同时提供')
  let next = structuredClone(block)
  if (patch.type && patch.type !== block.type) {
    next = { ...service.create(patch.type, '', block.id), children: next.children }
    if ('content' in next && !('text' in patch) && !('content' in patch)) throw Error('改变为文字或表格类型时请明确提供新正文')
  }
  if ('text' in patch) {
    if (typeof patch.text !== 'string' || ['table', 'image', 'video', 'audio', 'file', 'divider', 'equation', 'tableOfContents'].includes(next.type)) throw Error('text 仅用于文字块；公式使用 props.expression，媒体使用 props.url，表格使用 content')
    next.content = [{ type: 'text', text: patch.text, styles: {} }]
  }
  if ('content' in patch) next.content = structuredClone(patch.content)
  if ('props' in patch) {
    if (!patch.props || typeof patch.props !== 'object' || Array.isArray(patch.props)) throw Error('props 必须是对象')
    next.props = { ...next.props, ...patch.props }
  }
  return next
}
export function applyOperations(service, input, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw Error('operations 需要 1–100 项')
  let document = service.normalize(input)
  const insertedIds = []
  for (const op of operations) {
    if (op?.op === 'insert') {
      object(op, ['op', 'block', 'placement', 'targetId'])
      object(op.block, ['id', 'type', 'text', 'content', 'props'])
      const { id = crypto.randomUUID(), type = 'paragraph', ...patch } = op.block
      const block = Object.keys(patch).length ? patchBlock(service, service.create(type, '', id), patch) : service.create(type, '', id)
      const dest = destination(document, op); dest.siblings.splice(dest.index, 0, block); insertedIds.push(id)
    } else if (op?.op === 'update') {
      object(op, ['op', 'blockId', 'patch'])
      const target = find(document, op.blockId)
      target.siblings[target.index] = patchBlock(service, target.block, op.patch)
    } else if (op?.op === 'remove') {
      object(op, ['op', 'blockId'])
      const target = find(document, op.blockId); target.siblings.splice(target.index, 1)
    } else if (op?.op === 'move') {
      object(op, ['op', 'blockId', 'targetId', 'placement'])
      if (!op.placement) throw Error('移动需要 placement')
      const target = find(document, op.blockId)
      if (op.targetId === op.blockId || locate(target.block.children, op.targetId)) throw Error('不能移到自身或子块中')
      target.siblings.splice(target.index, 1)
      const dest = destination(document, op); dest.siblings.splice(dest.index, 0, target.block)
    } else throw Error('不支持的块操作')
    document = service.normalize(document)
  }
  if (!document.blocks.length) document.blocks.push(service.create())
  return { document, insertedIds }
}
