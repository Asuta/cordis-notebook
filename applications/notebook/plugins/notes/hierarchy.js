export function assertHierarchy(notes) {
  const byId = new Map(notes.map(note => [note.id, note]))
  for (const note of notes) {
    const seen = new Set([note.id]); let parentId = note.parentId, depth = 0
    while (parentId != null) {
      if (typeof parentId !== 'string' || !byId.has(parentId)) throw Object.assign(Error('父页面不存在'), { status: 400 })
      if (seen.has(parentId)) throw Object.assign(Error('页面不能移到自身或自己的子页面中'), { status: 400 })
      if (++depth > 12) throw Object.assign(Error('子页面最多嵌套 12 层'), { status: 400 })
      seen.add(parentId); parentId = byId.get(parentId).parentId
    }
  }
}
