export const propertyDefaults = { status: 'todo', tags: [], date: null }
export function normalizeProperties(input = {}, existing = propertyDefaults) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['status', 'tags', 'date', 'custom'].includes(key))) throw Error('页面属性仅支持状态、标签、日期和 custom')
  const result = { ...propertyDefaults, ...existing, ...input }
  if (!['todo', 'doing', 'done'].includes(result.status)) throw Error('状态必须为 todo、doing 或 done')
  if (!Array.isArray(result.tags) || result.tags.length > 20 || result.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) throw Error('最多 20 个标签，每个 1–40 字符')
  result.tags = [...new Set(result.tags.map(tag => tag.trim()))]
  if (result.date !== null && (typeof result.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.date) || Number.isNaN(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0, 10) !== result.date)) throw Error('日期必须是真实的 YYYY-MM-DD 日期或 null')
  if ('custom' in input || existing.custom) {
    const value = input.custom ?? {}
    if (!value || typeof value !== 'object' || Array.isArray(value) || ('custom' in input && input.custom === null)) throw Error('自定义属性必须是对象')
    result.custom = { ...existing.custom, ...value }
    if (Object.keys(result.custom).length > 128) throw Error('一篇笔记最多保留 128 个自定义属性')
    for (const [id, entry] of Object.entries(result.custom)) {
      if (!/^f_[\w-]{1,80}$/.test(id)) throw Error('自定义属性 ID 无效')
      if (entry !== null && !(typeof entry === 'boolean' || typeof entry === 'number' && Number.isFinite(entry)
        || typeof entry === 'string' && entry.length <= 2000
        || Array.isArray(entry) && entry.length <= 50 && entry.every(item => typeof item === 'string' && item.length <= 100))) throw Error('自定义属性值无效')
    }
    result.custom = structuredClone(result.custom)
  }
  return result
}
