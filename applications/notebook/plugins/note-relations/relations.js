export function pageRelations(notes, id, formats) {
  const byId = new Map(notes.map(note => [note.id, note])), note = byId.get(id)
  if (!note) throw Error('页面不存在')
  const summary = note => ({ id: note.id, title: note.title || '无标题笔记', type: note.type, parentId: note.parentId ?? null })
  const ancestors = [], seen = new Set([id])
  let parent = byId.get(note.parentId)
  while (parent && !seen.has(parent.id)) { seen.add(parent.id); ancestors.unshift(summary(parent)); parent = byId.get(parent.parentId) }
  return {
    page: summary(note), ancestors,
    children: notes.filter(item => item.parentId === id).map(summary),
    outgoing: formats.references(note).map(target => byId.has(target) ? summary(byId.get(target)) : { id: target, title: '页面已不存在', missing: true }),
    backlinks: notes.filter(item => formats.references(item).includes(id)).map(summary),
  }
}
export function allowedParents(notes, id) {
  const byId = new Map(notes.map(note => [note.id, note]))
  return notes.filter(note => {
    const seen = new Set(); let current = note
    while (current && !seen.has(current.id)) {
      if (current.id === id) return false
      seen.add(current.id); current = byId.get(current.parentId)
    }
    return true
  })
}
