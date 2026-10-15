// Shared by the server format validator and the client's databaseSchema service.
export const fieldTypes = ['text', 'number', 'select', 'multiSelect', 'checkbox', 'date', 'url']
export const statuses = [['todo', '未开始'], ['doing', '进行中'], ['done', '已完成']]
const record = value => value && typeof value === 'object' && !Array.isArray(value)
const fail = message => { throw Error(message) }
const keys = (value, allowed, label) => { if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(label + '无效或包含未知字段') }
const name = (value, label) => { if (typeof value !== 'string' || !value.trim() || value.length > 80) fail(label + '需要 1–80 字符'); return value.trim() }
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export const defaultFilter = () => ({ query: '', status: '', tag: '', from: '', to: '', sort: 'updated', direction: 'desc', rules: [] })
export function normalizeFields(input = []) {
  if (!Array.isArray(input) || input.length > 32) fail('最多 32 个自定义字段')
  const ids = new Set(), names = new Set(['名称', '状态', '标签', '日期'])
  return input.map(field => {
    keys(field, ['id', 'name', 'type', 'options'], '字段')
    if (typeof field.id !== 'string' || !/^f_[\w-]{1,80}$/.test(field.id) || ids.has(field.id)) fail('字段 ID 无效或重复')
    ids.add(field.id)
    const label = name(field.name, '字段名称')
    if (names.has(label)) fail('字段名称重复'); names.add(label)
    if (!fieldTypes.includes(field.type)) fail('不支持的字段类型')
    const result = { id: field.id, name: label, type: field.type }
    if (['select', 'multiSelect'].includes(field.type)) {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 50) fail('选择字段需要 1–50 个选项')
      result.options = field.options.map(option => name(option, '选项'))
      if (new Set(result.options).size !== result.options.length) fail('选项不能重复')
    } else if (field.options !== undefined) fail('只有选择字段支持 options')
    return result
  })
}
export function validateValue(field, value) {
  if (value === null || value === undefined) return
  const invalid = () => fail('字段“' + field.name + '”的值不符合 ' + field.type + ' 类型或选项')
  if (field.type === 'number') { if (typeof value !== 'number' || !Number.isFinite(value)) invalid() }
  else if (field.type === 'checkbox') { if (typeof value !== 'boolean') invalid() }
  else if (field.type === 'multiSelect') { if (!Array.isArray(value) || value.length > 50 || new Set(value).size !== value.length || value.some(item => !field.options.includes(item))) invalid() }
  else {
    if (typeof value !== 'string' || value.length > 2000) invalid()
    if (field.type === 'select' && !field.options.includes(value)) invalid()
    if (field.type === 'date' && !validDate(value)) invalid()
    if (field.type === 'url' && value && !/^https?:\/\/[^\s]+$/i.test(value)) invalid()
  }
}
export function normalizeFilter(input = {}, fields = []) {
  keys(input, Object.keys(defaultFilter()), '筛选排序')
  const result = { ...defaultFilter(), ...input }
  for (const key of ['query', 'tag']) if (typeof result[key] !== 'string' || result[key].length > 200) fail('查询或标签过长')
  if (!['', 'todo', 'doing', 'done'].includes(result.status)) fail('筛选状态无效')
  for (const key of ['from', 'to']) if (result[key] !== '' && !validDate(result[key])) fail('筛选日期无效')
  if (result.from && result.to && result.from > result.to) fail('开始日期不能晚于结束日期')
  if (!['updated', 'title', 'date', ...fields.map(field => field.id)].includes(result.sort) || !['asc', 'desc'].includes(result.direction)) fail('排序字段或方向无效')
  if (!Array.isArray(result.rules) || result.rules.length > 20) fail('最多 20 项自定义筛选')
  result.rules = result.rules.map(rule => {
    keys(rule, ['field', 'operator', 'value'], '筛选条件')
    const field = fields.find(field => field.id === rule.field)
    if (!field) fail('筛选引用了不存在的字段')
    const operators = ['empty', 'notEmpty', 'eq', 'neq', ...(['text', 'url', 'multiSelect'].includes(field.type) ? ['contains'] : []), ...(['number', 'date'].includes(field.type) ? ['gt', 'gte', 'lt', 'lte'] : [])]
    if (!operators.includes(rule.operator)) fail('筛选运算不适用于此字段')
    if (!['empty', 'notEmpty'].includes(rule.operator)) {
      if (rule.operator === 'contains' && field.type === 'multiSelect') validateValue({ ...field, type: 'select' }, rule.value)
      else validateValue(field, rule.value)
      if (rule.value === undefined || rule.value === null) fail('此筛选需要比较值')
    }
    return { field: rule.field, operator: rule.operator, ...(!['empty', 'notEmpty'].includes(rule.operator) ? { value: structuredClone(rule.value) } : {}) }
  })
  return result
}
export function normalizeDatabase(input) {
  keys(input, ['version', 'view', 'fields', 'views', 'activeViewId'], '数据库配置')
  if (input.version !== 1 || input.view !== undefined && !['table', 'board'].includes(input.view)) fail('数据库版本或视图无效')
  const fields = normalizeFields(input.fields)
  const views = input.views ?? [{ id: 'table', name: '表格视图', layout: 'table' }, { id: 'board', name: '看板视图', layout: 'board' }]
  if (!Array.isArray(views) || !views.length || views.length > 20) fail('需要保留 1–20 个视图')
  const ids = new Set(), names = new Set()
  const normalized = views.map(view => {
    keys(view, ['id', 'name', 'layout', 'filter'], '视图')
    if (typeof view.id !== 'string' || !/^[\w-]{1,80}$/.test(view.id) || ids.has(view.id)) fail('视图 ID 无效或重复')
    ids.add(view.id)
    const label = name(view.name, '视图名称')
    if (names.has(label)) fail('视图名称重复'); names.add(label)
    if (!['table', 'board'].includes(view.layout)) fail('视图仅支持 table 或 board')
    return { id: view.id, name: label, layout: view.layout, filter: normalizeFilter(view.filter, fields) }
  })
  const activeViewId = input.activeViewId ?? (input.view === 'board' ? 'board' : normalized[0].id)
  const active = normalized.find(view => view.id === activeViewId)
  if (!active) fail('当前视图不存在')
  return { version: 1, view: active.layout, fields, views: normalized, activeViewId }
}
export function validateRows(database, rows) {
  const { fields } = normalizeDatabase(database)
  for (const row of rows) for (const field of fields) validateValue(field, row.properties?.custom?.[field.id])
}
export function fieldValue(row, id) {
  if (id === 'title') return row.title
  if (id === 'updated') return row.updatedAt
  return id.startsWith('f_') ? row.properties?.custom?.[id] : row.properties?.[id]
}
const empty = value => value === undefined || value === null || value === '' || Array.isArray(value) && !value.length
function matches(row, rule) {
  const value = fieldValue(row, rule.field), other = rule.value
  if (rule.operator === 'empty') return empty(value)
  if (rule.operator === 'notEmpty') return !empty(value)
  if (empty(value)) return false
  if (rule.operator === 'eq') return JSON.stringify(value) === JSON.stringify(other)
  if (rule.operator === 'neq') return JSON.stringify(value) !== JSON.stringify(other)
  if (rule.operator === 'contains') return Array.isArray(value) ? value.includes(other) : String(value).toLocaleLowerCase().includes(String(other).toLocaleLowerCase())
  if (rule.operator === 'gt') return value > other
  if (rule.operator === 'gte') return value >= other
  if (rule.operator === 'lt') return value < other
  if (rule.operator === 'lte') return value <= other
  return false
}
export function queryRows(notes, databaseId, filter = {}, fields = []) {
  const f = normalizeFilter({ ...filter, direction: filter.direction || (['title', 'date'].includes(filter.sort) ? 'asc' : 'desc') }, fields)
  const text = f.query.trim().toLocaleLowerCase()
  return notes.filter(note => !note.template && note.parentId === databaseId
    && (!text || (note.title + '\n' + (note.properties?.tags || []).join(' ')).toLocaleLowerCase().includes(text))
    && (!f.status || (note.properties?.status || 'todo') === f.status)
    && (!f.tag || note.properties?.tags?.includes(f.tag))
    && (!f.from || note.properties?.date && note.properties.date >= f.from)
    && (!f.to || note.properties?.date && note.properties.date <= f.to)
    && f.rules.every(rule => matches(note, rule)))
    .sort((a, b) => {
      const av = fieldValue(a, f.sort), bv = fieldValue(b, f.sort)
      if (empty(av) !== empty(bv)) return empty(av) ? 1 : -1
      const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : typeof av === 'boolean' && typeof bv === 'boolean' ? Number(av) - Number(bv) : String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN')
      return order * (f.direction === 'asc' ? 1 : -1) || a.id.localeCompare(b.id)
    })
}
export const databaseSchema = { normalize: normalizeDatabase, filter: normalizeFilter, validateRows, queryRows, fieldTypes, fieldValue, statuses, defaultFilter }
