import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from 'cordis'
import { createApp } from '../src/server.js'
import { ClientPlugins } from '../client/host/plugin-host.js'
import { normalizeConfig } from '../shared/config-schema.js'
import { applyConfiguration } from '../client/host/config-transaction.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-config-')), file = join(dir, 'notes.json')
  let app = await createApp({ port: 0, file })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  return { get app() { return app }, dir, async restart() { await app.close(); app = await createApp({ port: 0, file }) } }
}
const find = (app, id) => app.manager.serialize().plugins.find(p => p.id === id)

test('配置校验拒绝类型、未知字段、范围、步长和无效选项', async t => {
  const { app } = await fixture(t)
  const schema = find(app, 'notebook').settings
  assert.deepEqual(normalizeConfig(schema), { autosaveMs: 600 })
  for (const value of [0, 10001, 101, 600.5, NaN, '600', null]) assert.throws(() => normalizeConfig(schema, { autosaveMs: value }))
  assert.throws(() => normalizeConfig(schema, { extra: true }), /未知/)
  await assert.rejects(app.manager.settings.begin('note-summary', { length: 121, showCount: true }, 0), /选项/)
  await assert.rejects(app.manager.settings.begin('stats', { includeWhitespace: 'true' }, 0), /开关/)
  assert.equal(app.manager.settings.pending, null)
})

test('停用插件可保存配置，启用插件必须确认，重启保留设置与版本', async t => {
  const env = await fixture(t), settings = env.app.manager.settings
  await settings.begin('note-summary', { length: 80, showCount: false }, 0)
  assert.equal(find(env.app, 'note-summary').enabled, false)
  assert.equal(find(env.app, 'note-summary').config.length, 80)
  const staged = await settings.begin('stats', { includeWhitespace: true }, 0)
  assert.equal(staged.preview.config.includeWhitespace, true)
  assert.equal(find(env.app, 'stats').config.includeWhitespace, false)
  const diskBefore = JSON.parse(await readFile(join(env.dir, 'plugins-config.json'), 'utf8'))
  assert.equal(diskBefore.stats, undefined)
  await assert.rejects(env.app.manager.toggle('search', false), /正在应用/)
  await settings.finish(staged.pendingConfig.token, true)
  await assert.rejects(settings.begin('stats', { includeWhitespace: false }, 0), /其他页面/)
  await env.restart()
  assert.deepEqual(find(env.app, 'note-summary').config, { length: 80, showCount: false })
  assert.equal(find(env.app, 'stats').config.includeWhitespace, true)
  assert.equal(find(env.app, 'stats').configRevision, 1)
})

test('应用失败、写盘失败、确认过期和进程退出不覆盖已保存设置', async t => {
  const env = await fixture(t), settings = env.app.manager.settings
  let staged = await settings.begin('stats', { includeWhitespace: true }, 0)
  await settings.finish(staged.pendingConfig.token, false, '渲染失败')
  assert.equal(find(env.app, 'stats').config.includeWhitespace, false)
  assert.match(find(env.app, 'stats').configError, /渲染失败/)
  staged = await settings.begin('stats', { includeWhitespace: true }, 0)
  const persist = settings.persist; settings.persist = async () => { throw new Error('磁盘不可写') }
  await assert.rejects(settings.finish(staged.pendingConfig.token, true), /磁盘/)
  settings.persist = persist
  assert.equal(find(env.app, 'stats').configRevision, 0)
  staged = await settings.begin('stats', { includeWhitespace: true }, 0)
  settings.cancel(staged.pendingConfig.token, '测试超时')
  await assert.rejects(settings.finish(staged.pendingConfig.token, true), /已结束/)
  await settings.begin('stats', { includeWhitespace: true }, 0)
  await env.restart()
  assert.equal(find(env.app, 'stats').config.includeWhitespace, false)
  assert.equal(env.app.manager.settings.pending, null)
})

test('配置 HTTP 接口执行校验及并发版本保护', async t => {
  const { app } = await fixture(t), base = `http://127.0.0.1:${app.server.address().port}`
  const post = body => fetch(base + '/api/plugins/note-summary/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post({ config: { length: 99 }, expectedRevision: 0 })).status, 400)
  assert.equal((await post({ config: { length: 200 }, expectedRevision: 0 })).status, 200)
  assert.equal((await post({ config: { length: 80 }, expectedRevision: 0 })).status, 409)
})

test('前端即时配置保留插件实例，失败可补偿恢复，重启与依赖恢复使用最新配置', async t => {
  const root = new Context(); t.after(() => root.fiber.dispose())
  let starts = 0, cleanups = 0, shown, callbackCount = 0
  const plugin = { id: 'sample', name: 'sample', builtin: true, client: 'sample.js', enabled: true, state: 'enabled', serverState: 'not-applicable', generation: 1, dependencies: [], requires: { client: ['provider'] }, settings: { mode: 'live' }, configRevision: 0, config: { value: 1 } }
  const host = new ClientPlugins(root, { sdkFor: () => ({}), load: async () => ({ default(ctx, sdk) {
    starts++; shown = sdk.config.value
    if (shown === 99) throw new Error('启动拒绝')
    sdk.onConfig(next => { callbackCount++; shown = next.value; if (shown === 9) throw new Error('更新拒绝') })
    ctx.effect(() => () => { cleanups++ })
  } }) })
  let provider = root.plugin(ctx => { new Service(ctx, 'provider') }); await provider
  await host.sync([plugin]); const fiber = host.entries.get('sample').fiber
  await host.sync([{ ...plugin, configRevision: 1, config: { value: 2 } }])
  assert.equal(starts, 1); assert.equal(shown, 2); assert.equal(host.entries.get('sample').fiber, fiber)
  await host.sync([{ ...plugin, configRevision: 2, config: { value: 9 } }]); assert.equal(host.state('sample'), 'failed')
  await host.sync([{ ...plugin, configRevision: 1, config: { value: 2 } }]); assert.equal(host.state('sample'), 'enabled'); assert.equal(shown, 2)
  await provider.dispose()
  const latest = { ...plugin, configRevision: 3, config: { value: 3 } }
  await host.sync([latest]); assert.equal(host.state('sample'), 'waiting')
  provider = root.plugin(ctx => { new Service(ctx, 'provider') }); await provider; await host.sync([latest])
  assert.equal(shown, 3); assert.equal(starts, 2)
  await host.sync([{ ...latest, configRevision: 4, config: { value: 4 }, settings: { mode: 'restart' } }])
  assert.equal(shown, 4); assert.equal(starts, 3); assert.equal(cleanups, 2)
  assert.equal(callbackCount, 3)
  await host.sync([{ ...latest, configRevision: 5, config: { value: 99 }, settings: { mode: 'restart' } }])
  assert.equal(host.state('sample'), 'failed')
  await host.sync([{ ...latest, configRevision: 4, config: { value: 4 }, settings: { mode: 'restart' } }])
  assert.equal(host.state('sample'), 'enabled'); assert.equal(shown, 4)
})

test('完整配置事务补偿前端失败，并识别确认成功但响应丢失的情况', async t => {
  const { app } = await fixture(t), root = new Context(); t.after(() => root.fiber.dispose())
  let displayed = false, broken = true, loseAck = false
  const host = new ClientPlugins(root, { sdkFor: () => ({}), load: async () => ({ default(ctx, sdk) {
    displayed = sdk.config.includeWhitespace
    sdk.onConfig(config => { displayed = config.includeWhitespace; if (broken && displayed) throw new Error('测试更新失败') })
  } }) })
  const adapt = snapshot => ({ ...snapshot, plugins: snapshot.plugins.filter(p => p.id === 'stats').map(p => ({ ...p, requires: { client: [] } })) })
  let snapshot = adapt(app.manager.serialize())
  const synchronize = async () => { snapshot = adapt(app.manager.serialize()); await host.sync(snapshot.plugins) }
  await synchronize()
  const request = async (path, method, body) => {
    if (path.endsWith('/confirm')) {
      const result = adapt(await app.manager.settings.finish(body.token, body.success, body.error))
      if (loseAck && body.success) { loseAck = false; throw new Error('确认响应丢失') }
      return result
    }
    const staged = await app.manager.settings.begin('stats', body.config, body.expectedRevision)
    return { ...adapt(staged), preview: staged.preview && { ...staged.preview, requires: { client: [] } } }
  }
  const run = () => applyConfiguration({ plugin: snapshot.plugins[0], config: { includeWhitespace: true }, host, request, synchronize, getSnapshot: () => snapshot })
  await assert.rejects(run(), /测试更新失败/)
  assert.equal(displayed, false); assert.equal(find(app, 'stats').config.includeWhitespace, false); assert.equal(host.state('stats'), 'enabled')
  broken = false; loseAck = true; await run()
  assert.equal(displayed, true); assert.equal(find(app, 'stats').config.includeWhitespace, true)
})
