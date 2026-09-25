import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Plugins } from '../server/host/plugins.js'
import { ClientPlugins } from '../client/host/plugin-host.js'
import { provideMounts } from '../plugins/layout/mounts.js'
import { dependencyGraph } from '../client/host/dependency-graph.js'
import { createApp } from '../server/server.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = (id, requires = [], provides = []) => ({ id, name: id, builtin: true, dependencies: [], enabled: true, state: 'enabled', serverState: 'not-applicable', client: id + '.js', generation: 1, requires: { server: [], client: requires }, provides: { server: [], client: provides } })
const sdkFor = ctx => ({ provide(name, value) { const service = new Service(ctx, name); Object.assign(service, value); return service } })

test('后端状态随 Cordis 等待、激活、服务消失及重启失败变化', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(c => { new Service(c, 'http').broadcast = () => {} })
    await ctx.plugin(Plugins, { dataDir: process.cwd(), file: 'unused' })
    const manager = ctx.plugins
    let runs = 0
    const record = { manifest: { ...spec('consumer'), client: null, requires: { server: ['testService'], client: [] } }, enabled: true, state: 'disabled', logs: [], server: { inject: ['testService'], apply() { if (++runs === 2) throw new Error('恢复失败') } } }
    manager.records.set('consumer', record)
    await manager.start('consumer')
    assert.equal(record.state, 'waiting'); assert.equal(runs, 0)
    assert.deepEqual(manager.describe(record).waitingFor, ['testService'])
    let provider = ctx.plugin(c => { new Service(c, 'testService') })
    await provider; await record.fiber
    assert.equal(record.state, 'enabled'); assert.equal(runs, 1)
    await provider.dispose(); await record.fiber
    assert.equal(record.state, 'waiting'); assert.equal(record.enabled, true)
    provider = ctx.plugin(c => { new Service(c, 'testService') })
    await provider; await assert.rejects(record.fiber.await(), /恢复失败/)
    assert.equal(record.state, 'failed')
    await Promise.resolve(); assert.match(record.error, /恢复失败/)
    await manager.start('consumer'); assert.equal(record.state, 'enabled')
  } finally { await ctx.fiber.dispose() }
})

test('前端按服务激活，无需 ID 排序；界面服务卸载清理消费者并支持替代提供者', async () => {
  const root = new Context(), children = new Set()
  const target = { append(node) { children.add(node) } }
  let starts = 0, cleanups = 0, fail = false
  const modules = {
    consumer: { default(ctx) { starts++; if (fail) throw new Error('界面重载失败'); const node = { remove() { children.delete(node); cleanups++ } }; ctx.listUI.mount(ctx, 'filters', node) } },
    first: { default(ctx, sdk) { provideMounts(sdk, 'listUI', { filters: target }) } },
    second: { default(ctx, sdk) { provideMounts(sdk, 'listUI', { filters: target }) } },
  }
  const host = new ClientPlugins(root, { sdkFor, load: async p => modules[p.id] })
  const consumer = spec('consumer', ['listUI']), first = spec('first', [], ['listUI']), second = spec('second', [], ['listUI'])
  try {
    await host.sync([consumer]); assert.equal(host.state('consumer'), 'waiting'); assert.equal(starts, 0)
    assert.deepEqual(host.describe(consumer).waitingFor, ['前端 listUI'])
    await host.sync([consumer, first]); assert.equal(host.state('consumer'), 'enabled'); assert.equal(children.size, 1)
    assert.equal(host.describe(consumer).bindings.client.listUI, 'first')
    await host.sync([consumer]); assert.equal(host.state('consumer'), 'waiting'); assert.equal(children.size, 0); assert.equal(cleanups, 1)
    await host.sync([consumer, second]); assert.equal(host.state('consumer'), 'enabled'); assert.equal(starts, 2)
    assert.equal(host.describe(consumer).bindings.client.listUI, 'second')
    const graph = dependencyGraph([host.describe(consumer), host.describe(second)])
    assert.deepEqual(graph.dependencies.get('consumer'), ['second'])
    await host.sync([consumer]); fail = true
    await host.sync([consumer, first]); assert.equal(host.state('consumer'), 'failed'); assert.match(host.describe(consumer).error, /界面重载失败/)
    fail = false; await host.retry('consumer'); assert.equal(host.state('consumer'), 'enabled'); assert.equal(children.size, 1)
    await host.sync([]); assert.equal(children.size, 0)
  } finally { await root.fiber.dispose() }
})

test('前端传输就绪门随后端状态变化，不把启用配置误作运行状态', async () => {
  const root = new Context(); let starts = 0
  const host = new ClientPlugins(root, { sdkFor, load: async () => ({ default() { starts++ } }) })
  const p = { ...spec('api'), serverState: 'waiting', state: 'waiting' }
  try {
    await host.sync([p]); assert.equal(host.describe(p).state, 'waiting'); assert.equal(starts, 0)
    const ready = { ...p, serverState: 'enabled', state: 'enabled' }
    await host.sync([ready]); assert.equal(host.describe(ready).state, 'enabled'); assert.equal(starts, 1)
    await host.sync([p]); assert.equal(host.state('api'), 'waiting')
    await host.sync([ready]); assert.equal(starts, 2)
  } finally { await root.fiber.dispose() }
})

test('实际笔记服务等待存储并自动恢复，插件包依赖不强制启动或阻止停止', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-services-'))
  const app = await createApp({ port: 0, file: join(dir, 'notes.json') })
  try {
    const manager = app.manager
    const notes = manager.records.get('notes'), api = manager.records.get('notes-api')
    const saved = await app.ctx.notes.create()
    await app.ctx.notes.update(saved.id, { title: '生命周期保存验证' })
    const before = notes.generation
    // Simulate a provider disappearing below the UI protection layer.
    await manager.stop('storage'); await notes.fiber; await api.fiber
    assert.equal(notes.state, 'waiting'); assert.equal(api.state, 'waiting')
    assert.equal(notes.enabled, true)
    await manager.start('storage'); await notes.fiber; await api.fiber
    assert.equal(notes.state, 'enabled'); assert.equal(api.state, 'enabled')
    assert.ok(notes.generation > before)
    assert.equal(app.ctx.notes.list()[0].title, '生命周期保存验证')
    const packageOnly = { manifest: { ...spec('package-only'), client: null, dependencies: ['search'] }, enabled: true, state: 'disabled', logs: [], server: { apply() {} } }
    manager.records.set('package-only', packageOnly)
    await manager.toggle('search', false); await manager.start('package-only')
    assert.equal(packageOnly.state, 'enabled')
    assert.equal(manager.records.get('search').state, 'disabled')
    await manager.toggle('search', true); await manager.toggle('search', false)
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('兼容插件只在后端就绪后导入，前端重试使用新的模块尝试号', async () => {
  const root = new Context(), attempts = []
  let broken = true
  const host = new ClientPlugins(root, { sdkFor, load: async p => { attempts.push(p.attempt); if (broken) throw new Error('模块加载失败'); return { default() {} } } })
  const plugin = { ...spec('external'), builtin: false, serverState: 'starting', state: 'starting' }
  try {
    await host.sync([plugin]); assert.equal(attempts.length, 0); assert.equal(host.state(plugin.id), 'waiting')
    const ready = { ...plugin, serverState: 'enabled', state: 'enabled', generation: 2 }
    await host.sync([ready]); assert.equal(host.state(plugin.id), 'failed')
    broken = false; await host.retry(plugin.id)
    assert.equal(host.state(plugin.id), 'enabled'); assert.equal(new Set(attempts).size, 2)
  } finally { await root.fiber.dispose() }
})

test('模块仍在加载时显示启动中，不提前报告运行中', async () => {
  const root = new Context(); let finish
  const pending = new Promise(resolve => { finish = resolve })
  const host = new ClientPlugins(root, { sdkFor, load: () => pending })
  const plugin = spec('loading')
  try {
    const sync = host.sync([plugin])
    assert.equal(host.describe(plugin).state, 'starting')
    finish({ default() {} }); await sync
    assert.equal(host.describe(plugin).state, 'enabled')
    await host.entries.get(plugin.id).fiber.dispose()
    assert.equal(host.describe(plugin).state, 'disabled')
    assert.equal(host.describe(plugin).enabled, true)
  } finally { await root.fiber.dispose() }
})

test('重试加载期间远端停用插件，迟到模块不会注册服务且可再次启用', async () => {
  const root = new Context()
  let finish, entered, loads = 0, starts = 0, cleanups = 0
  const loading = new Promise(resolve => { entered = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const module = { default(ctx, sdk) {
    starts++; sdk.provide('retryService', {})
    ctx.effect(() => () => { cleanups++ })
  } }
  const host = new ClientPlugins(root, { sdkFor, load: async () => {
    if (++loads === 1) throw new Error('首次加载失败')
    if (loads === 2) { entered(); return pending }
    return module
  } })
  const plugin = spec('retry-race'), disabled = { ...plugin, enabled: false, state: 'disabled' }
  const backend = { ...spec('pure-backend'), client: null }
  try {
    await host.sync([plugin, backend]); assert.equal(host.state(plugin.id), 'failed')
    const retry = host.retry(plugin.id)
    await loading
    await host.sync([disabled])
    finish(module); await retry
    await host.sync([disabled])
    assert.equal(starts, 0)
    assert.equal(root.get('retryService'), undefined)
    assert.equal(root.get('plugin:' + plugin.id), undefined)
    assert.equal(root.get('plugin:' + backend.id), undefined)
    assert.equal(host.entries.has(plugin.id), false)
    assert.equal(host.state(plugin.id), 'disabled')
    await host.sync([plugin])
    assert.equal(host.state(plugin.id), 'enabled'); assert.equal(starts, 1)
    await host.sync([disabled]); assert.equal(cleanups, 1)
  } finally { finish(module); await root.fiber.dispose() }
})

for (const operation of ['replace', 'dispose']) test(`模块加载期间${operation === 'replace' ? '替换代次' : '释放宿主'}，旧加载不会激活`, async () => {
  const root = new Context(), starts = []
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const host = new ClientPlugins(root, { sdkFor, load: plugin => plugin.generation === 1 ? pending : Promise.resolve({
    default(ctx, sdk) { starts.push(2); sdk.provide('replacementService', { generation: 2 }) },
  }) })
  const plugin = spec('loading-race')
  const oldModule = { default(ctx, sdk) { starts.push(1); sdk.provide('replacementService', { generation: 1 }) } }
  try {
    const first = host.sync([plugin])
    if (operation === 'replace') await host.sync([{ ...plugin, generation: 2 }])
    else await root.fiber.dispose()
    finish(oldModule); await first
    assert.deepEqual(starts, operation === 'replace' ? [2] : [])
    if (operation === 'replace') {
      assert.equal(host.state(plugin.id), 'enabled')
      assert.equal(root.get('replacementService').generation, 2)
    }
  } finally { finish(oldModule); await root.fiber.dispose() }
})

test('启动超时取消本次激活，迟到的清理只执行一次且不影响重试实例', async () => {
  const root = new Context(), releases = [], signals = [], cleaned = []
  let started = 0
  const host = new ClientPlugins(root, { sdkFor, startupTimeoutMs: 30, load: async () => ({
    default(ctx, sdk) {
      const activation = started++; signals.push(sdk.signal)
      if (activation) return () => { cleaned.push(activation) }
      return new Promise(resolve => releases.push(() => resolve(async () => {
        await Promise.resolve(); cleaned.push(activation)
      })))
    },
  }) })
  try {
    await host.sync([spec('slow')])
    assert.equal(host.state('slow'), 'failed')
    assert.equal(signals[0].aborted, true)
    await host.retry('slow')
    assert.equal(host.state('slow'), 'enabled')
    assert.equal(signals[1].aborted, false)
    releases[0]()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(cleaned, [0])
    assert.equal(host.state('slow'), 'enabled')
    await host.sync([])
    assert.equal(signals[1].aborted, true)
    assert.deepEqual(cleaned, [0, 1])
    await root.fiber.dispose()
    assert.deepEqual(cleaned, [0, 1])
  } finally { await root.fiber.dispose() }
})

test('宿主释放后仍处理迟到清理，并捕获异步清理失败', async () => {
  const root = new Context(), errors = []
  let finish, cleaned = 0
  const host = new ClientPlugins(root, { sdkFor, startupTimeoutMs: 30, load: async () => ({
    default(ctx) {
      ctx.logger.error = error => errors.push(error.message)
      return new Promise(resolve => { finish = resolve })
    },
  }) })
  try {
    await host.sync([spec('late-error')])
    await host.sync([])
    await root.fiber.dispose()
    finish(async () => { cleaned++; throw new Error('迟到清理失败') })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cleaned, 1)
    assert.ok(errors.includes('迟到清理失败'))
  } finally { await root.fiber.dispose() }
})
