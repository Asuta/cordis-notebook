import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defaultPluginDirectory } from './application-discovery.js'
import { normalizeConfig } from '../shared/config-schema.js'
import { configBinding } from '../shared/config-binding.js'

export const defaultPluginsDir = await defaultPluginDirectory().catch(() => undefined)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const invalid = message => { throw new Error(message) }
export const inside = (root, path) => path.startsWith(root + sep)
export function relativePath(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-][a-zA-Z0-9_./-]*$/.test(value)
    && value.split('/').every(part => part && !part.startsWith('.') && !/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part))
}
export async function containedFile(root, name) {
  if (!relativePath(name)) invalid(`非法文件路径：${name}`)
  const target = await realpath(resolve(root, name)).catch(() => invalid(`文件不存在：${name}`))
  if (!inside(await realpath(root), target) || !(await stat(target)).isFile()) invalid(`文件超出插件目录或不是普通文件：${name}`)
  return target
}
function names(value, label) {
  if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !/^[a-zA-Z][\w.-]*$/.test(name)) || new Set(value).size !== value.length) invalid(`${label} 必须是无重复的名称数组`)
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${label} 未知字段：${key}`)
}
async function readPlugin(root, mode) {
  const pkg = JSON.parse(await readFile(await containedFile(root, 'package.json'), 'utf8'))
  const m = pkg.cordis
  if (!object(m)) invalid('缺少 cordis 清单')
  keys(m, ['schemaVersion','id','name','description','order','defaultEnabled','client','server','requires','provides','public','build','settings','exclusiveGroup','groupLabel','swatch','runtimePackages','category','icon','styles'], 'cordis')
  if (m.schemaVersion !== 1) invalid('仅支持 cordis.schemaVersion 1')
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(m.id || '') || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) invalid('插件 ID 或名称无效')
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name || '') || pkg.type !== 'module' || !/^\d+\.\d+\.\d+$/.test(pkg.version || '')) invalid('包名称、版本或 ESM 类型无效')
  if (pkg.dependencies !== undefined && (!object(pkg.dependencies) || Object.values(pkg.dependencies).some(value => typeof value !== 'string' || !value))) invalid('dependencies 必须是版本字符串映射')
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') invalid('defaultEnabled 必须是布尔值')
  if (m.order !== undefined && !Number.isFinite(m.order)) invalid('order 必须是数字')
  if (m.description !== undefined && typeof m.description !== 'string') invalid('description 必须是文本')
  for (const field of ['requires','provides']) {
    if (!object(m[field])) invalid(`${field} 必须声明 client 和 server`)
    keys(m[field], ['client','server'], field)
    for (const side of ['client','server']) names(m[field][side], `${field}.${side}`)
  }
  if (!m.client && !m.server) invalid('至少声明一个前端或后端入口')
  if (m.client && (!relativePath(m.client) || !m.client.endsWith('.js'))) invalid('client 必须是 dist 中的 JS 入口')
  if (m.server) {
    if (!object(m.server)) invalid('server 必须声明 entry 和 export')
    keys(m.server, ['entry','export'], 'server')
    if (!relativePath(m.server.entry) || !m.server.entry.endsWith('.js') || !/^[a-zA-Z_$][\w$]*$/.test(m.server.export || '')) invalid('server 入口或导出名无效')
  }
  if ((mode === 'build' || m.build !== undefined) && !Array.isArray(m.build) || !Array.isArray(m.public)) invalid('build 和 public 必须是数组')
  const outputs = new Map()
  for (const task of m.build || []) {
    if (!object(task)) invalid('构建任务必须是对象')
    keys(task, ['type','input','output','platform','minify','jsx'], 'build')
    if (!['bundle','copy','tailwind'].includes(task.type)) invalid(`未知构建方式：${task.type}`)
    if (!relativePath(task.input) || task.input.split('/').some(p => ['dist','node_modules'].includes(p)) || !relativePath(task.output)) invalid('构建输入或输出路径无效')
    if (outputs.has(task.output.toLowerCase())) invalid(`重复构建输出：${task.output}`)
    if (task.type === 'bundle') {
      if (!['browser','node'].includes(task.platform) || !/\.[cm]?[jt]sx?$/.test(task.input) || !task.output.endsWith('.js')) invalid('bundle 需要有效输入、JS 输出及 browser/node 平台')
      if (task.minify !== undefined && typeof task.minify !== 'boolean') invalid('minify 必须是布尔值')
      if (task.jsx && (!object(task.jsx) || !/^[\w.$]+$/.test(task.jsx.factory || '') || !/^[\w.$]+$/.test(task.jsx.fragment || ''))) invalid('jsx 编译声明无效')
    } else if (task.platform || task.jsx || task.minify !== undefined) invalid('平台和 JSX/minify 选项仅用于 bundle')
    if (task.type === 'tailwind' && (!task.input.endsWith('.css') || !task.output.endsWith('.css'))) invalid('tailwind 需要 CSS 输入输出')
    if (task.type === 'copy' && [task.input,task.output].some(path => /\.[cm]?[jt]sx?$/.test(path))) invalid('JS/TS 代码请使用 bundle，copy 仅用于静态资源')
    if (mode !== 'runtime') await containedFile(root, task.input)
    outputs.set(task.output.toLowerCase(), task)
  }
  const published = new Set()
  for (const name of m.public) {
    if (!relativePath(name) || published.has(name.toLowerCase())) invalid(`非法或重复公开资源：${name}`)
    const task = outputs.get(name.toLowerCase())
    if (task?.platform === 'node' || mode !== 'runtime' && (!task || task.output !== name)) invalid(`公开资源没有对应浏览器构建任务：${name}`)
    if (m.server?.entry.toLowerCase() === name.toLowerCase()) invalid('后端入口不能公开')
    if (mode === 'runtime') await containedFile(resolve(root,'dist'), name)
    published.add(name.toLowerCase())
  }
  if (m.client && !m.public.includes(m.client)) invalid('client 入口必须在 public 中')
  if (m.server && mode !== 'runtime' && outputs.get(m.server.entry.toLowerCase())?.platform !== 'node') invalid('server 入口必须来自 node 构建任务')
  if (m.server && mode !== 'build') await containedFile(resolve(root,'dist'), m.server.entry)
  if (m.styles !== undefined && (!Array.isArray(m.styles) || m.styles.length && !m.client || new Set(m.styles).size !== m.styles.length || m.styles.some(name => typeof name !== 'string' || !name.endsWith('.css') || !m.public.includes(name)))) invalid('styles 必须是公开 CSS 资源数组，且有 client 入口')
  if (m.category !== undefined) {
    if (!object(m.category) || !/^[a-z][a-z0-9-]*$/.test(m.category.id || '') || ['all','dependencies'].includes(m.category.id) || typeof m.category.label !== 'string' || !m.category.label.trim()) invalid('category 需要有效 id 和 label')
    keys(m.category, ['id','label'], 'category')
  }
  if (m.icon !== undefined && (typeof m.icon !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(m.icon))) invalid('icon 必须是图标名称')
  if (m.settings) {
    if (!object(m.settings) || !['live','restart'].includes(m.settings.mode) || !object(m.settings.fields)) invalid('settings 需要 live/restart 模式和 fields')
    for (const field of Object.values(m.settings.fields)) if (!object(field) || !['string','number','boolean'].includes(field.type) || typeof field.label !== 'string') invalid('settings 字段无效')
    normalizeConfig(m.settings)
  }
  for (const field of ['exclusiveGroup','groupLabel','swatch']) if (m[field] !== undefined && (typeof m[field] !== 'string' || !m[field])) invalid(`${field} 必须是非空文本`)
  if (m.runtimePackages !== undefined && (!Array.isArray(m.runtimePackages) || m.runtimePackages.some(name => !Object.hasOwn(pkg.dependencies || {}, name)))) invalid('runtimePackages 必须引用本包的 dependencies')
  const { client = null, server, requires, provides, settings, exclusiveGroup, groupLabel, swatch } = m
  const manifest = { id:m.id, name:m.name, description:m.description || '', version:pkg.version, schemaVersion:m.schemaVersion,
    packageDependencies:pkg.dependencies || {}, client, requires, provides,
    styles:m.styles || [], category:m.category || {id:'features',label:'功能'}, icon:m.icon || 'Puzzle',
    ...(settings ? {settings} : {}), ...(exclusiveGroup ? {exclusiveGroup,groupLabel,swatch} : {}) }
  return { manifest, package:pkg, sourceRoot:root, assetRoot:resolve(root,'dist'), clientAssets:m.public,
    serverEntry:server, defaultEnabled:m.defaultEnabled !== false, order:m.order ?? 1000,
    server:server ? { inject:requires.server, async apply(ctx, activation) {
      const path = await containedFile(resolve(root,'dist'), server.entry)
      const plugin = (await import(pathToFileURL(path).href))[server.export]
      const apply = typeof plugin === 'function' ? plugin : plugin?.apply
      if (typeof apply !== 'function') invalid(`${m.id} 后端导出 ${server.export} 不是插件入口`)
      if (plugin.inject && JSON.stringify([...plugin.inject].sort()) !== JSON.stringify([...requires.server].sort())) invalid(`${m.id} 后端 inject 与清单 requires.server 不一致`)
      const binding = configBinding(ctx, activation.settings)
      activation.bind?.(binding)
      const runtime = Object.freeze({ ...activation.runtime, get config() { return binding.value }, onConfig: callback => binding.onChange(callback) })
      return apply.call(plugin, ctx, binding.value, runtime)
    }} : undefined }
}

/** Read JSON and validate paths; never import any plugin implementation. */
export async function discoverBuiltins(directory = defaultPluginsDir, { mode = 'build' } = {}) {
  if (!['build','runtime','development'].includes(mode)) invalid('未知发现模式')
  const root = await realpath(directory), entries = [], ids = new Set(), packages = new Set(), owners = new Map()
  for (const folder of (await readdir(root, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (folder.name.startsWith('.') || folder.name === 'node_modules') continue
    if (folder.isSymbolicLink()) invalid(`插件目录不支持符号链接：${folder.name}`)
    if (!folder.isDirectory()) continue
    let entry
    try { entry = await readPlugin(resolve(root,folder.name), mode) }
    catch (error) { throw new Error(`插件 ${folder.name} 清单无效：${error.message}`, {cause:error}) }
    if (ids.has(entry.manifest.id) || packages.has(entry.package.name)) invalid(`插件 ID 或包名重复：${entry.manifest.id}`)
    ids.add(entry.manifest.id); packages.add(entry.package.name); entries.push(entry)
    for (const name of entry.package.cordis.runtimePackages || []) {
      if (owners.has(name)) invalid(`共享运行时包重复提供：${name}`)
      owners.set(name, entry.manifest.id)
    }
  }
  const byPackage = new Map(entries.map(item=>[item.package.name,item.manifest.id]))
  for (const entry of entries) {
    for (const [name, version] of Object.entries(entry.package.dependencies || {})) {
      if (mode !== 'runtime' && version.startsWith('workspace:') && name !== '@cordis-notebook/host' && !byPackage.has(name)) invalid(`${entry.manifest.id} 缺少 workspace 包：${name}`)
    }
    entry.runtimeOwners = owners
  }
  return entries.sort((a,b)=>a.order-b.order || a.manifest.id.localeCompare(b.manifest.id))
}
