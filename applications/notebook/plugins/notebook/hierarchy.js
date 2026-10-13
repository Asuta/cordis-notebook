// Validate the whole proposed tree: moving a parent can also make descendants
// too deep. Both direct edits and draft recovery must use this preflight.
export function validateHierarchy(notes, candidate) {
  const next = new Map(notes.map(note => [note.id, note]))
  next.set(candidate.id, candidate)
  for (const item of next.values()) {
    const seen = new Set([item.id]); let parent = item.parentId, depth = 0
    while (parent != null) {
      if (!next.has(parent)) throw Error('父页面不存在')
      if (seen.has(parent)) throw Error('页面不能移到自身或自己的子页面中')
      if (++depth > 12) throw Error('子页面最多嵌套 12 层')
      seen.add(parent); parent = next.get(parent).parentId
    }
  }
}
