/** Shared declarative validation for builtin plugin settings. */
export function normalizeConfig(schema, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象')
  const fields = schema.fields
  for (const key of Object.keys(input)) if (!Object.hasOwn(fields, key)) throw new Error('未知配置项：' + key)
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const value = Object.hasOwn(input, key) ? input[key] : field.default
    const invalid = message => { throw new Error(`${field.label}：${message}`) }
    if (typeof value !== field.type) invalid(`需要${{ number: '数字', boolean: '开关值', string: '文本' }[field.type]}`)
    if (field.type === 'number') {
      if (!Number.isFinite(value) || field.integer && !Number.isInteger(value)) invalid('请输入有效整数')
      if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) invalid(`范围为 ${field.min ?? '不限'} 至 ${field.max ?? '不限'}`)
      if (field.step && Math.abs((value - (field.min ?? 0)) / field.step - Math.round((value - (field.min ?? 0)) / field.step)) > 1e-8) invalid(`步长为 ${field.step}`)
    }
    if (field.type === 'string' && field.maxLength && value.length > field.maxLength) invalid(`最多 ${field.maxLength} 个字符`)
    if (field.options && !field.options.some(option => option.value === value)) invalid('请选择有效选项')
    return [key, value]
  }))
}
