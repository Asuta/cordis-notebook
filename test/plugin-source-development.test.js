import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rename, rm } from 'node:fs/promises'
import { resolve, join, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startDevelopment, preflightHost } from '../scripts/dev.js'
import { buildPlugins } from '../scripts/plugin-builder.js'

async function eventually(check, label) {
  const end = Date.now() + 12000
  while (Date.now() < end) { if (await check()) return; await delay(60) }
  assert.fail('等待失败：' + label)
}
async function fixture(t, { setup, initialApplication = 'sample' } = {}) {
  const dir = await mkdtemp(resolve('source-test-')), apps = join(dir, 'applications'), plugins = join(apps, 'sample/plugins'), stamp = join(dir, 'dependency-stamp')
  await mkdir(plugins, { recursive: true })
  await writeFile(join(apps, 'sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '源码测试' } }))
  await writeFile(stamp, '0')
  async function add(id, { client, server, dependencies = {}, requires = [], provides = [], enabled = true, settings, files = {}, serverInput = 'server.js', application = 'sample' } = {}) {
    const folder = join(apps, application, 'plugins', id)
    await mkdir(folder, { recursive: true })
    for (const [name, contents] of Object.entries({ ...files, ...(client ? { 'client.jsx': client } : {}), ...(server ? { [serverInput]: server } : {}) })) await writeFile(join(folder, name), contents)
    const manifest = { name: '@test/' + id, version: '1.0.0', type: 'module', dependencies,
      cordis: { schemaVersion: 1, id, name: id, defaultEnabled: enabled, requires: { client: [], server: requires }, provides: { client: [], server: provides },
        ...(client ? { client: 'client.js' } : {}), ...(server ? { server: { entry: 'server.js', export: 'default' } } : {}), ...(settings ? { settings } : {}),
        public: client ? ['client.js'] : [], build: [
          ...(client ? [{ type: 'bundle', input: 'client.jsx', output: 'client.js', platform: 'browser' }] : []),
          ...(server ? [{ type: 'bundle', input: serverInput, output: 'server.js', platform: 'node' }] : []),
        ],
      },
    }
    await writeFile(join(folder, 'package.json'), JSON.stringify(manifest))
    return { folder, manifest }
  }
  await add('stable', { requires: ['http'], server: String.raw`export default ctx => { const token = Math.random(); ctx.http.route(ctx, 'GET', /^\/api\/stable$/, () => ({ pid: process.pid, token })) }` })
  const events = []
  let dev
  t.after(async () => { await dev?.close(); assert.ok(dir.startsWith(resolve('.') + sep)); await rm(dir, { recursive: true, force: true }) })
  await setup?.({ add, apps, dir })
  dev = await startDevelopment({ port: 0, dataDir: join(dir, 'data'), cacheDir: join(dir, 'cache'), applicationsDir: apps, initialApplication, dependencyFiles: [stamp], onEvent: event => events.push(event) })
  const base = 'http://127.0.0.1:' + dev.vite.httpServer.address().port
  const json = async path => (await fetch(base + path)).json()
  const state = () => json('/api/plugins')
  const find = async id => (await state()).plugins.find(p => p.id === id)
  const mutate = async (path, input) => {
    const session = (await state()).application.session
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': session }, body: JSON.stringify(input) })
    const result = await response.json(); assert.equal(response.ok, true, JSON.stringify(result)); return result
  }
  return { dir, plugins, stamp, dev, events, base, add, json, state, find, mutate }
}

test('插件构建后撤销源码留下 dist，开发应用仍能启动并重新发现恢复的插件', { timeout: 60000 }, async t => {
  const server = "export default ctx => ctx.http.route(ctx, 'GET', new RegExp('^/api/restored$'), () => ({ ok: true }))"
  let removed
  const f = await fixture(t, { setup: async ({ add, apps }) => {
    removed = await add('removed', { requires: ['http'], server })
    await buildPlugins(join(apps, 'sample/plugins'))
    await rm(join(removed.folder, 'package.json'))
    await rm(join(removed.folder, 'server.js'))
  } })
  const before = await f.json('/api/stable')
  assert.equal(await f.find('removed'), undefined)
  assert.equal((await fetch(f.base + '/api/restored')).status, 404, '残留后端产物不能被执行')
  assert.ok(await readFile(join(removed.folder, 'dist/server.js'), 'utf8'))
  await f.add('removed', { requires: ['http'], server })
  await eventually(async () => (await f.find('removed'))?.state === 'enabled', '恢复清单与源码后重新接入')
  assert.deepEqual(await f.json('/api/restored'), { ok: true })
  assert.deepEqual(await f.json('/api/stable'), before)
  assert.equal(f.dev.backendPid, before.pid)
})

test('重复清单与依赖扫描不请求页面保存，错误清单恢复会通知浏览器，应用元数据变化仍会更新', { timeout: 60000 }, async t => {
  const f = await fixture(t), before = await f.json('/api/stable'), revision = (await f.state()).revision
  const socket = new WebSocket(f.base.replace('http:', 'ws:') + '/?token=' + f.dev.vite.config.webSocketToken, 'vite-hmr')
  t.after(() => socket.close())
  let prepares = 0
  const messages = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    messages.push(message)
    if (message.event === 'cordis:prepare') {
      prepares++
      socket.send(JSON.stringify({ type: 'custom', event: 'cordis:prepared', data: { token: message.data.token, success: true } }))
    }
  })
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  socket.send(JSON.stringify({ type: 'custom', event: 'cordis:ready', data: { application: '测试页面' } }))
  const manifest = join(f.plugins, 'stable/package.json')
  await writeFile(manifest, await readFile(manifest))
  await eventually(() => f.events.some(event => event.type === 'noop'), '重复清单完成空扫描')
  const count = f.events.filter(event => event.type === 'noop').length
  await writeFile(f.stamp, 'installed')
  await eventually(() => f.events.filter(event => event.type === 'noop').length > count, '安装标记不引发无变化重载')
  assert.equal(prepares, 0); assert.equal((await f.state()).revision, revision)
  assert.deepEqual(await f.json('/api/stable'), before)
  const original = await readFile(manifest), version = (await f.json('/__cordis/dev')).version
  await writeFile(manifest, '{')
  await eventually(() => messages.some(message => message.type === 'error'), '无效清单向浏览器报告错误')
  const afterError = messages.length
  await writeFile(manifest, original)
  await eventually(() => messages.slice(afterError).some(message => message.event === 'cordis:unchanged'), '恢复原清单后通知浏览器清除错误')
  assert.equal(prepares, 0); assert.equal((await f.state()).revision, revision)
  assert.equal((await f.json('/__cordis/dev')).version, version)
  assert.deepEqual(await f.json('/api/stable'), before)
  assert.equal(messages.some(message => ['cordis:catalog', 'cordis:plugins', 'cordis:restart'].includes(message.event)), false)
  await writeFile(join(f.dir, 'applications/sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '改名后的应用' } }))
  await eventually(async () => (await f.json('/api/applications')).current?.name === '改名后的应用', '仅应用元数据变化不能被忽略')
  assert.ok(prepares > 0); assert.deepEqual(await f.json('/api/stable'), before)
})

test('源码模式新增前后端插件不生成 dist、不重启，服务替换与失败回滚不影响无关插件', { timeout: 60000 }, async t => {
  const f = await fixture(t), before = await f.json('/api/stable'), port = f.dev.backendPort
  const frontend = await f.add('fresh-ui', { client: 'export default () => <span>123</span>' })
  await eventually(async () => (await f.find('fresh-ui'))?.state === 'enabled', '新增前端登记')
  const map = await f.json('/__cordis/dev'), resource = map.plugins.sample['fresh-ui'].client
  assert.match(await (await fetch(f.base + resource)).text(), /123/)
  await assert.rejects(readFile(join(frontend.folder, 'dist/client.js')), { code: 'ENOENT' })
  assert.deepEqual(await f.json('/api/stable'), before)
  await f.add('consumer', { requires: ['http', 'liveValue'], server: String.raw`export default ctx => { const value = ctx.liveValue.value; ctx.http.route(ctx, 'GET', /^\/api\/value$/, () => ({value})) }` })
  await eventually(async () => (await f.find('consumer'))?.state === 'waiting', '消费者等待提供者')
  const provider = await f.add('provider', { dependencies: { cordis: '4.0.0-rc.10' }, provides: ['liveValue'], serverInput: 'server.ts',
    files: { 'value.ts': 'export const value: number = 1' },
    server: String.raw`import { Service } from 'cordis'; import { value } from './value.ts'; export default ctx => { new Service(ctx, 'liveValue').value = value }`,
  })
  await eventually(async () => (await f.json('/api/value')).value === 1, 'TypeScript 提供者激活消费者')
  const consumerGeneration = (await f.find('consumer')).generation
  await writeFile(join(provider.folder, 'value.ts'), 'export const value: number = 2')
  await eventually(async () => (await f.json('/api/value')).value === 2, '相对依赖源码更新')
  assert.ok((await f.find('consumer')).generation > consumerGeneration)
  assert.deepEqual(await f.json('/api/stable'), before)
  assert.equal(f.dev.backendPort, port); assert.equal(f.dev.backendPid, before.pid)
  await assert.rejects(readFile(join(provider.folder, 'dist/server.js')), { code: 'ENOENT' })
  assert.equal((await fetch(f.base + '/@fs/' + join(provider.folder, 'server.ts').split(sep).join('/'))).status, 404)
  const errors = f.events.filter(e => e.type === 'error').length
  await writeFile(join(provider.folder, 'server.ts'), `export default ctx => { throw Error('测试激活失败') }`)
  await eventually(() => f.events.filter(e => e.type === 'error').length > errors, '激活失败报错')
  await eventually(async () => (await f.json('/api/value')).value === 2, '旧服务与消费者恢复')
  assert.deepEqual(await f.json('/api/stable'), before)
  await writeFile(join(provider.folder, 'server.ts'), `import { Service } from 'cordis'; export default ctx => { new Service(ctx, 'liveValue').value = 3 }`)
  await eventually(async () => (await f.json('/api/value')).value === 3, '修正后恢复')
  assert.equal(f.dev.backendPid, before.pid)
  assert.equal(f.events.filter(e => e.type === 'reload').length, 0)
})

test('前后端共享源码更新会刷新浏览器子模块 URL，且不重启后端', { timeout: 60000 }, async t => {
  const f = await fixture(t), before = await f.json('/api/stable')
  const item = await f.add('shared-code', { requires: ['http'],
    files: { 'shared.js': 'export const value = 1' },
    client: "import { value } from './shared.js'; export default () => value",
    server: `import { value } from './shared.js'; export default ctx => ctx.http.route(ctx, 'GET', new RegExp('^/api/shared$'), () => ({value}))`,
  })
  await eventually(async () => (await f.json('/api/shared')).value === 1, '共享插件就绪')
  const firstMap = await f.json('/__cordis/dev'), entry = firstMap.plugins.sample['shared-code'].client
  const text = async url => { const response = await fetch(new URL(url, f.base)); assert.equal(response.status, 200); return response.text() }
  const childURL = code => { const match = code.match(/from\s+["']([^"']*shared\.js[^"']*)["']/); assert.ok(match, code); return match[1] }
  const firstChild = childURL(await text(entry + '?t=' + firstMap.version))
  assert.match(await text(firstChild), /value = 1/)
  const updates = f.events.filter(e => e.type === 'plugins').length
  await writeFile(join(item.folder, 'shared.js'), 'export const value = 2')
  await eventually(() => f.events.filter(e => e.type === 'plugins').length > updates, '联合重载完成')
  assert.equal((await f.json('/api/shared')).value, 2)
  const secondMap = await f.json('/__cordis/dev')
  const secondChild = childURL(await text(entry + '?t=' + secondMap.version))
  assert.notEqual(secondChild, firstChild, '浏览器不能复用旧子模块 URL')
  assert.match(await text(secondChild), /value = 2/)
  assert.deepEqual(await f.json('/api/stable'), before)
  assert.equal(f.events.filter(e => e.type === 'reload').length, 0)
})

for (const initialFailure of [true, false]) test(`${initialFailure ? '首次启动' : '切换应用'}缺依赖失败后，安装依赖可恢复打开应用`, { timeout: 60000 }, async t => {
  let item
  const f = await fixture(t, { initialApplication: initialFailure ? 'broken' : 'sample', async setup({ apps, add }) {
    await mkdir(join(apps, 'broken/plugins'), { recursive: true })
    await writeFile(join(apps, 'broken/package.json'), JSON.stringify({ cordisApp: { id: 'broken', name: '缺依赖应用' } }))
    item = await add('missing', { application: 'broken', requires: ['http'], dependencies: { 'fixture-late-package': '1.0.0' },
      server: `import { value } from 'fixture-late-package'; export default ctx => ctx.http.route(ctx, 'GET', new RegExp('^/api/late$'), () => ({value}))`,
    })
  } })
  const pid = f.dev.backendPid
  if (!initialFailure) await assert.rejects(f.mutate('/api/applications/switch', { id: 'broken', session: (await f.state()).application.session }))
  const failed = await f.json('/api/applications')
  assert.equal(failed.current?.id ?? null, initialFailure ? null : 'sample')
  assert.match(failed.error, /fixture-late-package/)
  const dep = join(item.folder, 'node_modules/fixture-late-package')
  await mkdir(dep, { recursive: true })
  await writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'fixture-late-package', type: 'module', exports: './index.js' }))
  await writeFile(join(dep, 'index.js'), 'export const value = 77')
  const updates = f.events.filter(e => e.type === 'plugins').length
  await writeFile(f.stamp, 'installed')
  await eventually(() => f.events.filter(e => e.type === 'plugins').length > updates, '安装结束重新发现')
  await f.mutate('/api/applications/switch', { id: 'broken', session: (await f.state()).application.session })
  assert.equal((await f.json('/api/late')).value, 77)
  assert.equal(f.dev.backendPid, pid)
})

test('宿主预检发现传递依赖的语法和路径错误，且不执行代码或写构建产物', async t => {
  const dir = await mkdtemp(resolve('host-preflight-test-'))
  t.after(async () => { assert.ok(dir.startsWith(resolve('.') + sep)); await rm(dir, { recursive: true, force: true }) })
  const entry = join(dir, 'entry.js'), dependency = join(dir, 'dependency.js')
  await writeFile(entry, "import './dependency.js'; throw Error('预检不得执行宿主')")
  await writeFile(dependency, 'export const value = (')
  await assert.rejects(preflightHost(entry), /Unexpected/)
  await writeFile(dependency, "import './missing.js'")
  await assert.rejects(preflightHost(entry), /Could not resolve/)
  await writeFile(dependency, 'export const value = 1')
  await preflightHost(entry)
  assert.deepEqual((await readdir(dir)).sort(), ['dependency.js', 'entry.js'])
  await preflightHost()
})

test('插件删除再新增保留启用选择和配置，缺失依赖安装后自动恢复且不重启', { timeout: 60000 }, async t => {
  const f = await fixture(t), before = await f.json('/api/stable')
  const item = await f.add('choice', { requires: ['http'], settings: { mode: 'restart', fields: { label: { type: 'string', label: '名称', default: '默认' } } },
    server: String.raw`export default (ctx, config) => ctx.http.route(ctx, 'GET', /^\/api\/choice$/, () => ({label: config.label}))` })
  await eventually(async () => (await f.find('choice'))?.state === 'enabled', '新增配置插件')
  await f.mutate('/api/plugins/choice/toggle', { enabled: false })
  await f.mutate('/api/plugins/choice/config', { config: { label: '保留设置' }, expectedRevision: 0 })
  const hidden = join(f.plugins, '.choice')
  await rename(item.folder, hidden)
  await eventually(async () => !(await f.find('choice')), '移除插件')
  await rename(hidden, item.folder)
  await eventually(async () => (await f.find('choice'))?.enabled === false, '恢复停用状态')
  assert.equal((await f.find('choice')).config.label, '保留设置')
  await f.mutate('/api/plugins/choice/toggle', { enabled: true })
  assert.equal((await f.json('/api/choice')).label, '保留设置')
  const count = f.events.filter(e => e.type === 'error').length
  const missing = await f.add('needs-dependency', { requires: ['http'], dependencies: { 'fixture-new-dependency': '1.0.0' },
    server: String.raw`import { value } from 'fixture-new-dependency'; export default ctx => ctx.http.route(ctx, 'GET', /^\/api\/dependency$/, () => ({value}))` })
  await eventually(() => f.events.filter(e => e.type === 'error').length > count, '缺失依赖提示')
  assert.deepEqual(await f.json('/api/stable'), before)
  const dep = join(missing.folder, 'node_modules/fixture-new-dependency')
  await mkdir(dep, { recursive: true })
  await writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'fixture-new-dependency', type: 'module', exports: './index.js' }))
  await writeFile(join(dep, 'index.js'), 'export const value = 88')
  // Model pnpm's completion stamp: no source file or plugin manifest is saved again.
  await writeFile(f.stamp, 'installed')
  await eventually(async () => (await f.json('/api/dependency')).value === 88, '安装结束后自动重试')
  assert.deepEqual(await f.json('/api/stable'), before)
  assert.equal(f.dev.backendPid, before.pid)
})
