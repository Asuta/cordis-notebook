import { randomUUID } from 'node:crypto'

export function loadArchive(stored) {
  if (Array.isArray(stored)) return { notes: stored, archive: { history: [], trash: [] } }
  if (stored?.format !== 'cordis-notebook-store' || stored.version !== 1 || !Array.isArray(stored.notes)
    || !Array.isArray(stored.history) || !Array.isArray(stored.trash)
    || [...stored.history, ...stored.trash].some(entry => !entry?.id || !entry.note?.id || !Number.isSafeInteger(entry.note.revision)))
    throw Error('笔记存储格式无效，原文件已保留')
  return { notes: stored.notes, archive: { history: stored.history, trash: stored.trash } }
}

// Store the previous durable version, including changes made by Agent tools.
// Notes, history and trash commit in one atomic snapshot; a failed write changes none.
export function recordVersions(before, after, archive) {
  const index = new Map(after.map(note => [note.id, note]))
  for (const note of before) {
    const next = index.get(note.id)
    if (!next || next.revision !== note.revision) {
      archive.history.push({ id: randomUUID(), note: structuredClone(note), capturedAt: new Date().toISOString(), reason: next ? '修改' : '删除' })
    }
  }
  const counts = new Map(); let bytes = 0
  archive.history = archive.history.reverse().filter(entry => {
    const count = (counts.get(entry.note.id) || 0) + 1; counts.set(entry.note.id, count)
    const size = Buffer.byteLength(JSON.stringify(entry))
    if (count > 50 || bytes + size > 32 * 1024 * 1024) return false
    bytes += size; return true
  }).reverse()
}
