import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activationFixture } from './fixtures/plugin-activation.js'
import { enablePlugin } from '../workbench/plugin-activation.js'
import { pluginActivationResult } from '../shared/plugin-activation.js'

test('启用工具使用真实协议更新保存的停用选择，重复调用仅读取状态', async t => {
  const f = await activationFixture(t)
  const enabled = await f.enable('backend')
  assert.equal(enabled.enabled, true); assert.equal(enabled.running, true); assert.equal(enabled.serverState, 'enabled')
  assert.equal(enabled.clientState, 'not-applicable'); assert.equal(enabled.operationError, null)
  assert.equal(enabled.dependencies[0].host, true)
  assert.equal(JSON.parse(await readFile(join(f.dataDir, 'apps', 'sample', 'plugins-state.json'), 'utf8')).backend, true)
  assert.equal((await fetch(f.url + '/probe')).status, 200)
  const revision = (await f.read()).revision
  assert.equal((await f.enable('backend')).running, true)
  assert.equal((await f.read()).revision, revision)
  const client = await f.enable('panel')
  assert.equal(client.enabled, true); assert.equal(client.running, null); assert.equal(client.clientState, null)
  assert.equal(client.verification.client, false)
})

test('等待依赖和 HTTP 启用失败返回实际状态，失败的启用选择仍如实报告', async t => {
  const f = await activationFixture(t)
  const waiting = await f.enable('waiting')
  assert.equal(waiting.enabled, true); assert.equal(waiting.running, false); assert.equal(waiting.state, 'waiting')
  assert.deepEqual(waiting.waitingFor, ['missingService'])
  assert.equal(waiting.dependencies[0].bound, false); assert.deepEqual(waiting.dependencies[0].candidates, [])
  const broken = await f.enable('broken')
  assert.equal(broken.enabled, true); assert.equal(broken.running, false); assert.equal(broken.state, 'failed')
  assert.match(broken.error, /启动失败测试/); assert.match(broken.operationError, /启动失败测试/)
  assert.equal(JSON.parse(await readFile(join(f.dataDir, 'apps', 'sample', 'plugins-state.json'), 'utf8')).broken, true)
})

test('离线、未接管、开发阻塞、未知插件、非法参数与取消不写入插件状态', async t => {
  const f = await activationFixture(t), baseline = (await f.read()).revision
  for (const status of [{ online: false }, { online: true, managed: false }, { online: true, managed: true, mode: 'external' }]) {
    f.wb.application.status = async () => status
    await assert.rejects(f.enable('panel'), /受管理实例未在线/)
  }
  f.wb.application.status = async () => ({ ...await f.status(), development: { pending: true } })
  await assert.rejects(f.enable('panel'), /尚未完成/)
  f.wb.application.status = f.status
  await assert.rejects(f.enable('unknown'), /尚未发现/)
  await assert.rejects(f.enable('../panel'), /参数无效/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.wb.execute({ appId: 'sample', controller }, 'workspace_enable_plugin', { id: 'panel' }), { name: 'AbortError' })
  await assert.rejects(f.wb.execute({ appId: 'sample', cancelled: true }, 'workspace_enable_plugin', { id: 'panel' }), /任务已停止/)
  assert.equal((await f.read()).revision, baseline)
})

test('当前应用切换或 session 在读取间变更时拒绝启用，不影响另一应用同 ID 插件', async t => {
  const f = await activationFixture(t)
  f.wb.application.status = async () => {
    const old = await f.status()
    const response = await fetch(f.url + '/api/applications/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'other', session: old.state.session }) })
    assert.equal(response.ok, true)
    return old
  }
  await assert.rejects(f.enable('panel'), /应用已切换/)
  assert.equal((await f.read()).plugins.find(p => p.id === 'panel').enabled, false)
  f.wb.application.status = f.status
  await assert.rejects(f.enable('panel'), /应用已切换/)
})

test('无页面不发起单选组事务，页面超时不重放启用，双端失败和依赖结果不虚报运行', async t => {
  const f = await activationFixture(t), baseline = (await f.read()).revision
  await assert.rejects(f.enable('theme-second'), /需要连接本应用页面/)
  assert.equal((await f.read()).revision, baseline); assert.equal((await f.read()).pendingSwitch, null)
  let calls = 0
  const result = await enablePlugin('sample', { id: 'panel' }, { status: f.status, url: f.url, page: async ({ session }) => {
    calls++
    await fetch(f.url + '/api/plugins/panel/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-application-session': session }, body: JSON.stringify({ enabled: true }) })
    throw Error('页面响应超时；结果可能已执行')
  } })
  assert.equal(calls, 1); assert.equal(result.enabled, true); assert.equal(result.running, null); assert.match(result.operationError, /超时/)
  for (const clientState of ['waiting', 'failed', 'enabled']) {
    const snapshot = await f.read(), plugin = snapshot.plugins.find(p => p.id === 'panel')
    Object.assign(plugin, { state: clientState, clientState, error: clientState === 'failed' ? '前端失败' : '', waitingFor: clientState === 'waiting' ? ['前端 missingClient'] : [] })
    const observed = pluginActivationResult(snapshot, 'panel', { clientVerified: true })
    assert.equal(observed.running, clientState === 'enabled'); assert.equal(observed.clientState, clientState)
    assert.equal(observed.verification.client, true)
  }
})

test('页面验证后状态变化不返回过期的运行成功，不跨最新 session 重放', async t => {
  const f = await activationFixture(t)
  await f.enable('panel')
  const result = await enablePlugin('sample', { id: 'panel' }, { status: f.status, url: f.url, page: async ({ session }) => {
    const snapshot = await f.read()
    const observed = pluginActivationResult(snapshot, 'panel', { clientVerified: true })
    await fetch(f.url + '/api/plugins/panel/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-application-session': session }, body: JSON.stringify({ enabled: false }) })
    return { session, revision: snapshot.revision, result: observed }
  } })
  assert.equal(result.enabled, false); assert.equal(result.running, false); assert.equal(result.verification.client, false)
  assert.match(result.operationError, /发生变化/)
})
