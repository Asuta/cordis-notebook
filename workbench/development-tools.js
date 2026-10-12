import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { readdir, readFile, realpath, lstat, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { resolve, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { discoverBuiltins, inside, containedFile } from '../server/plugin-discovery.js'
import { capabilitiesOf } from '../shared/capabilities.js'

const object = properties => Type.Object(properties, { additionalProperties: false })
export const developmentSchemas = {
  workspace_development_info: object({
    focus: Type.Optional(Type.Union(['ui', 'backend', 'agent'].map(Type.Literal))),
    task: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    template: Type.Optional(Type.String({ minLength: 1, maxLength: 60 })),
    includeAllProviders: Type.Optional(Type.Boolean()),
    includeRelatedSources: Type.Optional(Type.Boolean()),
    capability: Type.Optional(Type.String({ pattern: '^(client|server):[a-zA-Z][\\w.-]*$' })),
  }),
  workspace_scaffold_plugin: object({
    id: Type.String({ pattern: '^[a-z][a-z0-9-]{1,49}$' }), name: Type.String({ minLength: 1, maxLength: 80 }),
    template: Type.String({ minLength: 1, maxLength: 60 }),
    description: Type.Optional(Type.String({ maxLength: 1000 })), defaultEnabled: Type.Optional(Type.Boolean()),
  }),
  workspace_enable_plugin: object({ id: Type.String({ pattern: '^[a-z][a-z0-9-]{1,49}$' }) }),
  workspace_operation_status: object({ id: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,100}$' }), session: Type.String({ minLength: 1, maxLength: 100 }) }),
}
export const developmentTools = [
  ['workspace_operation_status', '查询插件启停或配置操作的当前阶段及错误码。使用启用结果中的 operation.id 或 operationFailure.operationId，以及原 session；记录仅在该应用运行会话内保留，未知结果不能自动重放写操作。', developmentSchemas.workspace_operation_status],
  ['workspace_development_info', '一次读取绑定应用的开发资料，默认展开当前任务相关的全部契约与示例正文，包括示例清单和提供者实现。优先从本轮应用开发路径目录选 task；首次就传匹配的 task，无需先查询默认资料。没有匹配任务时可选 focus（ui/backend/agent）、已知 template 或 capability。ui 的 presentation 另含样式、图标、排序说明与有限真实源码选段，无需再扫描样式文件。task、template、capability 互斥；includeAllProviders=true 仅展开服务索引。includeRelatedSources 默认为 true；显式 false 才收窄到使用契约和单个示例。同时返回挂载/释放规则、验证命令、实际运行地址和启用工具；文件有真实路径和正文，无需重复读取。', developmentSchemas.workspace_development_info],
  ['workspace_scaffold_plugin', '为绑定应用创建完整可发现的插件骨架。先从 workspace_development_info 选择 template；默认停用，写齐实现和清单并校验后整体发布。拒绝重复 ID、目录或包名，不覆盖已有文件。sources 直接返回生成文件的路径与完整源码，可立即编辑，无需再次读取；骨架还需实现需求和验证。', developmentSchemas.workspace_scaffold_plugin],
  ['workspace_enable_plugin', '启用绑定应用的插件并一次返回 enabled、running、双端状态、依赖与失败原因。自动核对受管理实例与最新应用 session；已启用时读取状态。连接页面时复用插件管理流程和保存保护，确认前端加载；无页面的普通插件只确认后端，running=null 表示前端未知。单选组切换需要页面。不代替功能测试或浏览器验收，不自动启用依赖或重试写请求。', developmentSchemas.workspace_enable_plugin],
]
export const developmentGuidance = [
  '服务能力由提供者的 cordis.capabilities 声明。workspace_development_info 的 capabilities 精简索引可发现新服务，传 capability:"client:服务名" 或 "server:服务名" 读取提供者契约、示例和生命周期要求，无需修改应用级任务导航。声明存在不等于已运行；/api/capabilities 返回提供者状态，前端仍需页面核对。插件操作结果包含 operation 和结构化 operationFailure；响应不确定时使用 workspace_operation_status 查询原 session 中的操作，不能盲目重放。',
  '插件开发先从本轮提供的应用开发路径选择匹配的 task，首次 workspace_development_info 就传该 task；没有匹配任务时选择 focus、template 或 capability。不必先调用默认 ui 来发现路径。默认展开当前任务相关的全部契约、示例清单和实现正文；需要其他服务时才 includeAllProviders=true。已返回的文件无需再读；仅为尚未解决的具体问题追加定向读取，不反复读取相同文件或无目标扫描插件。新增插件优先 workspace_scaffold_plugin，直接用 sources 中的源码开始编辑；需要自建时先写齐实现和构建输入，最后发布清单。',
  '小功能按用户要求实现最小范围；未要求的配置、设置页和额外功能不要顺手增加。契约和最接近示例确认后开始实现，不要求读完整项目。验证选择目标插件；修复实际失败或新增改动后才重跑已通过检查。结束报告依据已有结果，不例行再扫描目录、dist 或重读报告。',
  '启用优先 workspace_enable_plugin({id:"插件ID"})，自动核对当前应用、最新 session 并返回双端状态与依赖；running=null 是前端未验证，不能报告已运行。失败先根据 operationError/error/waitingFor 处理，不盲目重放写请求。defaultEnabled 只影响首次登记，不能覆盖已保存的停用状态。只以受管理运行实例返回的数据目录为准，不能假定 root/data，不能直接改状态文件。浏览器验收使用独立实例和数据；browser_plugin({id:"插件ID",enable:true}) 仅启用并核对验收实例，不代表用户页面已经启用。',
]
function validate(name, args) {
  if (!Value.Check(developmentSchemas[name], args)) throw Error('开发工具参数无效：' + [...Value.Errors(developmentSchemas[name], args)].slice(0, 3).map(e => e.path + ': ' + e.message).join('；'))
}
async function applicationPaths(root, appId, { requirePlugins = true } = {}) {
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(appId)) throw Error('应用 ID 无效')
  root = await realpath(root)
  const app = await realpath(join(root, 'applications', appId))
  if (!inside(root, app)) throw Error('应用或插件目录超出当前工作区')
  const plugins = requirePlugins ? await realpath(join(app, 'plugins')) : undefined
  if (requirePlugins && !inside(app, plugins)) throw Error('应用或插件目录超出当前工作区')
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
async function sourceRange(root, name, { start = 1, end = start + 19 } = {}) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end - start >= 40) throw Error('界面资料选段必须在 40 行以内')
  const file = await realpath(resolve(root, name))
  if (!inside(root, file)) throw Error('开发资料路径超出工作区：' + name)
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  if (end > lines.length) throw Error('界面资料选段超出文件：' + name)
  const text = lines.slice(start - 1, end).join('\n')
  return { path: file, start, end, content: text.slice(0, 2500), truncated: text.length > 2500 }
}
async function sourceMatch(root, name, needle) {
  const file = await source(root, name, 64000), lines = file.content.split(/\r?\n/)
  const index = lines.findIndex(line => line.includes(needle))
  if (index < 0) throw Error('开发资料定位已过期：' + name + ' ' + needle)
  return sourceRange(root, name, { start: index + 1, end: index + 1 })
}
const genericPresentation = {
  styles: { note: '独立面板只依赖自己的 class；继承 font/color，不依赖应用内部 DOM 或局部主题变量。', example: '.plugin-<plugin-id> { padding: 4px 8px; font: inherit; color: inherit; }' },
  icons: { note: '原生 DOM 可使用文字或符号并给按钮提供可访问名称；此模板没有图标服务依赖。' },
  ordering: { note: '独立面板由自己的挂载位置决定布局；sdk.mount 没有 order 参数。' },
}
const templates = profile => [
  { id: 'client', description: '通用前端面板，sdk.effect 管理 DOM 生命周期；无应用服务依赖', focus: 'ui', recipe: { services: { client: [], server: [] }, presentation: genericPresentation } },
  { id: 'server', description: '通用后端 HTTP 接口 /api/plugins/<id>/status，依赖 http', focus: 'backend', recipe: { services: { server: ['http'], client: [] } } },
  ...(profile.templates || []),
]
// The same application profile drives both the initial directory and tool replies.
// Building this directory does not discover plugins or load their source files.
export async function developmentNavigation(root, appId) {
  const paths = await applicationPaths(root, appId, { requirePlugins: false }), profile = await profileFor(paths)
  const lines = [`应用 ${appId} 的开发路径（来自 applications/${appId}/development.json）：`]
  for (const [kind, entries] of [['task', profile.tasks || []], ['template', templates(profile)]]) {
    const ids = new Set()
    for (const entry of entries) {
      if (!/^[a-z][a-z0-9-]{0,59}$/.test(entry.id) || ids.has(entry.id) || typeof entry.description !== 'string' || !entry.description.trim()
        || (entry.focus && !['ui', 'backend', 'agent'].includes(entry.focus))) throw Error(`开发路径声明无效：${appId} ${kind} ${entry.id}`)
      ids.add(entry.id)
      lines.push(`- ${JSON.stringify({ [kind]: entry.id })}：${entry.description.replace(/\s+/g, ' ')}`)
    }
  }
  lines.push('没有匹配的专项任务时：{"focus":"ui"} 获取一般界面资料；{"focus":"backend"} 获取后端接口与数据资料；{"focus":"agent"} 获取应用 Agent 工具资料。',
    '首次 workspace_development_info 直接使用上面的一个参数对象；task/template/capability 互斥。task 是资料路径，template 是可生成的骨架，不必为了用骨架重复读取模板资料。组合需求可分别读取确实需要的路径。')
  return lines.join('\n')
}
export async function developmentInfo(root, appId, args = {}) {
  validate('workspace_development_info', args)
  const paths = await applicationPaths(root, appId), profile = await profileFor(paths)
  if ([args.task, args.template, args.capability].filter(Boolean).length > 1) throw Error('task、template 和 capability 二选一，不可同时选择')
  const selected = args.task ? (profile.tasks || []).find(task => task.id === args.task)
    : args.template ? templates(profile).find(template => template.id === args.template) : null
  if ((args.task || args.template) && !selected) throw Error('任务或模板不存在；请从 tasks/templates 选择')
  if (selected?.focus && args.focus && args.focus !== selected.focus) throw Error('focus 与任务或模板不一致')
  const focus = args.focus || selected?.focus || (args.capability?.startsWith('server:') ? 'backend' : 'ui')
  let recipe = selected ? selected.recipe || profile.recipes?.[focus] || {} : profile.recipes?.[focus] || {}
  const providers = [], warnings = []
  for (const folder of await readdir(paths.plugins, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name.startsWith('.') || folder.name === 'node_modules') continue
    try {
      const { path, content, truncated } = await source(paths.root, relative(paths.root, join(paths.plugins, folder.name, 'package.json')), 64000)
      if (truncated) throw Error('清单过大')
      const pkg = JSON.parse(content), m = pkg.cordis
      if (!m) throw Error('缺少 cordis 清单')
      const capabilities = capabilitiesOf(m), pluginRoot = join(paths.plugins, folder.name)
      for (const capability of capabilities) for (const name of [...capability.contracts, ...capability.examples, ...capability.tests]) await containedFile(pluginRoot, name)
      if (m.provides?.client?.length || m.provides?.server?.length) providers.push({ id: m.id, package: pkg.name, manifestPath: path, provides: m.provides, contracts: pkg.exports || {},
        capabilities: capabilities.map(capability => ({ ...capability, provider: m.id, requires: m.requires?.[capability.side] || [],
          contracts: capability.contracts.map(file => relative(paths.root, join(pluginRoot, file)).replaceAll('\\', '/')),
          examples: capability.examples.map(file => relative(paths.root, join(pluginRoot, file)).replaceAll('\\', '/')),
          tests: capability.tests.map(file => relative(paths.root, join(pluginRoot, file)).replaceAll('\\', '/')),
        })) })
    } catch (error) { warnings.push({ plugin: folder.name, error: error.message }) }
  }
  const capabilities = providers.flatMap(provider => provider.capabilities)
  if (args.capability) {
    const matches = capabilities.filter(capability => capability.key === args.capability)
    if (!matches.length) throw Error('能力不存在或声明无效，请查看 capabilities 和 warnings：' + args.capability)
    const { side, service } = matches[0]
    recipe = { services: { client: [], server: [], [side]: [service] } }
  }
  const selectedCapabilities = capabilities.filter(capability => args.capability ? capability.key === args.capability : recipe.services?.[capability.side]?.includes(capability.service))
  const recipeContracts = recipe.contracts?.map(file => 'applications/' + appId + '/' + file)
  const capabilityContracts = selectedCapabilities.flatMap(capability => capability.contracts)
  // Expand all related sources by default, matching the full-information workflow.
  // Explicit false keeps the narrower response available for existing callers.
  const includeRelatedSources = args.includeRelatedSources ?? true
  const names = [...new Set(['packages/host/index.d.ts', ...(recipeContracts ?? capabilityContracts),
    ...(includeRelatedSources ? capabilityContracts : [])])]
  const contracts = await Promise.all(names.map(file => source(paths.root, file)))
  const exampleNames = [...new Set([...(recipe.examples || []).map(file => 'applications/' + appId + '/' + file), ...selectedCapabilities.flatMap(capability => capability.examples)])]
  const preferredExample = exampleNames.find(file => !file.endsWith('/package.json')) || exampleNames[0]
  const examples = await Promise.all((includeRelatedSources ? exampleNames : preferredExample ? [preferredExample] : []).map(file => source(paths.root, file, 6000)))
  const visual = focus === 'ui' ? selected?.presentation || recipe.presentation || profile.recipes?.ui?.presentation || genericPresentation : null
  const presentation = visual && { ...visual, references: undefined,
    manifest: { icon: 'cordis.icon 是图标名称（如 Puzzle、Plus），默认 Puzzle；不是文件路径，也不会自动给业务按钮添加图标。',
      order: 'cordis.order 默认 1000，发现列表按数值升序，同值按插件 id；它不决定服务依赖的启动顺序，也不代替应用菜单排序。' },
    sources: await Promise.all([sourceMatch(paths.root, 'server/plugin-discovery.js', 'styles:m.styles'),
      sourceMatch(paths.root, 'server/plugin-discovery.js', 'return entries.sort('),
      ...(visual.references || []).map(({ file, ...range }) => sourceRange(paths.root, 'applications/' + appId + '/' + file, range))]),
  }
  // Older application profiles without service lists keep their full index.
  const relevant = args.includeAllProviders || !recipe.services ? providers : providers.filter(provider =>
    ['client', 'server'].some(side => (recipe.services[side] || []).some(service => provider.provides[side]?.includes(service))))
  for (const side of ['client', 'server']) for (const service of recipe.services?.[side] || []) {
    if (side === 'server' && service === 'http') continue
    if (!providers.some(provider => provider.provides[side]?.includes(service))) warnings.push({ service, side, error: '当前应用未提供此服务' })
  }
  const descriptor = ({ id, description, focus }) => ({ id, description, ...(focus ? { focus } : {}) })
  return { appId, name: paths.pkg.cordisApp.name, root: paths.root, pluginDirectory: paths.plugins, focus,
    ...(args.task ? { task: args.task } : {}), ...(args.template ? { template: args.template } : {}),
    providers: relevant.map(({ capabilities, ...provider }) => provider), providerScope: relevant === providers ? 'all' : 'related', providerCount: providers.length,
    capabilities: capabilities.map(({ key, provider, description }) => ({ key, provider, description })),
    selectedCapabilities: selectedCapabilities.map(capability => args.capability ? capability : { key: capability.key, provider: capability.provider }),
    expandProviders: { tool: 'workspace_development_info', arguments: { ...args, includeAllProviders: true } }, warnings,
    relatedSources: { contracts: [...new Set(capabilityContracts)].filter(file => !names.includes(file)), examples: exampleNames.filter(file => !examples.some(example => example.path === resolve(paths.root, file))) },
    expandSources: { tool: 'workspace_development_info', arguments: { ...args, includeRelatedSources: true } },
    contracts, examples, ...(presentation ? { presentation } : {}), patterns: [...(recipe.patterns || ['sdk.effect / sdk.listen 的释放随插件上下文处理。应用服务只能来自当前应用。']), ...selectedCapabilities.flatMap(capability => capability.lifecycle)],
    templates: templates(profile).map(descriptor), tasks: (profile.tasks || []).map(descriptor),
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
      available: matches && confirmedStorage && status.state?.phase === 'idle' && !status.development?.pending && !status.development?.blocked,
      tool: { name: 'workspace_enable_plugin', arguments: { id: '<plugin-id>' } },
      readState: { method: 'GET', url: url + '/api/applications' },
      write: { method: 'POST', url: url + '/api/plugins/<plugin-id>/toggle', headers: { 'x-application-session': '<最新应用状态的 session>', 'Content-Type': 'application/json' }, body: { enabled: true } },
      steps: ['先读 readState；确认 current.id 等于 ' + appId + ' 且 phase 为 idle，再使用该响应的 session 发起 write。应用切换时停止操作。',
        '查看写入响应 plugins 中目标插件的 enabled、state 和 error；HTTP 成功不等于插件已正常运行。',
        'defaultEnabled 只用于首次登记；已持久化的开关优先。用插件管理或上述接口启用，不直接改 plugins-state.json。'],
    },
    browserVerification: 'browser_open 启动独立的隔离验收实例；其中的开关与笔记不会写入这里的运行实例。使用 browser_plugin({id:"<plugin-id>"}) 查询该实例状态，enable:true 启用并核对前后端；工作台启用不共享到验收实例。',
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
      files['client.js'] = "export default function (ctx, sdk) {\n  const node = sdk.el('span', { class: 'plugin-" + id + "', 'data-testid': 'plugin-" + id + "', 'aria-label': " + label + " })\n  sdk.mount('footer', node)\n  ctx.notebook.observe(ctx, () => {\n    const note = ctx.notebook.current()\n    node.textContent = note ? " + label + " + '：' + note.title : " + label + "\n  })\n}\n"
    } else if (template === 'studio-action' && appId === 'studio') {
      m.requires.client = ['canvasUI']
      files['client.js'] = "export default function (ctx, sdk) {\n  ctx.canvasUI.menu(ctx, { id: '" + id + "', label: " + label + ", run: () => sdk.toast(" + label + ") })\n}\n"
    } else if (template === 'client') {
      files['client.js'] = "export default function (ctx, sdk) {\n  const node = sdk.el('aside', { class: 'plugin-" + id + "', 'data-testid': 'plugin-" + id + "', 'aria-label': " + label + " }, " + label + ")\n  sdk.effect(() => { document.body.append(node); return () => node.remove() })\n}\n"
    } else throw Error('此应用不支持该脚手架模板')
  }
  files['README.md'] = '# ' + name + '\n\n这是可加载骨架，尚需实现用户功能。默认' + (m.defaultEnabled ? '启用' : '停用') + '，可通过 workspace_enable_plugin({id:"' + id + '"}) 启用并检查运行状态，或使用插件管理界面。running=null 表示前端尚未核对。\n\n测试放在 test/**/*.test.js；运行 workspace_test({plugins:["' + id + '"]}) 或 pnpm test:plugin --app ' + appId + ' --plugin ' + id + '。\n按本轮开关执行浏览器验收，使用 browser_report 读取报告。\n'
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
    sources: Object.entries(files).map(([file, content]) => ({ path: join(target, file), content, truncated: false })),
    defaultEnabled: pkg.cordis.defaultEnabled, validated: '插件清单和构建输入已校验；尚未构建或验证业务',
    next: ['修改生成的实现完成用户需求', '开发模式用 workspace_status 检查热更新', 'workspace_test({plugins:["' + args.id + '"]})', 'workspace_enable_plugin({id:"' + args.id + '"}) 检查运行、依赖与失败原因', '按本轮开关执行浏览器验收，用 browser_report 读取当前报告'] }
}
