// Filtered results stay expanded; a result whose parent is filtered out becomes
// a visible root. Selection always reveals its ancestors in the full tree.
export function treeRows(notes, { collapsed = new Set(), selected, filtered = false } = {}) {
  const byId = new Map(notes.map(note => [note.id, note])), children = new Map(), open = new Set()
  for (const note of notes) {
    const parent = byId.has(note.parentId) ? note.parentId : null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(note)
  }
  let parent = byId.get(selected)?.parentId
  while (parent && !open.has(parent)) { open.add(parent); parent = byId.get(parent)?.parentId }
  const rows = [], visited = new Set()
  const visit = (note, depth) => {
    if (visited.has(note.id)) return
    visited.add(note.id)
    const nested = children.get(note.id) || [], expanded = filtered || open.has(note.id) || !collapsed.has(note.id)
    rows.push({ note, depth, hasChildren: nested.length > 0, expanded })
    if (expanded) for (const child of nested) visit(child, depth + 1)
  }
  for (const note of children.get(null) || []) visit(note, 0)
  return rows
}
