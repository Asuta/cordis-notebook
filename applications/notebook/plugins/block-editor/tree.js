export function locate(blocks, id, parent = null) {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.id === id) return { block, siblings: blocks, index, parent }
    const found = locate(block.children, id, block)
    if (found) return found
  }
  return null
}
export function moveBlock(doc, id, targetId, placement) {
  if (id === targetId || !['before', 'after', 'inside'].includes(placement)) return false
  const source = locate(doc.blocks, id), target = locate(doc.blocks, targetId)
  if (!source || !target || locate(source.block.children, targetId)) return false
  source.siblings.splice(source.index, 1)
  if (placement === 'inside') { target.block.children.push(source.block); target.block.collapsed = false }
  else {
    const index = target.siblings.indexOf(target.block)
    target.siblings.splice(index + (placement === 'after' ? 1 : 0), 0, source.block)
  }
  return true
}
export function indentBlock(doc, id, direction) {
  const found = locate(doc.blocks, id)
  if (!found) return false
  if (direction > 0) {
    if (!found.index) return false
    return moveBlock(doc, id, found.siblings[found.index - 1].id, 'inside')
  }
  if (!found.parent) return false
  return moveBlock(doc, id, found.parent.id, 'after')
}
export function cloneBlock(block) {
  const result = structuredClone(block)
  const renew = b => {
    b.id = crypto.randomUUID()
    let count = 0
    const body = elements => elements.forEach(e => { e.id = `${b.id}:${++count}`; if (e.children) body(e.children) })
    body(b.body.elements); b.children.forEach(renew)
  }
  renew(result)
  return result
}
