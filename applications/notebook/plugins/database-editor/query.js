export const statuses = [['todo', '未开始'], ['doing', '进行中'], ['done', '已完成']]
export function queryRows(notes, databaseId, { query = '', status = '', tag = '', from = '', to = '', sort = 'updated' } = {}) {
  const text = query.trim().toLocaleLowerCase()
  return notes.filter(note => note.parentId === databaseId
    && (!text || (note.title + '\n' + (note.properties?.tags || []).join(' ')).toLocaleLowerCase().includes(text))
    && (!status || (note.properties?.status || 'todo') === status)
    && (!tag || note.properties?.tags?.includes(tag))
    && (!from || note.properties?.date && note.properties.date >= from)
    && (!to || note.properties?.date && note.properties.date <= to))
    .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
      : sort === 'date' ? (a.properties?.date || '9999-99-99').localeCompare(b.properties?.date || '9999-99-99') || a.id.localeCompare(b.id)
      : b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
}
