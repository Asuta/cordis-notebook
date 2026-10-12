import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { activationFixture } from './fixtures/plugin-activation.js'

test('真实工作台页面启用插件，核对前端失败与依赖，保存保护、单选回滚和刷新重绑定', {
  skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 90000,
}, async t => {
  const f = await activationFixture(t), browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors = [], requests = []
  await page.addInitScript(() => {
    window.activationCalls = []
    window.addEventListener('message', ({ data }) => {
      if (data?.channel === 'cordis-agent' && data.type === 'call' && data.name === 'workspace_enable_plugin') window.activationCalls.push(data.args)
    })
  })
  page.on('request', request => {
    if (request.method() === 'POST' && /\/api\/plugins\/[^/]+\/toggle$/.test(request.url())) requests.push(request.postDataJSON())
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + f.wb.server.address().port)
  async function binding(previous) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const entry = [...f.wb.clients.entries()].find(([, client]) => client.appId === 'sample' && client.pageId !== previous)
      if (entry) return { clientId: entry[0], ...entry[1] }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.fail('工作台应用未完成页面连接')
  }
  const task = await binding(), enable = id => f.wb.execute(task, 'workspace_enable_plugin', { id })
  const frame = page.frameLocator('#application')
  const inner = page.frames().find(candidate => candidate.url().startsWith(f.url))
  const panel = await enable('panel')
  assert.equal(panel.running, true); assert.equal(panel.clientState, 'enabled'); assert.equal(panel.verification.client, true)
  assert.equal(panel.operation.status, 'succeeded')
  assert.equal(panel.operation.id, requests.at(-1).operationId)
  assert.equal(panel.operation.id, await inner.evaluate(() => window.activationCalls.at(-1).operationId))
  const operation = await f.wb.execute(task, 'workspace_operation_status', { id: panel.operation.id, session: panel.session })
  assert.equal(operation.status, 'succeeded'); assert.deepEqual(operation.targets, ['panel'])
  await frame.getByRole('button', { name: '插件已运行', exact: true }).waitFor({ state: 'visible' })
  const revision = (await f.read()).revision
  assert.equal((await enable('panel')).running, true); assert.equal((await f.read()).revision, revision)

  const waiting = await enable('client-waiting')
  assert.equal(waiting.running, false); assert.equal(waiting.clientState, 'waiting')
  assert.deepEqual(waiting.waitingFor, ['前端 missingClient']); assert.equal(waiting.dependencies[0].bound, false)
  const broken = await enable('client-broken')
  assert.equal(broken.enabled, true); assert.equal(broken.running, false); assert.equal(broken.clientState, 'failed')
  assert.match(broken.error, /前端失败测试/)

  await inner.evaluate(() => { document.body.dataset.activationVeto = 'true' })
  const vetoed = await enable('theme-second')
  assert.equal(vetoed.enabled, false); assert.equal(vetoed.running, false); assert.match(vetoed.operationError, /保存未完成测试/)
  assert.equal((await f.read()).plugins.find(p => p.id === 'theme-first').enabled, true)
  assert.equal((await f.read()).pendingSwitch, null)
  await inner.evaluate(() => { delete document.body.dataset.activationVeto })
  assert.equal((await enable('theme-second')).running, true)
  const switched = await f.read()
  assert.equal(switched.plugins.find(p => p.id === 'theme-first').enabled, false); assert.equal(switched.pendingSwitch, null)
  assert.deepEqual(await inner.evaluate(() => [document.body.dataset.activationPrepared, document.body.dataset.activationReleased]), ['true', 'true'])
  const rollback = await enable('theme-broken')
  assert.equal(rollback.enabled, false); assert.equal(rollback.running, false); assert.match(rollback.operationError, /主题失败测试/)
  assert.equal(rollback.operationFailure.code, 'PLUGIN_CHANGE_REJECTED')
  assert.equal(rollback.operationFailure.operationId, requests.at(-1).operationId)
  assert.equal(rollback.operation.status, 'failed'); assert.equal(rollback.operation.id, rollback.operationFailure.operationId)
  const rejected = await f.wb.execute(task, 'workspace_operation_status', { id: rollback.operationFailure.operationId, session: rollback.session })
  assert.equal(rejected.status, 'failed'); assert.equal(rejected.error.code, 'PLUGIN_CHANGE_REJECTED')
  const restored = await f.read()
  assert.equal(restored.plugins.find(p => p.id === 'theme-second').enabled, true); assert.equal(restored.pendingSwitch, null)

  await inner.evaluate(() => { document.body.dataset.activationRestoreFails = 'true' })
  const restoreFailed = await enable('theme-broken')
  assert.equal(restoreFailed.operationFailure.code, 'PLUGIN_CHANGE_REJECTED')
  assert.equal(restoreFailed.operationFailure.operationId, restoreFailed.operation.id)
  assert.equal(restoreFailed.operation.status, 'failed'); assert.match(restoreFailed.operationError, /原插件页面恢复失败/)
  await inner.evaluate(() => { delete document.body.dataset.activationRestoreFails })

  await inner.evaluate(() => location.reload())
  await binding(task.pageId)
  task.awaitingRebind = true
  assert.equal((await enable('panel')).running, true); assert.equal(task.awaitingRebind, false)
  await frame.getByRole('button', { name: '插件已运行', exact: true }).waitFor({ state: 'visible' })

  const state = await f.status()
  const response = await fetch(f.url + '/api/applications/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'other', session: state.state.session }) })
  assert.equal(response.ok, true)
  await assert.rejects(enable('panel'), /应用.*切换/)
  assert.equal((await f.read()).plugins.find(p => p.id === 'panel').enabled, false)
  assert.deepEqual(errors, [])
})
