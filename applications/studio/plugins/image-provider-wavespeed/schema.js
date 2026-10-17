import Ajv from 'ajv'
import Ajv2020 from 'ajv/dist/2020.js'
import Ajv2019 from 'ajv/dist/2019.js'
const invalid = message => { throw Object.assign(Error(message), { status: 400 }) }
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
function mergeParameters(defaults = {}, values = {}) {
  const result = structuredClone(defaults)
  for (const [key, value] of Object.entries(values)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid('参数字段名称无效')
    result[key] = plain(value) && plain(result[key]) ? mergeParameters(result[key], value) : structuredClone(value)
  }
  return result
}
const escape = name => name.replaceAll('~', '~0').replaceAll('/', '~1')
export const pathParts = path => path.slice(1).split('/').map(s => s.replaceAll('~1', '/').replaceAll('~0', '~'))
export function getPath(object, path) { return pathParts(path).reduce((value, part) => value?.[part], object) }
export function setPath(object, path, value) {
  const parts = pathParts(path)
  if (parts.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) invalid('参数字段名称无效')
  let target = object
  for (const part of parts.slice(0, -1)) target = target[part] ||= {}
  target[parts.at(-1)] = value
}
export function expandSchema(schema, root = schema, seen = new Set()) {
  if (!plain(schema)) return {}
  let current = { ...schema }
  if (current.$ref?.startsWith('#/') && !seen.has(current.$ref)) {
    const ref = current.$ref, target = getPath(root, ref.slice(1))
    if (target) { const next = new Set(seen).add(ref); delete current.$ref; current = { ...expandSchema(target, root, next), ...current } }
  }
  if (current.allOf) {
    const all = current.allOf.map(item => expandSchema(item, root, seen))
    current = { ...Object.assign({}, ...all), ...current, properties: Object.assign({}, ...all.map(item => item.properties), current.properties), required: [...new Set([...all.flatMap(item => item.required || []), ...(current.required || [])])] }
    delete current.allOf
  }
  const variants = current.anyOf || current.oneOf
  if (variants?.length) {
    const choices = variants.map(item => expandSchema(item, root, seen)).filter(item => item.type !== 'null')
    if (choices.length === 1) current = { ...choices[0], ...current, type: current.type || choices[0].type }
  }
  return current
}
function kindFor(name, schema) {
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type, item = type === 'array' ? schema.items || {} : schema
  if (item.type && item.type !== 'string') return null
  if (type && !['string', 'array'].includes(type)) return null
  const value = name.toLowerCase(), format = `${item.format || ''} ${item.contentMediaType || ''} ${schema['x-media-type'] || ''}`.toLowerCase()
  if (/video/.test(format) || /^(?:(?:input|source|reference|target)_)?videos?(?:_urls?)?$/.test(value)) return 'video'
  if (/image/.test(format) || /^(?:(?:start|end|first|last|reference|ref|init|initial|input|source|target|control)_)?(?:images?|frames?)(?:_urls?|_?\d+)?$/.test(value) || /^(mask|mask_image|image_mask)(?:_url)?$/.test(value)) return 'image'
  return null
}
const roleName = name => /(^|_)(start|first|initial)(_|$)/i.test(name) ? '首帧' : /(^|_)(end|last)(_|$)/i.test(name) ? '尾帧' : /mask/i.test(name) ? '蒙版' : null
export function describeSchema(raw) {
  const fields = [], mediaFields = [], defaults = {}
  function walk(value, prefix = '', parentRequired = true, depth = 0) {
    const schema = expandSchema(value, raw)
    for (const [name, item] of Object.entries(schema.properties || {})) {
      const resolved = expandSchema(item, raw), path = prefix + '/' + escape(name), required = parentRequired && (schema.required || []).includes(name)
      const type = Array.isArray(resolved.type) ? resolved.type.find(t => t !== 'null') : resolved.type || (resolved.properties ? 'object' : 'string')
      const kind = kindFor(name, { ...resolved, items: expandSchema(resolved.items, raw) })
      if (kind) {
        mediaFields.push({ path, name, label: roleName(name) || resolved.title || name, kind, array: type === 'array', required, min: type === 'array' ? resolved.minItems ?? (required ? 1 : 0) : required ? 1 : 0, max: type === 'array' ? resolved.maxItems ?? 100 : 1, description: resolved.description || '' })
      } else if (type === 'object' && resolved.properties && !resolved.oneOf && !resolved.anyOf && !resolved.additionalProperties && depth < 4) {
        if (Object.hasOwn(resolved, 'default')) setPath(defaults, path, structuredClone(resolved.default))
        walk(resolved, path, required, depth + 1)
      } else {
        fields.push({ path, name, type, required, schema: resolved })
        if (Object.hasOwn(resolved, 'default') && !['enable_sync_mode', 'enable_base64_output'].includes(name)) setPath(defaults, path, structuredClone(resolved.default))
      }
    }
  }
  walk(raw)
  return { fields, mediaFields, defaults }
}
export function outputKind(type) {
  const value = String(type || '').toLowerCase().replaceAll('_', '-'), target = value.includes('-to-') ? value.split('-to-').at(-1) : value
  if (/audio|text|3d/.test(target) && !/image|video/.test(target)) return null
  return /video/.test(target) ? 'video' : /image/.test(target) ? 'image' : null
}
export function normalizeModels(rows) {
  if (!Array.isArray(rows)) throw Error('WaveSpeed 模型目录格式无效')
  const models = new Map()
  for (const row of rows) {
    const id = row.model_id, kind = outputKind(row.type)
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_.:/-]{1,200}$/.test(id) || id.includes('..') || !kind) continue
    let api = row.api_schema
    if (typeof api === 'string') { try { api = JSON.parse(api) } catch { api = null } }
    const endpoint = api?.api_schemas?.find(item => item.type === 'model_run' && String(item.method).toUpperCase() === 'POST')
    let schema = endpoint?.request_schema
    if (typeof schema === 'string') { try { schema = JSON.parse(schema) } catch { schema = null } }
    const path = endpoint?.api_path
    const supported = plain(schema) && typeof path === 'string' && /^\/api\/v3\/[a-zA-Z0-9_./:-]+$/.test(path) && !path.includes('..')
    const model = { id, label: row.name || id, type: String(row.type), description: String(row.description || '').slice(0, 12000), basePrice: typeof row.base_price === 'number' ? row.base_price : null, outputKind: kind, supported: !!supported }
    if (supported) {
      model.path = path; model.schema = { type: 'object', ...schema }
      try { Object.assign(model, describeSchema(model.schema)) } catch { model.supported = false; model.unsupportedReason = '此模型的参数结构无法解析' }
    } else model.unsupportedReason = '目录未提供可调用的 POST 参数定义'
    models.set(id, model)
  }
  return models
}
export function modelSummary({ id, label, type, description, basePrice, outputKind, supported, unsupportedReason }) { return { id, label, type, description, basePrice, outputKind, supported, unsupportedReason } }
export function compileInput(model) {
  const options = { strict: false, allErrors: true, validateFormats: false, allowUnionTypes: true, validateSchema: true }
  const Constructor = /2020-12/.test(model.schema.$schema || '') ? Ajv2020 : /2019-09/.test(model.schema.$schema || '') ? Ajv2019 : Ajv
  try { return new Constructor(options).compile(model.schema) } catch { invalid('此模型包含暂不支持的参数约束，请更换模型或刷新目录') }
}
export function prepareInput(model, input, validate = compileInput(model)) {
  if (!plain(input.parameters || {})) invalid('模型参数必须为对象')
  const parameters = structuredClone(input.parameters || {}), values = mergeParameters(model.defaults, parameters), assignments = new Map()
  // prompt is composed in canvas order; it cannot be overridden by a hidden parameter.
  const prompt = model.fields.find(field => field.path === '/prompt')
  if (prompt) { if (input.prompt.trim() || prompt.required) values.prompt = input.prompt }
  else if (input.prompt.trim()) invalid('此模型没有 prompt 参数，请清空提示词并断开文字输入')
  for (const name of ['enable_sync_mode', 'enable_base64_output']) if (model.schema.properties?.[name]) values[name] = false
  const fields = model.mediaFields
  for (const ref of input.references || []) {
    const binding = input.bindings?.[ref.key], candidates = fields.filter(field => field.kind === ref.kind), field = binding ? candidates.find(field => field.path === binding) : candidates.length === 1 ? candidates[0] : null
    if (!field) invalid(candidates.length ? '请为每份参考素材指定输入位置（如首帧、尾帧）' : `此模型不接受${ref.kind === 'video' ? '视频' : '图片'}参考，请移除或断开对应素材`)
    const list = assignments.get(field.path) || []
    if (list.length >= field.max) invalid(`${field.label} 最多接受 ${field.max} 份素材`)
    if (getPath(parameters, field.path) !== undefined && getPath(parameters, field.path) !== null && getPath(parameters, field.path) !== '') invalid(`${field.label} 已有参数值，请勿同时指定参考素材`)
    list.push(ref); assignments.set(field.path, list)
  }
  const fill = urls => {
    const body = structuredClone(values)
    for (const field of fields) {
      const list = assignments.get(field.path)
      if (list) setPath(body, field.path, field.array ? list.map(ref => urls.get(ref.key)) : urls.get(list[0].key))
    }
    return body
  }
  const preview = fill(new Map((input.references || []).map((ref, index) => [ref.key, `https://media.invalid/${index}.` + (ref.kind === 'video' ? 'mp4' : 'png')])))
  if (!validate(preview)) {
    const errors = validate.errors.slice(0, 6).map(error => `${error.instancePath || '参数'} ${error.keyword === 'required' ? '缺少 ' + error.params.missingProperty : error.message}`).join('；')
    invalid('模型参数不符合要求：' + errors)
  }
  return { fill, preview, parameters: structuredClone(values), bindings: Object.fromEntries([...assignments].flatMap(([path, refs]) => refs.map(ref => [ref.key, path]))) }
}
