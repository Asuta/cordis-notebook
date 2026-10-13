export const types = ['paragraph', 'heading', 'bullet', 'number', 'todo', 'toggle', 'quote', 'callout', 'code', 'divider', 'image', 'table']
export const placements = ['before', 'after', 'inside', 'start', 'end']
const fields = ['type', 'text', 'body', 'level', 'checked', 'collapsed']
function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => value[key] === undefined)) throw Error('块操作参数无效或包含未知字段')
}
function id(value) {
  if (typeof value !== 'string' || !/^[\w:-]{1,100}$/.test(value)) throw Error('块 ID 无效')
}
function locate(blocks, target) {
  for (const [index, block] of blocks.entries()) {
    if (block.id === target) return { block, siblings: blocks, index }
    const found = locate(block.children, target)
    if (found) return found
  }
}
function requireBlock(doc, target) {
  id(target)
  const found = locate(doc.blocks, target)
  if (!found) throw Error('块不存在，请重新读取：' + target)
  return found
}
function editBlock(service, block, patch) {
  object(patch, fields)
  if (!Object.keys(patch).length) throw Error('块 patch 不能为空')
  const type = patch.type ?? block.type
  if (!types.includes(type) || patch.type !== undefined && !types.includes(patch.type)) throw Error('不支持的块类型')
  if (patch.text !== undefined && typeof patch.text !== 'string') throw Error('text 必须是字符串')
  if (patch.text !== undefined && patch.body !== undefined) throw Error('text 和 body 不能同时提供')
  if (patch.checked !== undefined && (typeof patch.checked !== 'boolean' || type !== 'todo')) throw Error('checked 仅用于待办块，必须是布尔值')
  if (patch.collapsed !== undefined && (typeof patch.collapsed !== 'boolean' || type !== 'toggle')) throw Error('collapsed 仅用于折叠块，必须是布尔值')
  if (patch.level !== undefined && (type !== 'heading' || !Number.isInteger(patch.level) || patch.level < 1 || patch.level > 3)) throw Error('level 仅用于标题块，范围为 1–3')
  if (patch.type !== undefined && type !== block.type && patch.text === undefined && patch.body === undefined) throw Error('转换块类型时请明确提供 text 或 body，避免丢失正文')
  if (patch.text !== undefined && ['table', 'divider'].includes(type)) throw Error('表格或分割线不能使用 text，请提供 body')
  const next = { ...block, type, checked: type === 'todo' && block.checked, collapsed: type === 'toggle' && block.collapsed }
  if (patch.body !== undefined) next.body = structuredClone(patch.body)
  if (patch.text !== undefined) {
    next.body = service.create(type, patch.text, block.id).body
    // Replacing heading text must not silently reset its existing heading level.
    if (type === 'heading' && block.type === 'heading') next.body.elements[0].level = block.body.elements[0].level
  }
  if (patch.level !== undefined) next.body = { ...next.body, elements: next.body.elements.map((e, index) => index ? e : { ...e, level: patch.level }) }
  for (const key of ['checked', 'collapsed']) if (patch[key] !== undefined) next[key] = patch[key]
  return next
}
function destination(doc, operation) {
  const { placement = 'end', targetId } = operation
  if (!placements.includes(placement)) throw Error('placement 无效')
  if (placement === 'start' || placement === 'end') {
    if (targetId !== undefined) throw Error('start/end 表示页面顶层，不接受 targetId')
    return { siblings: doc.blocks, index: placement === 'start' ? 0 : doc.blocks.length }
  }
  const target = requireBlock(doc, targetId)
  return placement === 'inside'
    ? { siblings: target.block.children, index: target.block.children.length, parent: target.block }
    : { siblings: target.siblings, index: target.index + Number(placement === 'after') }
}

// Work only on a private copy. Invalid operations never partially update the notebook.
export function applyOperations(service, input, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) throw Error('operations 需要 1–100 项')
  let document = service.normalize(input)
  const insertedIds = []
  for (const op of operations) {
    if (op?.op === 'insert') {
      object(op, ['op', 'block', 'targetId', 'placement'], ['block'])
      object(op.block, ['id', ...fields])
      const blockId = op.block.id ?? crypto.randomUUID(), type = op.block.type ?? 'paragraph'
      id(blockId)
      if (locate(document.blocks, blockId)) throw Error('块 ID 重复：' + blockId)
      // A supplied rich body also supports images without inventing a source URL.
      const base = service.create(op.block.body !== undefined ? 'paragraph' : type, type === 'image' ? op.block.text : '', blockId)
      const { id: ignored, ...patch } = op.block
      const block = Object.keys(patch).length ? editBlock(service, base, patch) : base
      const dest = destination(document, op)
      dest.siblings.splice(dest.index, 0, block)
      if (dest.parent) dest.parent.collapsed = false
      insertedIds.push(blockId)
    } else if (op?.op === 'update') {
      object(op, ['op', 'blockId', 'patch'], ['blockId', 'patch'])
      const found = requireBlock(document, op.blockId)
      found.siblings[found.index] = editBlock(service, found.block, op.patch)
    } else if (op?.op === 'remove') {
      object(op, ['op', 'blockId'], ['blockId'])
      const found = requireBlock(document, op.blockId)
      found.siblings.splice(found.index, 1)
    } else if (op?.op === 'move') {
      object(op, ['op', 'blockId', 'targetId', 'placement'], ['blockId', 'placement'])
      const found = requireBlock(document, op.blockId)
      if (op.targetId === op.blockId || locate(found.block.children, op.targetId)) throw Error('不能把块移动到自身或自己的子块中')
      // Resolve after removal so same-parent moves use the final sibling positions.
      found.siblings.splice(found.index, 1)
      const dest = destination(document, op)
      dest.siblings.splice(dest.index, 0, found.block)
      if (dest.parent) dest.parent.collapsed = false
    } else throw Error('未知块操作；支持 insert、update、remove、move')
    document = service.normalize(document)
  }
  // Keep the last empty block stable across editor remounts and subsequent reads.
  if (!document.blocks.length) document.blocks.push(service.create())
  return { document, insertedIds }
}
