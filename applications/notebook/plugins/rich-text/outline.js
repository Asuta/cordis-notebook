// Structural list nesting and extra indentation share one outline model.
// Positions always refer to the original ProseMirror document; no content is flattened.
export function outlineEntries(doc) {
  const entries = []
  const visit = (container, start, owner = null) => {
    const group = [], stack = []
    container.forEach((node, offset, index) => {
      const pos = start + offset
      if (container.type.name === 'listItem' && index === 0) return
      if (['bulletList', 'orderedList'].includes(node.type.name)) {
        visit(node, pos + 1, owner)
        // A list is a structural boundary for visually indented paragraphs.
        stack.length = 0
        return
      }
      const indent = node.attrs.indent || 0
      while (stack.length && stack.at(-1).indent >= indent) stack.pop()
      const entry = { node, pos, end: pos + node.nodeSize, index, indent, group,
        parent: stack.at(-1) || owner, header: node, headerPos: pos, ownChildren: [] }
      group.push(entry)
      if (node.type.name === 'listItem') {
        entry.header = node.firstChild
        entry.headerPos = pos + 1
        node.forEach((child, off, i) => { if (i) entry.ownChildren.push({ node: child, pos: pos + 1 + off }) })
      }
      entries.push(entry)
      stack.push(entry)
      if (!node.isLeaf && !node.isTextblock) visit(node, pos + 1, entry)
    })
    const ends = []
    for (let i = group.length - 1; i >= 0; i--) {
      const entry = group[i]
      if (i + 1 < group.length && group[i + 1].index !== entry.index + 1) ends.length = 0
      while (ends.length && group[ends.at(-1)].indent > entry.indent) ends.pop()
      const tail = ends.at(-1) ?? (i + 1 < group.length && group[i + 1].index === entry.index + 1 ? group[i + 1].tail : i + 1)
      entry.tail = tail
      if (tail > i + 1) entry.end = group[tail - 1].end
      entry.hasChildren = entry.ownChildren.length > 0 || tail > i + 1
      Object.defineProperty(entry, 'hidden', { get: () => entry.ownChildren.concat(
        group.slice(i + 1, tail).map(e => ({ node: e.node, pos: e.pos }))) })
      ends.push(i)
    }
  }
  visit(doc, 0)
  return entries
}

export function entryAt(entries, pos) {
  // Use the smallest actual containing node, not its visual descendants.
  return entries.filter(e => pos >= e.pos && pos < e.pos + e.node.nodeSize)
    .sort((a, b) => b.pos - a.pos)[0]
}

export function selectedOutline(entries, selection) {
  const first = entryAt(entries, selection.from)
  let last = entryAt(entries, selection.empty ? selection.to : Math.max(selection.from, selection.to - 1))
  // A range starting at a parent may end inside its descendant. Move the parent subtree.
  while (last && first && (last.group !== first.group || last.indent > first.indent)) last = last.parent
  if (!first || !last || first.group !== last.group || first.parent !== last.parent || first.indent !== last.indent)
    return []
  return first.group.filter(e => e.pos >= first.pos && e.pos <= last.pos &&
    e.parent === first.parent && e.indent === first.indent)
}
