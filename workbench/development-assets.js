import { readFile } from 'node:fs/promises'
import { containedFile, relativePath } from '../server/plugin-discovery.js'

export async function readDevelopmentAsset(app, file) {
  return readFile(await containedFile(app, file), 'utf8')
}
export function developmentParameters(definitions = {}, input = {}, builtins = {}) {
  const values = { ...builtins }
  for (const key of Object.keys(input)) if (!Object.hasOwn(definitions, key) || Object.hasOwn(builtins, key)) throw Error('未知开发参数：' + key)
  for (const [key, definition] of Object.entries(definitions)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || Object.hasOwn(builtins, key)) throw Error('开发参数名称无效：' + key)
    const value = input[key] ?? definition.default
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || definition.pattern && !new RegExp(definition.pattern).test(value)) throw Error('开发参数无效：' + key)
    values[key] = value
  }
  return values
}
// JSON-string placeholders are safe in JS/JSON. Only validated identifiers may
// be interpolated raw (CSS class names); no caller text is executed as a template.
export function renderDevelopmentAsset(text, values) {
  return text.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)(:json)?\}\}/g, (_, key, json) => {
    if (!Object.hasOwn(values, key)) throw Error('缺少模板参数：' + key)
    if (json) return JSON.stringify(values[key])
    if (!/^[a-z][a-z0-9-]{1,49}$/.test(values[key])) throw Error('原样插入只允许应用或插件 ID：' + key)
    return values[key]
  })
}
export async function applicationScaffold(app, file, args, appId) {
  const definition = JSON.parse(await readDevelopmentAsset(app, file))
  const values = developmentParameters(definition.parameters, args.parameters, { id: args.id, name: args.name, appId, description: args.description || '' })
  const files = Object.create(null), entries = Object.entries(definition.files || {})
  if (!entries.length || entries.length > 30) throw Error('模板文件数量无效')
  for (const [target, source] of entries) {
    if (!relativePath(target)) throw Error('模板输出路径无效：' + target)
    files[target] = renderDevelopmentAsset(await readDevelopmentAsset(app, source), values)
  }
  const pkg = JSON.parse(files['package.json'])
  if (pkg.cordis.id !== args.id || pkg.name !== `@cordis-${appId}/${args.id}`) throw Error('模板插件标识不一致')
  pkg.cordis.defaultEnabled = args.defaultEnabled ?? false
  files['package.json'] = JSON.stringify(pkg, null, 2) + '\n'
  return files
}
