import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { readdir, readFile, realpath, lstat, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { discoverBuiltins, inside } from '../server/plugin-discovery.js'

const object = properties => Type.Object(properties, { additionalProperties: false })
export const developmentSchemas = {
  workspace_development_info: object({ focus: Type.Optional(Type.Union(['ui', 'backend', 'agent'].map(Type.Literal))) }),
  workspace_scaffold_plugin: object({
    id: Type.String({ pattern: '^[a-z][a-z0-9-]{1,49}$' }), name: Type.String({ minLength: 1, maxLength: 80 }),
    template: Type.String({ minLength: 1, maxLength: 60 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })), defaultEnabled: Type.Optional(Type.Boolean()),
  }),
}
export const developmentTools = [
  ['workspace_development_info', '一次读取绑定应用的真实开发入口：服务提供者、契约正文、相关最小示例、挂载/订阅/释放方式、可用脚手架、验证命令以及实际运行地址、数据目录与启用协议。focus 为 ui（默认）、backend 或 agent；返回的文件带真实路径，不需要再次猜路径或扫描所有插件。', developmentSchemas.workspace_development_info],
  ['workspace_scaffold_plugin', '为绑定应用创建完整可发现的插件骨架。先从 workspace_development_info 选择 template；默认停用，写齐实现和清单并校验后整体发布。拒绝重复 ID、目录或包名，不覆盖已有文件。返回生成文件和下一步；骨架还需实现需求和验证。', developmentSchemas.workspace_scaffold_plugin],
]
export const developmentGuidance = [
  '插件开发先调用 workspace_development_info，按任务选 ui/backend/agent。它已返回契约正文和相关示例；仅为尚未解决的具体问题追加定向读取，不反复读取相同文件或无目标扫描插件。新增插件优先 workspace_scaffold_plugin；需要自建时先写齐实现和构建输入，最后发布清单。',
  '小功能按用户要求实现最小范围；未要求的配置、设置页和额外功能不要顺手增加。契约和最接近示例确认后开始实现，不要求读完整项目。验证选择目标插件；修复实际失败或新增改动后才重跑已通过检查。结束报告依据已有结果，不例行再扫描目录、dist 或重读报告。',
  '启用插件使用开发入口 runtime.activation 的协议或插件管理界面；defaultEnabled 只影响首次登记，不能覆盖已保存的停用状态。只以受管理运行实例返回的数据目录为准，不能假定 root/data，不能直接改状态文件。HTTP 写入前读取最新应用 session 并确认仍是本应用，带 x-application-session；以响应里的 enabled/state/error 判断结果。浏览器验收使用独立实例和数据，不代表用户页面已经启用。',
]
function validate(name, args) {
  if (!Value.Check(developmentSchemas[name], args)) throw Error('开发工具参数无效：' + [...Value.Errors(developmentSchemas[name], args)].slice(0, 3).map(e => e.path + ': ' + e.message).join('；'))
}
async function applicationPaths(root, appId) {
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(appId)) throw Error('应用 ID 无效')
  root = await realpath(root)
  const app = await realpath(join(root, 'applications', appId)), plugins = await realpath(join(app, 'plugins'))
  if (!inside(root, app) || !inside(app, plugins)) throw Error('应用或插件目录超出当前工作区')
  const pkg = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'))
  if (pkg.cordisApp?.id !== appId) throw Error('应用 ID 与清单不一致')
  return { root, app, plugins, pkg }
}
async function profileFor(paths) {
  try { return JSON.parse(await readFile(join(paths.app, 'development.json'), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return { recipes: {} }; throw e }
}
async function source(root, name, limit = 8000) {
  const file = await realpath(resolve(root, name))
  if (!inside(root, file)) throw Error('开发资料路径超出工作区：' + name)
  const text = await readFile(file, 'utf8')
  return { path: file, content: text.slice(0, limit), truncated: text.length > limit }
}
const templates = profile => [
  { id: 'client', description: '通用前端面板，sdk.effect 管理 DOM 生命周期；无应用服务依赖' },
  { id: 'server', description: '通用后端 HTTP 接口 /api/plugins/<id>/status，依赖 http' },
  ...(profile.templates || []),
]
export async function developmentInfo(root, appId, args = {}) {
  validate('workspace_development_info', args)
  const paths = await applicationPaths(root, appId), profile = await profileFor(paths), focus = args.focus || 'ui'
  const recipe = profile.recipes?.[focus] || {}, providers = [], warnings = []
  for (const folder of await readdir(paths.plugins, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name.startsWith('.') || folder.name === 'node_modules') continue
    try {
      const { path, content, truncated } = await source(paths.root, relative(paths.root, join(paths.plugins, folder.name, 'package.json')), 64000)
      if (truncated) throw Error('清单过大')
      const pkg = JSON.parse(content), m = pkg.cordis
      if (!m) throw Error('缺少 cordis 清单')
      if (m.provides?.client?.length || m.provides?.server?.length) providers.push({ id: m.id, package: pkg.name, manifestPath: path, provides: m.provides, contracts: pkg.exports || {} })
    } catch (error) { warnings.push({ plugin: folder.name, error: error.message }) }
  }
  const names = [...new Set(['packages/host/index.d.ts', ...(recipe.contracts || []).map(file => 'applications/' + appId + '/' + file)])]
  const contracts = await Promise.all(names.map(file => source(paths.root, file)))
  const examples = await Promise.all((recipe.examples || []).map(file => source(paths.root, 'applications/' + appId + '/' + file, 6000)))
  return { appId, name: paths.pkg.cordisApp.name, root: paths.root, pluginDirectory: paths.plugins, focus, providers, warnings,
    contracts, examples, patterns: recipe.patterns || ['sdk.effect / sdk.listen 的释放随插件上下文处理。应用服务只能来自当前应用。'],
    templates: templates(profile),
    verification: { tool: 'workspace_test', arguments: { plugins: ['<plugin-id>'] }, command: 'pnpm test:plugin --app ' + appId + ' --plugin <plugin-id>',
      hotUpdate: '开发模式保存后先 workspace_status，检查 development.events 和 blocked；运行模式按 workspace_status 判断。',
      coverage: '分别报告类型契约、构建、目标测试、浏览器验收及缺口；骨架成功不代表功能测试通过。' },
  }
}
export function developmentRuntimeInfo({ appId, status, url, dataDir }) {
  const currentAppId = status.state?.current?.id ?? null
  const matches = status.online === true && currentAppId === appId
  const confirmedStorage = status.managed === true && status.mode !== 'external'
  const directory = confirmedStorage ? join(dataDir, 'apps', appId) : null
  return {
    online: status.online === true, managed: status.managed === true, mode: status.mode, url, currentAppId, matchesBoundApplication: matches,
    storage: { directory, stateFile: directory ? join(directory, 'plugins-state.json') : null,
      verified: confirmedStorage && matches,
      note: confirmedStorage ? '工作台管理的实例使用此目录；仅当前应用在线时 verified 为 true。不要直接改状态文件，也不要扫描其他数据副本。' : '当前运行目录未确认，不能把工作台默认目录当作外部服务的实际数据目录。' },
    activation: {
      available: matches && status.state?.phase === 'idle',
      readState: { method: 'GET', url: url + '/api/applications' },
      write: { method: 'POST', url: url + '/api/plugins/<plugin-id>/toggle', headers: { 'x-application-session': '<最新应用状态的 session>', 'Content-Type': 'application/json' }, body: { enabled: true } },
      steps: ['先读 readState；确认 current.id 等于 ' + appId + ' 且 phase 为 idle，再使用该响应的 session 发起 write。应用切换时停止操作。',
        '查看写入响应 plugins 中目标插件的 enabled、state 和 error；HTTP 成功不等于插件已正常运行。',
        'defaultEnabled 只用于首次登记；已持久化的开关优先。用插件管理或上述接口启用，不直接改 plugins-state.json。'],
    },
    browserVerification: 'browser_open 启动独立的隔离验收实例；其中的开关与笔记不会写入这里的运行实例。',
  }
}
function scaffoldFiles(appId, args) {
  const { id, name, template } = args, label = JSON.stringify(name), files = {}
  const m = { schemaVersion: 1, id, name, description: args.description || '', defaultEnabled: args.defaultEnabled ?? false,
    requires: { server: [], client: [] }, provides: { server: [], client: [] }, public: [], build: [] }
  if (template === 'server') {
    m.server = { entry: 'server.js', export: 'default' }; m.requires.server = ['http']
    m.build.push({ type: 'bundle', input: 'server.js', output: 'server.js', platform: 'node' })
    files['server.js'] = "export default function (ctx) {\n  ctx.http.route(ctx, 'GET', /^\\/api\\/plugins\\/" + id + "\\/status$/, () => ({ plugin: '" + id + "', ready: true }))\n}\n"
  } else {
    m.client = 'client.js'; m.public = ['client.js', 'style.css']; m.styles = ['style.css']
    m.build.push({ type: 'bundle', input: 'client.js', output: 'client.js', platform: 'browser' }, { type: 'copy', input: 'style.css', output: 'style.css' })
    files['style.css'] = '.plugin-' + id + ' { padding: 4px 8px; font: inherit; color: inherit; }\n'
    if (template === 'notebook-footer' && appId === 'notebook') {
      m.requires.client = ['notebook', 'shell']
      files['client.js'] = "export default function (ctx, sdk) {\n  const node = sdk.el('span', { class: 'plugin-" + id + "', 'aria-label': " + label + " })\n  sdk.mount('footer', node)\n  ctx.notebook.observe(ctx, () => {\n    const note = ctx.notebook.current()\n    node.textContent = note ? " + label + " + '：' + note.title : " + label + "\n  })\n}\n"
    } else if (template === 'studio-action' && appId === 'studio') {
      m.requires.client = ['canvasUI']
      files['client.js'] = "export default function (ctx, sdk) {\n  ctx.canvasUI.menu(ctx, { id: '" + id + "', label: " + label + ", run: () => sdk.toast(" + label + ") })\n}\n"
    } else if (template === 'client') {
      files['client.js'] = "export default function (ctx, sdk) {\n  const node = sdk.el('aside', { class: 'plugin-" + id + "', 'aria-label': " + label + " }, " + label + ")\n  sdk.effect(() => { document.body.append(node); return () => node.remove() })\n}\n"
    } else throw Error('此应用不支持该脚手架模板')
  }
  files['README.md'] = '# ' + name + '\n\n这是可加载骨架，尚需实现用户功能。默认' + (m.defaultEnabled ? '启用' : '停用') + '，可通过插件管理界面切换。\n\n测试放在 test/**/*.test.js；运行 workspace_test({plugins:["' + id + '"]}) 或 pnpm test:plugin --app ' + appId + ' --plugin ' + id + '。\n按本轮开关执行浏览器验收，使用 browser_report 读取报告。\n'
  files['package.json'] = JSON.stringify({ name: '@cordis-' + appId + '/' + id, version: '1.0.0', private: true, type: 'module', dependencies: {}, cordis: m }, null, 2) + '\n'
  return files
}
export async function scaffoldPlugin(root, appId, args, { signal } = {}) {
  validate('workspace_scaffold_plugin', args)
  if (!args.name.trim() || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(args.id)) throw Error('插件 ID 或名称无效')
  const paths = await applicationPaths(root, appId), profile = await profileFor(paths)
  if (!templates(profile).some(t => t.id === args.template)) throw Error('模板不存在；请从 workspace_development_info.templates 选择')
  const files = scaffoldFiles(appId, args), pkg = JSON.parse(files['package.json'])
  const entries = await discoverBuiltins(paths.plugins, { mode: 'development' })
  if (entries.some(e => e.manifest.id === args.id || e.package.name === pkg.name)) throw Error('插件 ID 或包名已存在，不能覆盖')
  for (const side of ['client', 'server']) for (const service of pkg.cordis.requires[side]) {
    if (side === 'server' && service === 'http') continue
    if (!entries.some(e => e.manifest.provides[side].includes(service))) throw Error('当前应用未提供 ' + side + ' 服务 ' + service)
  }
  const target = join(paths.plugins, args.id), staging = join(paths.plugins, '.scaffold-' + randomUUID()), folder = join(staging, args.id)
  try { await lstat(target); throw Error('插件目录已存在，不能覆盖') } catch (e) { if (e.code !== 'ENOENT') throw e }
  signal?.throwIfAborted()
  await mkdir(folder, { recursive: true })
  try {
    for (const [file, text] of Object.entries(files)) { signal?.throwIfAborted(); await writeFile(join(folder, file), text, { flag: 'wx' }) }
    await discoverBuiltins(staging, { mode: 'development' })
    signal?.throwIfAborted()
    await rename(folder, target)
  } finally {
    if (!inside(paths.plugins, staging) || !staging.split(sep).at(-1).startsWith('.scaffold-')) throw Error('临时目录路径异常')
    await rm(staging, { recursive: true, force: true })
  }
  return { appId, id: args.id, template: args.template, directory: target, files: Object.keys(files).map(file => join(target, file)),
    defaultEnabled: pkg.cordis.defaultEnabled, validated: '插件清单和构建输入已校验；尚未构建或验证业务',
    next: ['修改生成的实现完成用户需求', '开发模式用 workspace_status 检查热更新', 'workspace_test({plugins:["' + args.id + '"]})', '按本轮开关执行浏览器验收，用 browser_report 读取当前报告'] }
}
