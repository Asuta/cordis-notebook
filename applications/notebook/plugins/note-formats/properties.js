export const propertyDefaults = { status: 'todo', tags: [], date: null }
export function normalizeProperties(input = {}, existing = propertyDefaults) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['status', 'tags', 'date'].includes(key))) throw Error('页面属性仅支持状态、标签和日期')
  const result = { ...propertyDefaults, ...existing, ...input }
  if (!['todo', 'doing', 'done'].includes(result.status)) throw Error('状态必须为 todo、doing 或 done')
  if (!Array.isArray(result.tags) || result.tags.length > 20 || result.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) throw Error('最多 20 个标签，每个 1–40 字符')
  result.tags = [...new Set(result.tags.map(tag => tag.trim()))]
  if (result.date !== null && (typeof result.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(result.date) || Number.isNaN(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0, 10) !== result.date)) throw Error('日期必须是真实的 YYYY-MM-DD 日期或 null')
  return result
}
