import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { developmentInfo, scaffoldPlugin } from '../workbench/development-tools.js'
import { discoverBuiltins } from '../server/plugin-discovery.js'
import { buildPlugins } from '../scripts/plugin-builder.js'
import { startDevelopment } from '../scripts/dev.js'
import { createWorkbench } from '../workbench/server.js'

async function fixture(t, appId = 'sample') {
  const root = await mkdtemp(resolve('development-test-')), app = join(root, 'applications', appId), plugins = join(app, 'plugins')
  await mkdir(plugins, { recursive: true })
  await writeFile(join(app, 'package.json'), JSON.stringify({ cordisApp: { id: appId, name: '开发测试' } }))
  t.after(async () => { assert.ok(root.startsWith(resolve('development-test-'))); await rm(root, { recursive: true, force: true }) })
  return { root, app, plugins }
}

test('开发入口按绑定应用与任务返回真实契约正文、服务和示例', async () => {
  for (const appId of ['notebook', 'studio', 'drawing']) for (const focus of ['ui', 'backend', 'agent']) {
    const info = await developmentInfo(resolve('.'), appId, { focus })
    assert.equal(info.appId, appId); assert.deepEqual(info.warnings, [])
    assert.ok(info.pluginDirectory.endsWith(join('applications', appId, 'plugins')))
    for (const file of [...info.contracts, ...info.examples]) {
      assert.ok(file.content.length); assert.equal((await readFile(file.path, 'utf8')).slice(0, file.content.length), file.content)
      assert.ok(file.path.includes(join('applications', appId)) || file.path === resolve('packages/host/index.d.ts'))
    }
    assert.ok(info.templates.some(template => template.id === 'client'))
    assert.ok(info.verification.command.includes('--app ' + appId))
    if (appId === 'drawing') assert.equal(info.providers.some(provider => provider.provides.client.includes('notebook')), false)
    if (appId === 'notebook' && focus === 'ui') assert.ok(info.contracts.some(file => file.content.includes('toText(')), '包含异构笔记的正文转换契约')
  }
})

test('脚手架生成各应用完整骨架，清单与所有构建输入可真实构建', { timeout: 30000 }, async t => {
  for (const appId of ['notebook', 'studio', 'drawing']) {
    const { root, app, plugins } = await fixture(t, appId)
    await writeFile(join(app, 'development.json'), await readFile(resolve('applications', appId, 'development.json')))
    const provider = join(plugins, 'provider'); await mkdir(provider)
    await writeFile(join(provider, 'client.js'), 'export default () => {}')
    await writeFile(join(provider, 'package.json'), JSON.stringify({ name: '@test/provider', version: '1.0.0', type: 'module', cordis: {
      schemaVersion: 1, id: 'provider', name: '服务桩', client: 'client.js', public: ['client.js'],
      provides: { client: appId === 'notebook' ? ['notebook', 'shell'] : appId === 'studio' ? ['canvasUI'] : [], server: [] },
      requires: { client: [], server: [] }, build: [{ type: 'bundle', input: 'client.js', output: 'client.js', platform: 'browser' }],
    } }))
    const templates = ['client', 'server', ...(appId === 'notebook' ? ['notebook-footer'] : appId === 'studio' ? ['studio-action'] : [])]
    for (const template of templates) {
      const id = 'new-' + template, result = await scaffoldPlugin(root, appId, { id, name: '测试 "插件"', template })
      assert.equal(result.defaultEnabled, false)
      for (const file of result.files) assert.ok((await readFile(file, 'utf8')).length)
    }
    assert.equal((await readdir(plugins)).some(name => name.startsWith('.scaffold-')), false)
    await buildPlugins(plugins)
    const entries = await discoverBuiltins(plugins, { mode: 'runtime' })
    assert.equal(entries.length, templates.length + 1)
    for (const entry of entries) for (const item of entry.package.cordis.build) assert.ok((await readFile(join(entry.sourceRoot, 'dist', item.output))).length)
  }
})

test('脚手架拒绝重复目录、非法 ID、越界应用、不支持模板和取消；不覆盖原文件', async t => {
  const { root, plugins } = await fixture(t)
  const args = { id: 'small-plugin', name: '插件', template: 'client' }
  const result = await scaffoldPlugin(root, 'sample', args), original = await readFile(result.files.at(-1), 'utf8')
  await assert.rejects(scaffoldPlugin(root, 'sample', args), /已存在/)
  assert.equal(await readFile(result.files.at(-1), 'utf8'), original)
  await mkdir(join(plugins, 'empty-folder'))
  await assert.rejects(scaffoldPlugin(root, 'sample', { ...args, id: 'empty-folder' }), /清单无效|已存在/)
  await rm(join(plugins, 'empty-folder'), { recursive: true })
  await assert.rejects(scaffoldPlugin(root, 'sample', { ...args, id: '../escape' }), /参数无效/)
  await assert.rejects(scaffoldPlugin(root, '../notebook', args), /应用 ID 无效/)
  await assert.rejects(scaffoldPlugin(root, 'sample', { ...args, id: 'other-plugin', template: 'notebook-footer' }), /模板不存在/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(scaffoldPlugin(root, 'sample', { ...args, id: 'cancelled-plugin' }, { signal: controller.signal }), { name: 'AbortError' })
  assert.deepEqual(await readdir(plugins), ['small-plugin'])
})

test('脚手架不凭应用名假定服务存在，同 ID 并发只发布一份完整插件', async t => {
  const { root, app, plugins } = await fixture(t, 'notebook')
  await writeFile(join(app, 'development.json'), await readFile(resolve('applications/notebook/development.json')))
  await assert.rejects(scaffoldPlugin(root, 'notebook', { id: 'new-footer', name: '页脚', template: 'notebook-footer' }), /未提供 client 服务/)
  const args = { id: 'new-client', name: '面板', template: 'client' }
  const results = await Promise.allSettled([scaffoldPlugin(root, 'notebook', args), scaffoldPlugin(root, 'notebook', args)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.deepEqual(await readdir(plugins), ['new-client'])
  assert.equal((await discoverBuiltins(plugins, { mode: 'development' })).length, 1)
})

test('开发服务仅发现发布完成的骨架，新后端插件自动可用且不重启进程', { timeout: 30000 }, async t => {
  const { root } = await fixture(t), events = []
  const dev = await startDevelopment({ port: 0, applicationsDir: join(root, 'applications'), initialApplication: 'sample',
    dataDir: join(root, 'data'), cacheDir: join(root, 'cache'), dependencyFiles: [], onEvent: event => events.push(event) })
  t.after(() => dev.close())
  const base = 'http://127.0.0.1:' + dev.vite.httpServer.address().port
  const pid = dev.backendPid, port = dev.backendPort
  await scaffoldPlugin(root, 'sample', { id: 'new-service', name: '新服务', template: 'server', defaultEnabled: true })
  const deadline = Date.now() + 12000
  let status
  while (Date.now() < deadline) {
    const response = await fetch(base + '/api/plugins/new-service/status')
    if (response.ok) { status = await response.json(); break }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.deepEqual(status, { plugin: 'new-service', ready: true })
  assert.deepEqual(events.filter(event => event.type === 'error'), [])
  assert.equal(dev.backendPid, pid); assert.equal(dev.backendPort, port)
})

test('工作台开发工具不依赖在线页面，报告读取不开浏览器且遵守本轮开关', async t => {
  const { root } = await fixture(t)
  // Use actual repository for information, isolated storage and no running app.
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 0, autoStart: false, dataDir: join(root, 'workbench') })
  t.after(() => wb.close())
  assert.equal((await wb.execute({ appId: 'notebook' }, 'workspace_development_info', {})).appId, 'notebook')
  await assert.rejects(wb.execute({ appId: 'notebook', turn: { browserVerificationEnabled: false } }, 'browser_report', {}), /用户关闭/)
  const task = { appId: 'notebook', thread: { id: 'offline', revision: 0 }, turn: { browserVerificationEnabled: true } }
  const report = await wb.execute(task, 'browser_report', {})
  assert.equal(report.status, 'not-run'); assert.equal(task.browser.child, undefined); assert.equal(task.browser.directory, undefined)
  await task.browser.close()
})

test('开发入口使用受管理实例的隔离数据目录，离线、外部或切换应用时不误报可启用', async t => {
  const { root } = await fixture(t), appDataDir = join(root, 'isolated app data')
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: 4567, autoStart: false, dataDir: join(root, 'workbench'), appDataDir })
  t.after(() => wb.close())
  let status = { online: true, managed: true, mode: 'development', state: { current: { id: 'notebook' }, phase: 'idle', session: 'first-session' } }
  wb.application.status = async () => status
  const read = async () => (await wb.execute({ appId: 'notebook' }, 'workspace_development_info', {})).runtime
  const runtime = await read()
  assert.equal(runtime.url, 'http://127.0.0.1:4567')
  assert.equal(runtime.storage.directory, join(appDataDir, 'apps', 'notebook'))
  assert.equal(runtime.storage.stateFile, join(appDataDir, 'apps', 'notebook', 'plugins-state.json'))
  assert.equal(runtime.storage.verified, true)
  assert.equal(runtime.activation.available, true)
  assert.equal(runtime.activation.write.headers['x-application-session'], '<最新应用状态的 session>')
  assert.equal(JSON.stringify(runtime).includes('first-session'), false, '不让模型复用开发入口的过期 session')
  status = { ...status, state: { ...status.state, phase: 'switching' } }
  assert.equal((await read()).activation.available, false)
  status = { ...status, state: { current: { id: 'studio' }, phase: 'idle', session: 'new-session' } }
  const other = await read()
  assert.equal(other.matchesBoundApplication, false); assert.equal(other.activation.available, false); assert.equal(other.storage.verified, false)
  status = { online: false, managed: true, mode: 'development' }
  const offline = await read()
  assert.equal(offline.activation.available, false); assert.equal(offline.storage.verified, false)
  status = { online: false, managed: false, mode: 'external' }
  const external = await read()
  assert.equal(external.storage.directory, null); assert.equal(external.storage.stateFile, null); assert.equal(external.activation.available, false)
})
