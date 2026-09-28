// Folding follows visible indentation. Lists are formatting wrappers, not scope
// boundaries. Keep this projection separate from structural movement/slicing.
export function foldingEntries(doc) {
  const entries = []
  const scope = (container, start) => {
    const group = [], spans = [], nested = []
    const visit = (node, pos, base) => {
      const span = { node, pos, from: group.length, to: group.length }
      spans.push(span)
      if (['bulletList', 'orderedList'].includes(node.type.name)) {
        node.forEach((child, offset) => visit(child, pos + 1 + offset, base + 1))
      } else {
        const item = node.type.name === 'listItem'
        const header = item ? node.firstChild : node, headerPos = pos + (item ? 1 : 0)
        const indent = base + (node.attrs.indent || 0) + (item ? header.attrs.indent || 0 : 0)
        const entry = { node, pos, header, headerPos, indent, group, index: group.length }
        group.push(entry)
        entries.push(entry)
        if (item) {
          spans.push({ node: header, pos: headerPos, from: entry.index, to: entry.index + 1 })
          node.forEach((child, offset, i) => { if (i) visit(child, pos + 1 + offset, base + (node.attrs.indent || 0)) })
        } else if (!node.isLeaf && !node.isTextblock) nested.push({ node, pos })
      }
      span.to = group.length
    }
    container.forEach((node, offset) => visit(node, start + offset, 0))
    const stack = []
    for (const entry of group) {
      while (stack.length && stack.at(-1).indent >= entry.indent) stack.pop().tail = entry.index
      entry.parent = stack.at(-1) || null
      stack.push(entry)
    }
    for (const entry of stack) entry.tail = group.length
    for (const entry of group) {
      entry.hasChildren = entry.tail > entry.index + 1
      Object.defineProperty(entry, 'hidden', { get() {
        const hidden = []
        let coveredUntil = -1
        for (const span of spans) {
          if (span.pos < coveredUntil || span.from <= entry.index || span.to > entry.tail || span.from === span.to) continue
          hidden.push({ node: span.node, pos: span.pos })
          coveredUntil = span.pos + span.node.nodeSize
        }
        return hidden
      } })
    }
    // Tables/quotes remain independent editing scopes, including their cells.
    for (const { node, pos } of nested) scope(node, pos + 1)
  }
  scope(doc, 0)
  return entries
}
