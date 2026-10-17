const plain = value => value && typeof value === 'object' && !Array.isArray(value)
export const pathParts = path => path.slice(1).split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'))
export const getPath = (object, path) => pathParts(path).reduce((value, part) => value?.[part], object)
export function setPath(object, path, value) {
  const parts = pathParts(path)
  if (parts.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw Error('参数字段名称无效')
  let target = object
  for (const part of parts.slice(0, -1)) { if (!plain(target[part])) target[part] = {}; target = target[part] }
  if (value === undefined) delete target[parts.at(-1)]
  else target[parts.at(-1)] = value
}
export function mergeParameters(defaults = {}, values = {}) {
  const result = structuredClone(defaults)
  for (const [key, value] of Object.entries(values)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('参数字段名称无效')
    result[key] = plain(value) && plain(result[key]) ? mergeParameters(result[key], value) : structuredClone(value)
  }
  return result
}
