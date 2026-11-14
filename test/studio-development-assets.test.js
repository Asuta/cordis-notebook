import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, cp, readdir, lstat, symlink, rm } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { Window } from 'happy-dom'
import { applicationScaffold } from '../workbench/development-assets.js'
import { developmentInfo, scaffoldPlugin } from '../workbench/development-tools.js'
import { loadBrowserScenario } from '../workbench/browser-scenarios.js'
import { BrowserVerification } from '../workbench/browser-verification.js'
import { buildPlugins } from '../scripts/plugin-builder.js'
import { createStore } from '../applications/studio/plugins/canvas/store.js'
import { createSession } from '../applications/studio/plugins/canvas/session.js'
import { createNodeRegistry, createRegistry } from '../applications/studio/plugins/canvas/registry.js'
import { definitions } from '../applications/studio/plugins/canvas-basic-cards/definitions.js'
import { definition, generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { createJobs } from '../applications/studio/plugins/image-generation/jobs.js'
import agentTools from '../applications/studio/plugins/canvas-agent-tools/client.js'
import canvasUI from '../applications/studio/plugins/canvas-ui/client.js'
import { writeSnapshot } from '../shared/persistence.js'
import { owner } from './helpers/studio-fixture.js'

const appRoot = resolve('applications/studio')
const templates = ['studio-action', 'studio-card', 'studio-provider', 'studio-agent-action', 'studio-extension']
const parameters = {
  'studio-extension': { actionLabel: '查看 "信息"', panelTitle: '卡片 "详情"' },
  'studio-action': { actionLabel: '菜单 "引号"', boardTitle: '菜单整理后的画板' },
  'studio-card': { actionLabel: '创建 "便签"', cardLabel: '灵感 "便签"' },
  'studio-provider': { providerLabel: '本地 "图片" 服务' },
  'studio-agent-action': { actionLabel: 'Agent "操作"', boardTitle: 'Agent 整理后的画板' },
}
const argsFor = template => ({ id: 'fixture-' + template, name: '测试 "插件"', template, parameters: parameters[template] })
const recipes = ['advanced', 'settings']
const recipeArgs = recipe => ({ ...argsFor('studio-provider'), id: 'fixture-' + recipe, name: recipe + ' 示例' })
const importFile = file => import(pathToFileURL(file).href)
const until = async fn => {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('等待本地模拟任务超时')
}
async function fixture(t) {
  const prefix = resolve('studio-assets-test-'), root = await mkdtemp(prefix), cleanups = []
  t.after(async () => {
    try { for (const cleanup of cleanups.reverse()) await cleanup() }
    finally { assert.ok(root.startsWith(prefix)); await rm(root, { recursive: true, force: true }) }
  })
  return { root, cleanups }
}
async function materialize(root, template) {
  const files = await applicationScaffold(appRoot, 'development/' + template + '/template.json', argsFor(template), 'studio')
  const directory = join(root, template)
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, file)), { recursive: true })
    await writeFile(join(directory, file), content)
  }
  return { directory, files }
}
async function modelFixture(t) {
  const f = await fixture(t), context = owner(), types = createNodeRegistry()
  f.cleanups.push(() => context.dispose())
  for (const item of [...definitions, definition]) types.register(context, item)
  const store = await createStore(join(f.root, 'data'), writeSnapshot, types)
  return { ...f, store, types }
}
async function sessionFixture(t) {
  const f = await modelFixture(t), context = owner(), previousWindow = globalThis.window
  globalThis.window = {}
  f.cleanups.push(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow })
  f.cleanups.push(() => context.dispose())
  context.on = () => {}
  const storage = new Map(), toasts = []
  t.after(() => assert.deepEqual(toasts, [], '不得留下未预期的提示'))
  const sdk = {
    storage: { local: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    listen() {}, toast: message => toasts.push(message),
    async request(path, method, body) {
      if (path === '/api/studio') return { ...f.store.read(), types: f.types.list().map(({id,label,fields,accepts,output,defaults}) => ({id,label,fields,accepts,output,defaults:defaults()})) }
      if (path === '/api/studio/edit') return f.store.edit(body.boardId, body.revision, body.operations)
      if (path === '/api/studio/boards') return f.store.addBoard(body.title)
      throw Error('未实现的测试接口：' + path)
    },
  }
  const session = await createSession(context, sdk)
  return { ...f, session, sdk, toasts }
}

async function uiFixture(t) {
  const f = await sessionFixture(t), window = new Window({ settings: { disableCSSFileLoading: true } })
  const previous = { window: globalThis.window, document: globalThis.document }, context = owner()
  globalThis.window = window; globalThis.document = window.document
  f.cleanups.push(async () => { await window.happyDOM.close(); Object.assign(globalThis, previous) })
  f.cleanups.push(() => context.dispose())
  context.canvasSession = f.session
  const sdk = { ...f.sdk,
    el(tag, props = {}, text) {
      const node = window.document.createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value
        else if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, value)
        else node[key] = value
      }
      if (text !== undefined) node.textContent = text
      return node
    },
    provide(name, value) { context[name] = value },
    mount(name, node) { window.document.body.append(node); context.effect(() => () => node.remove()) },
    listen(target, event, fn) { target.addEventListener(event, fn); context.effect(() => () => target.removeEventListener(event, fn)) },
    request: async (path, ...args) => path === '/api/application-data-directory' ? { path: f.root, standalone: true } : f.sdk.request(path, ...args),
  }
  await canvasUI(context, sdk)
  return { ...f, window, sdk, view: context.canvasUI, context }
}

test('选择工具栏复用按钮时仍读取最新卡片和动作', async t => {
  const f = await uiFixture(t), received = [];
  f.view.register(f.context, {
    id: 'text', label: '文字', render() {},
    actions: [{ label: '读取卡片', run: node => received.push(node.text) }],
    selectionActions(nodes) {
      const text = nodes[0].text;
      return [{ id: 'read-selection', label: '读取所选', run: current => received.push([text, current[0].text]) }];
    },
  });
  await f.session.edit([{ type: 'add', node: { id: 'text', type: 'text', title: '标题不变', text: '旧内容' } }]);
  f.view.select(['text']);
  const findButton = label => [...f.window.document.querySelectorAll('button')].find(button => button.textContent === label);
  const selectionButton = findButton('读取所选'), cardButton = findButton('读取卡片');
  await f.session.edit([{ type: 'update', id: 'text', patch: { text: '新内容' } }]);
  assert.ok(findButton('读取所选') === selectionButton, '内容变化不必重建工具栏');
  await selectionButton.onclick();
  await cardButton.onclick();
  assert.deepEqual(received, [['新内容', '新内容'], '新内容']);
});

test('画布五条路径返回完整资料、可参数化骨架和可执行公共场景', async () => {
  for (const template of templates) {
    const info = await developmentInfo(resolve('.'), 'studio', { task: template })
    assert.deepEqual(info.warnings, [])
    assert.equal(info.recommendedScaffold.arguments.template, template)
    for (const source of [...info.contracts, ...info.examples]) assert.equal(source.truncated, false, source.path)
    assert.ok(info.selectedCapabilities.some(item => item.key === (template === 'studio-provider' ? 'server:imageGeneration' : 'client:canvasSession')))
    const publicScenario = template === 'studio-extension' ? 'extension-lifecycle' : template === 'studio-card' ? 'card-lifecycle' : template === 'studio-provider' ? 'provider-lifecycle' : 'menu-lifecycle'
    const input = { pluginId: argsFor(template).id }
    if (template !== 'studio-provider') input.actionLabel = parameters[template].actionLabel
    if (template === 'studio-card') input.contentLabel = parameters[template].cardLabel + ' 内容'
    const scenario = await loadBrowserScenario(resolve('.'), 'studio', publicScenario, input)
    assert.match(scenario.metadata.scenarioHash, /^[a-f0-9]{64}$/)
    assert.ok(scenario.steps.some(step => step.action === 'screenshot'))
    if (publicScenario === 'menu-lifecycle') {
      assert.ok(!scenario.steps.some(step => step.action === 'click' && step.target?.name === input.actionLabel))
      await loadBrowserScenario(resolve('.'), 'studio', 'rename-sample', { actionLabel: input.actionLabel, expectedTitle: parameters[template].boardTitle })
    }
    if (publicScenario === 'provider-lifecycle') assert.ok(!scenario.steps.some(step => step.action === 'click' && step.target?.css === '.studio-generate-run'))
  }
  const provider = await developmentInfo(resolve('.'), 'studio', { capability: 'server:imageGeneration' })
  assert.ok(provider.contracts.some(source => source.path.endsWith(join('image-generation', 'types', 'server.d.ts'))))
  assert.ok(provider.examples.some(source => source.path.endsWith(join('examples', 'provider.js')) && !source.truncated))
})

test('五种脚手架安全生成中文和引号参数，附带的测试全部可独立执行', async t => {
  const { root } = await fixture(t)
  for (const template of templates) {
    const { files, directory } = await materialize(root, template)
    const pkg = JSON.parse(files['package.json'])
    assert.equal(pkg.cordis.defaultEnabled, false)
    assert.deepEqual(pkg.dependencies, {})
    assert.ok(files['README.md'])
    for (const content of Object.values(files)) assert.ok(!content.includes('{{'), '不应残留模板参数')
    const tests = Object.keys(files).filter(file => file.endsWith('.test.js')).map(file => join(directory, file))
    assert.ok(tests.length)
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
    const result = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: directory, env, windowsHide: true, timeout: 20000 })
    assert.match(result.stdout, /(?:fail 0|# fail 0)/)
  }
})

test('进阶和设置任务返回完整配方并复用 provider 骨架', async () => {
  for (const task of ['studio-provider-advanced', 'studio-settings']) {
    const info = await developmentInfo(resolve('.'), 'studio', { task })
    assert.deepEqual(info.warnings, [])
    assert.equal(info.recommendedScaffold.arguments.template, 'studio-provider')
    for (const source of [...info.contracts, ...info.examples]) assert.equal(source.truncated, false, source.path)
    assert.ok(info.examples.some(source => source.path.endsWith('settings-store.js.txt')))
    assert.ok(info.selectedCapabilities.some(item => item.key === 'client:canvasUI'))
    for (const id of ['settings-lifecycle', 'settings-sample']) {
      const scenario = await loadBrowserScenario(resolve('.'), 'studio', id, { pluginId: 'fixture-settings', settingsTitle: '设置 "示例"' })
      assert.ok(scenario.steps.some(step => step.action === 'screenshot'))
      if (id === 'settings-lifecycle') assert.ok(!scenario.steps.some(step => step.action === 'fill'))
    }
  }
})

test('界面增强在真实 canvasUI 中处理既有及复用视频卡片，刷新去重、切板与停用清理', async t => {
  const f = await uiFixture(t), { directory } = await materialize(f.root, 'studio-extension')
  const { default: apply } = await importFile(join(directory, 'client.js'))
  await f.session.edit([{ type: 'add', node: { id: 'text', type: 'text', title: '已有文字' } }])
  // 媒体传输不在本测试范围；在会话中注入已导入的视频元数据，测试真实 UI 的 DOM 复用分支。
  f.session.state.assets.video = { id: 'video', kind: 'video', name: '已有视频', width: 32, height: 32 }
  f.session.board().nodes.push({ id: 'video', type: 'video', title: '已有视频', assetId: 'video', x: 400, y: 0 })
  f.view.register(f.context, { id: 'video', label: '视频', preserveDOM: node => Boolean(node.assetId), render: (_, card) => card.append(f.sdk.el('video')) })
  const video = f.view.cards.querySelector('[data-node=video]'), selector = '[data-studio-extension]'
  let plugin = owner(); f.cleanups.push(() => plugin.dispose())
  const enable = () => apply(Object.assign(plugin, { canvasUI: f.view }))
  enable()
  for (let i = 0; i < 4; i++) f.view.render()
  assert.ok(f.view.cards.querySelector('[data-node=video]') === video, '保留播放中的 DOM')
  assert.equal(f.view.cards.querySelectorAll(selector).length, 2)
  const button = video.querySelector(selector), detail = f.view.side.querySelector('[data-studio-extension-panel] [role=status]')
  await button.onclick()
  assert.equal(detail.textContent, '已有视频 · video · 0 条连线')
  await f.session.newBoard('另一个画板')
  assert.match(detail.textContent, /当前画板共 0 张卡片/)
  await f.session.edit([{ type: 'add', node: { id: 'new', type: 'text' } }])
  const detached = f.view.cards.querySelector(selector)
  await f.session.edit([{ type: 'remove', ids: ['new'] }])
  await plugin.dispose()
  assert.equal(f.view.side.querySelector('[data-studio-extension-panel]'), null)
  const before = detail.textContent; await detached.onclick()
  assert.equal(detail.textContent, before, '卸载后的旧按钮不能继续工作')
  plugin = owner(); enable(); f.view.render(); f.view.render()
  assert.equal(f.view.side.querySelectorAll('[data-studio-extension-panel]').length, 1)
})

test('设置配方使用真实设置容器保留草稿、拒绝并发覆盖并忽略卸载后响应', async t => {
  const f = await uiFixture(t), { directory } = await materialize(f.root, 'studio-provider')
  const { default: apply } = await importFile(join(directory, 'settings-client.js'))
  const { createSettings } = await importFile(join(directory, 'settings-store.js'))
  const config = await createSettings(join(f.root, 'settings'), writeSnapshot), calls = []
  let gate, release
  const sdk = { ...f.sdk, async request(path, method, body) {
    calls.push({ method, body })
    if (gate) await gate
    return method === 'POST' ? config.save(body) : config.public()
  } }
  const plugin = owner(); f.cleanups.push(() => plugin.dispose())
  apply(Object.assign(plugin, { canvasUI: f.view }), sdk)
  const section = f.view.root.querySelector('.studio-app-settings-extension')
  const url = section.querySelector('[type=url]'), key = section.querySelector('[type=password]')
  const [save, reload] = section.querySelectorAll('button'), status = section.querySelector('[role=status]')
  await until(() => !save.disabled)
  url.value = 'https://example.com'; url.oninput(); key.value = 'fixture-key'; key.oninput()
  await [...f.view.side.querySelectorAll('button')].find(button => button.textContent === '⚙ 应用设置').onclick()
  assert.equal(url.value, 'https://example.com'); assert.equal(key.value, 'fixture-key')
  assert.equal(calls.length, 1, '重开设置不能覆盖未保存草稿')
  gate = new Promise(resolve => { release = resolve })
  const saving = save.onclick(); await save.onclick()
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  assert.equal(url.disabled, true); release(); await saving; gate = null
  assert.equal(config.private().apiKey, 'fixture-key'); assert.equal(key.value, '')
  await config.save({ revision: 1, baseUrl: 'https://other.example', apiKey: '', clearKey: false })
  url.value = 'https://stale.example'; url.oninput(); key.value = 'should-clear'
  await save.onclick()
  assert.match(status.textContent, /配置冲突/); assert.equal(key.value, '')
  assert.equal(url.value, 'https://stale.example'); assert.equal(config.public().baseUrl, 'https://other.example')
  await reload.onclick(); assert.equal(url.value, 'https://other.example')
  gate = new Promise(resolve => { release = resolve })
  const pending = reload.onclick(); const message = status.textContent
  await plugin.dispose(); release(); await pending
  assert.equal(section.isConnected, false); assert.equal(status.textContent, message)
  const count = calls.length; await save.onclick(); await reload.onclick(); assert.equal(calls.length, count)
})

test('HTTP 进阶配方经真实队列重启恢复同一任务，未知提交不重发且结果持久化', async t => {
  const f = await modelFixture(t), { directory } = await materialize(f.root, 'studio-provider')
  const { createRemoteProvider } = await importFile(join(directory, 'advanced/provider.js'))
  const { createTransport } = await importFile(join(directory, 'advanced/transport.js'))
  const { startMock } = await importFile(join(directory, 'advanced/mock-server.js'))
  const { createSettings } = await importFile(join(directory, 'settings-store.js'))
  const mock = await startMock(); f.cleanups.push(mock.close); mock.state.mode = 'hold'
  const config = await createSettings(join(f.root, 'private'), writeSnapshot)
  await config.save({ revision: 0, baseUrl: mock.origin, apiKey: mock.key, clearKey: false })
  const id = argsFor('studio-provider').id
  const provider = () => createRemoteProvider({ id, label: 'HTTP', config, transport: createTransport({ pollInterval: 5 }) })
  let jobs = await createJobs(f.store), context = owner()
  f.cleanups.push(() => jobs.close()); f.cleanups.push(() => context.dispose())
  jobs.register(context, provider())
  const board = f.store.read().boards[0]
  await f.store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'gen', type: 'generator', provider: id, model: 'sample-image', prompt: '本机 HTTP', modelParameters: { [id + ':sample-image']: { steps: 4 } } } }])
  const args = () => ({ requestId: randomUUID(), boardId: board.id, nodeId: 'gen', revision: f.store.read().boards[0].revision })
  const job = await jobs.start(args())
  await until(() => jobs.read()[0].remote?.phase === 'submitted' && mock.requests.some(row => row.method === 'GET'))
  await jobs.close(); await context.dispose()
  const remote = jobs.read()[0].remote; assert.equal(jobs.read()[0].status, 'paused')
  const restored = await createStore(join(f.root, 'data'), writeSnapshot, f.types)
  jobs = await createJobs(restored); context = owner(); mock.state.release = true
  jobs.register(context, provider())
  await until(() => jobs.read()[0].status === 'succeeded')
  const result = jobs.read()[0]
  assert.equal(result.id, job.id); assert.deepEqual(result.remote, remote)
  assert.equal(mock.requests.filter(row => row.method === 'POST').length, 1)
  assert.equal(mock.requests[0].body.steps, 4)
  await sharp(await restored.image(result.assetId)).raw().toBuffer()
  assert.equal(restored.read().boards[0].nodes.find(node => node.id === result.resultNodeId).assetId, result.assetId)
  mock.state.mode = 'uncertain'
  const unknown = await jobs.start({ ...args(), revision: restored.read().boards[0].revision })
  await until(() => jobs.read().find(row => row.id === unknown.id)?.status === 'uncertain')
  await assert.rejects(jobs.resume(unknown.id), /没有可恢复/)
  await assert.rejects(jobs.start({ ...args(), revision: restored.read().boards[0].revision }), /未确认/)
  assert.equal(mock.requests.filter(row => row.method === 'POST').length, 2)
  assert.ok(!JSON.stringify(jobs.read()).includes(mock.key))
})

test('新卡片实际注册、连线解析和验证，停用及重启保留未知类型数据', async t => {
  const f = await modelFixture(t), { directory } = await materialize(f.root, 'studio-card')
  const { default: apply } = await importFile(join(directory, 'server.js'))
  let context = owner(); f.cleanups.push(() => context.dispose())
  apply(Object.assign(context, { canvasDocuments: f.store }))
  const id = f.store.read().boards[0].id, type = argsFor('studio-card').id
  const edit = operations => f.store.edit(id, f.store.read().boards[0].revision, operations)
  await edit([{ type: 'add', node: { id: 'memo', type, body: '来自新卡片的提示词' } }, { type: 'add', node: { id: 'gen', type: 'generator' } }, { type: 'connect', id: 'edge', from: 'memo', to: 'gen' }])
  const before = f.store.read().boards[0]
  assert.equal(generationInput(before, 'gen', f.types).prompt, '来自新卡片的提示词')
  await assert.rejects(edit([{ type: 'update', id: 'memo', patch: { body: 42 } }]), /正文/)
  assert.deepEqual(f.store.read().boards[0], before)
  await context.dispose()
  assert.equal(f.types.get(type), undefined)
  const restored = await createStore(join(f.root, 'data'), writeSnapshot, f.types)
  assert.deepEqual(restored.read().boards[0], before)
  await assert.rejects(edit([{ type: 'update', id: 'memo', patch: { body: '不可写' } }]))
  context = owner(); apply(Object.assign(context, { canvasDocuments: f.store }))
  assert.equal(generationInput(f.store.read().boards[0], 'gen', f.types).prompt, '来自新卡片的提示词')
  await edit([{ type: 'update', id: 'memo', patch: { body: '恢复编辑' } }])
  assert.equal(f.store.read().boards[0].nodes[0].body, '恢复编辑')
})

test('生成服务模板通过真实任务队列落盘图片和结果卡片，去重且停用后拒绝新任务', async t => {
  const f = await modelFixture(t), { directory } = await materialize(f.root, 'studio-provider')
  const jobs = await createJobs(f.store); f.cleanups.push(() => jobs.close())
  const context = owner(); f.cleanups.push(() => context.dispose())
  const { default: apply } = await importFile(join(directory, 'server.js'))
  apply(Object.assign(context, { imageGeneration: jobs }))
  assert.equal(jobs.listProviders()[0].id, argsFor('studio-provider').id)
  const board = f.store.read().boards[0]
  const added = await f.store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'gen', type: 'generator', provider: argsFor('studio-provider').id, prompt: '本地模拟', ratio: '1:1', resolution: 'sample' } }])
  const args = { requestId: randomUUID(), boardId: board.id, nodeId: 'gen', revision: added.board.revision }
  const job = await jobs.start(args)
  assert.equal((await jobs.start(args)).id, job.id)
  await until(() => !['queued', 'running'].includes(jobs.read()[0].status))
  const result = jobs.read()[0]
  assert.equal(result.status, 'succeeded', result.error)
  const asset = f.store.read().assets[result.assetId]
  assert.equal(asset.width, 1); assert.equal(asset.height, 1)
  await sharp(await f.store.image(asset.id)).raw().toBuffer()
  const image = f.store.read().boards[0].nodes.find(node => node.type === 'image')
  assert.equal(image.assetId, asset.id); assert.equal(image.sourceNodeId, 'gen')
  assert.equal(jobs.read().length, 1)
  await context.dispose(); assert.deepEqual(jobs.listProviders(), [])
  await assert.rejects(jobs.start({ ...args, requestId: randomUUID(), revision: f.store.read().boards[0].revision }), /不可用|启用/)
})

test('Agent 模板经现有 studio 工具发现和执行，校验参数、版本、编辑状态、撤销与卸载', async t => {
  const f = await sessionFixture(t), { directory } = await materialize(f.root, 'studio-agent-action')
  const { default: apply } = await importFile(join(directory, 'client.js'))
  const menus = createRegistry(), context = owner(), tools = new Map()
  f.cleanups.push(() => context.dispose())
  apply(Object.assign(context, { canvasSession: f.session, canvasUI: { menu: (ctx, entry) => menus.register(ctx, entry) } }))
  agentTools({ canvasSession: f.session }, { agent: { register: (schema, callback) => tools.set(schema.name, callback) } })
  const read = tools.get('studio_read'), action = tools.get('studio_action'), id = argsFor('studio-agent-action').id
  assert.equal(read().actions.find(entry => entry.id === id).schema.properties.title.maxLength, 120)
  const revision = read().board.revision
  await assert.rejects(action({ id, revision, args: { title: '', extra: true } }), /画板名称/)
  await assert.rejects(action({ id, revision: revision + 1, args: { title: '旧读取' } }), /studio_read/)
  f.session.editing = true
  await assert.rejects(action({ id, revision, args: { title: '编辑中' } }), /studio_read/)
  f.session.editing = false
  const result = await action({ id, revision, args: { title: '  Agent 修改  ' } })
  assert.equal(result.revision, read().board.revision)
  assert.equal(f.store.read().boards[0].title, 'Agent 修改')
  const inverse = f.session.undo.get(f.session.boardId).at(-1)
  await f.session.edit(inverse, { history: false })
  assert.equal(read().board.title, '我的灵感画板')
  await menus.require(id).run()
  assert.equal(read().board.title, parameters['studio-agent-action'].boardTitle)
  await context.dispose()
  assert.ok(!read().actions.some(entry => entry.id === id)); assert.equal(menus.get(id), undefined)
  await assert.rejects(action({ id, revision: read().board.revision, args: { title: '停用' } }), /不可用/)
})

test('Agent 异步业务在写保护内启动，读取已保存快照并响应停用', async t => {
  const f = await sessionFixture(t), { directory } = await materialize(f.root, 'studio-agent-action')
  await writeFile(join(directory, 'action-default.js'), await readFile(join(directory, 'action.js')))
  await writeFile(join(directory, 'action.js'), [
    "import { operations as validate } from './action-default.js'",
    "export { id, label, schema } from './action-default.js'",
    'export let calls = 0, context, release',
    'const gate = new Promise(resolve => { release = resolve })',
    'export async function operations(args, current) {',
    '  calls++; context = current',
    '  const changes = validate(args)',
    '  await gate; return changes',
    '}',
  ].join(String.fromCharCode(10)))
  const business = await importFile(join(directory, 'action.js'))
  const { default: apply } = await importFile(join(directory, 'client.js'))
  const context = owner(); f.cleanups.push(() => context.dispose())
  apply(Object.assign(context, { canvasSession: f.session, canvasUI: { menu() {} } }))
  const action = f.session.actions.require(argsFor('studio-agent-action').id)
  await assert.rejects(action.run({ title: '过期', revision: f.session.board().revision + 1 }), /studio_read/)
  assert.equal(business.calls, 0, '旧版本不得启动异步业务')
  f.session.draft({ ...f.session.board(), id: f.session.titleDraftId }, 'title', '用户待保存的名称')
  const pending = action.run({ title: '异步结果' })
  await until(() => business.calls === 1)
  assert.equal(business.context.board.title, '用户待保存的名称')
  assert.equal(business.context.board.revision, f.session.board().revision)
  await assert.rejects(action.run({ title: '重复请求' }), /正在执行/)
  assert.equal(business.calls, 1, '重复调用不得启动第二次异步业务')
  await context.dispose()
  assert.equal(business.context.signal.aborted, true)
  business.release(); await assert.rejects(pending)
  assert.equal(f.store.read().boards[0].title, '用户待保存的名称')
})

test('共享写回保护在真实 session 中拒绝新草稿、已保存更改、外部冲突、切板及停用', async t => {
  for (const change of ['draft', 'saved', 'external', 'switch', 'dispose']) {
    const f = await sessionFixture(t), { directory } = await materialize(f.root, 'studio-action')
    const { createMutation } = await importFile(join(directory, 'mutation.js'))
    const context = owner(); f.cleanups.push(() => context.dispose())
    const mutate = createMutation(context, f.session)
    let release, entered
    const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
    const originalId = f.session.boardId
    const pending = mutate(async () => { entered(); await gate; return [{ type: 'rename', title: '不应写入' }] })
    await started
    if (change === 'draft' || change === 'saved') {
      f.session.draft({ ...f.session.board(), id: f.session.titleDraftId }, 'title', '用户继续输入')
      if (change === 'saved') await f.session.flush()
    }
    if (change === 'external') await f.store.edit(originalId, f.session.board().revision, [{ type: 'rename', title: '其他页面修改' }])
    if (change === 'switch') await f.session.newBoard('另一画板')
    if (change === 'dispose') await context.dispose()
    release(); await assert.rejects(pending)
    assert.notEqual(f.store.read().boards.find(board => board.id === originalId).title, '不应写入', change)
    if (change === 'draft') assert.equal(f.session.drafts.get(f.session.titleDraftId).patch.title, '用户继续输入')
    if (change === 'saved') assert.equal(f.store.read().boards[0].title, '用户继续输入')
    if (change === 'external') {
      assert.equal(f.store.read().boards[0].title, '其他页面修改')
      assert.match(f.toasts.shift(), /保存失败.*本地修改已保留/)
      assert.equal(f.session.read().dirty, true)
    }
  }
})

async function applicationFixture(t) {
  const f = await fixture(t), app = join(f.root, 'applications/studio')
  await cp(appRoot, app, { recursive: true, filter: path => !/[\\/](?:node_modules|dist)(?:[\\/]|$)/.test(path) })
  for (const folder of await readdir(join(app, 'plugins'))) {
    const modules = join(appRoot, 'plugins', folder, 'node_modules')
    if (await lstat(modules).catch(() => null)) await symlink(modules, join(app, 'plugins', folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    if (folder.startsWith('image-provider-')) {
      const file = join(app, 'plugins', folder, 'package.json'), pkg = JSON.parse(await readFile(file, 'utf8'))
      pkg.cordis.defaultEnabled = false
      await writeFile(file, JSON.stringify(pkg, null, 2))
    }
  }
  for (const template of templates) await scaffoldPlugin(f.root, 'studio', argsFor(template))
  for (const recipe of recipes) {
    const args = recipeArgs(recipe)
    await scaffoldPlugin(f.root, 'studio', args)
    const directory = join(app, 'plugins', args.id)
    await cp(join(directory, recipe, 'package.json'), join(directory, 'package.json'))
  }
  await buildPlugins(join(app, 'plugins'))
  return { ...f, app }
}

test('五种模板和两个配方可经工作台脚手架创建并真实构建', async t => {
  const { app } = await applicationFixture(t)
  for (const args of [...templates.map(argsFor), ...recipes.map(recipeArgs)]) {
    const directory = join(app, 'plugins', args.id)
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    for (const task of pkg.cordis.build) assert.ok((await readFile(join(directory, 'dist', task.output), 'utf8')).length)
  }
})

test('五类画布模板和两个配方通过真实公共浏览器场景及本地生成', { skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 300000 }, async t => {
  const { root, app, cleanups } = await applicationFixture(t)
  for (const template of templates) {
    const v = new BrowserVerification({ root, appId: 'studio', dataDir: join(root, 'reports', template) })
    cleanups.push(() => v.close())
    try {
      await v.run('browser_open')
      await v.run('browser_plugin', { id: argsFor(template).id, enable: true })
      const scenario = async (id, parameters) => {
        const result = await v.run('browser_scenario', { id, parameters })
        assert.equal(result.ok, true, template + ': ' + JSON.stringify(result.failure))
      }
      const actionLabel = parameters[template].actionLabel
      if (template === 'studio-extension') {
        await scenario('extension-lifecycle', { pluginId: argsFor(template).id, actionLabel })
        await v.run('browser_action', { action: 'click', target: { role: 'button', name: actionLabel } })
        await v.run('browser_action', { action: 'assert', target: { css: '[data-studio-extension-panel] [role=status]' }, assertion: 'text', expected: '文字灵感 · text · 0 条连线' })
      } else if (template === 'studio-card') await scenario('card-lifecycle', { pluginId: argsFor(template).id, actionLabel, contentLabel: parameters[template].cardLabel + ' 内容' })
      else if (template === 'studio-provider') {
        await scenario('provider-lifecycle', { pluginId: argsFor(template).id })
        await v.run('browser_action', { action: 'fill', target: { css: '.studio-generator textarea' }, value: '本地模拟图片' })
        await v.run('browser_action', { action: 'press', target: { css: '.studio-generator textarea' }, value: 'Tab' })
        await v.run('browser_action', { action: 'select', target: { role: 'combobox', name: '媒体生成 分辨率' }, value: 'sample' })
        await v.run('browser_action', { action: 'click', target: { css: '.studio-generate-run' } })
        await v.run('browser_action', { action: 'assert', target: { css: '.studio-job-status' }, assertion: 'text', expected: '已生成 · 结果保留在右侧' })
        await v.run('browser_action', { action: 'assert', target: { css: '.studio-image img' }, assertion: 'visible', expected: true })
        await v.run('browser_action', { action: 'screenshot' })
      } else {
        await scenario('menu-lifecycle', { pluginId: argsFor(template).id, actionLabel })
        await scenario('rename-sample', { actionLabel, expectedTitle: parameters[template].boardTitle })
      }
      const report = await v.run('browser_finish', { result: 'passed', summary: template + ' 公共生命周期及示例业务效果' })
      assert.equal(report.status, 'passed', JSON.stringify(report.errors))
      t.diagnostic(template + ': ' + report.checks.length + ' 项浏览器断言通过')
    } catch (error) { t.diagnostic(JSON.stringify(v.progress())); throw error }
    finally { await v.close() }
  }
  for (const recipe of recipes) {
    const args = recipeArgs(recipe), settingsTitle = args.name + ' 设置'
    const v = new BrowserVerification({ root, appId: 'studio', dataDir: join(root, 'reports', recipe) })
    cleanups.push(() => v.close())
    try {
      await v.run('browser_open'); await v.run('browser_plugin', { id: args.id, enable: true })
      const action = input => v.run('browser_action', input)
      for (const id of ['settings-lifecycle', 'settings-sample']) {
        const result = await v.run('browser_scenario', { id, parameters: { pluginId: args.id, settingsTitle } })
        assert.equal(result.ok, true, recipe + ': ' + JSON.stringify(result.failure))
      }
      if (recipe === 'advanced') {
        const { startMock } = await importFile(join(app, 'plugins', args.id, 'advanced/mock-server.js'))
        const mock = await startMock(); cleanups.push(mock.close)
        await action({ action: 'click', target: { role: 'button', name: '⚙ 应用设置' } })
        await action({ action: 'assert', target: { label: settingsTitle + ' 接口地址' }, assertion: 'disabled', expected: false })
        await action({ action: 'fill', target: { label: settingsTitle + ' 接口地址' }, value: mock.origin })
        await action({ action: 'fill', target: { label: settingsTitle + ' API Key' }, value: mock.key })
        await action({ action: 'click', target: { role: 'button', name: '保存 ' + settingsTitle } })
        await action({ action: 'assert', target: { css: '[data-settings-status]' }, assertion: 'text', expected: '已配置 Key' })
        await action({ action: 'click', target: { role: 'button', name: '关闭应用设置' } })
        const scenario = await v.run('browser_scenario', { id: 'provider-lifecycle', parameters: { pluginId: args.id } })
        assert.equal(scenario.ok, true, JSON.stringify(scenario.failure))
        await action({ action: 'click', target: { role: 'button', name: '搜索并选择图片、视频模型' } })
        await action({ action: 'click', target: { role: 'button', name: '示例图片模型' } })
        await action({ action: 'fill', target: { label: '参数 steps' }, value: '3' })
        await action({ action: 'press', target: { label: '参数 steps' }, value: 'Tab' })
        await action({ action: 'fill', target: { css: '.studio-generator textarea' }, value: '进阶本机模拟图片' })
        await action({ action: 'press', target: { css: '.studio-generator textarea' }, value: 'Tab' })
        await action({ action: 'click', target: { css: '.studio-generate-run' } })
        await action({ action: 'assert', target: { css: '.studio-job-status' }, assertion: 'text', expected: '已生成 · 结果保留在右侧' })
        await action({ action: 'assert', target: { css: '.studio-image img' }, assertion: 'visible', expected: true })
        assert.equal(mock.requests.filter(row => row.method === 'POST').length, 1)
        assert.deepEqual(mock.requests[0].body, { model: 'sample-image', prompt: '进阶本机模拟图片', steps: 3 })
        await action({ action: 'reload' })
        await action({ action: 'assert', target: { css: '.studio-image img' }, assertion: 'visible', expected: true })
        await action({ action: 'screenshot' })
      }
      const report = await v.run('browser_finish', { result: 'passed', summary: recipe + ' 设置生命周期、持久化和示例业务' })
      assert.equal(report.status, 'passed', JSON.stringify(report.errors))
      t.diagnostic(recipe + ': ' + report.checks.length + ' 项浏览器断言通过')
    } catch (error) { t.diagnostic(JSON.stringify(v.progress())); throw error }
    finally { await v.close() }
  }
})
