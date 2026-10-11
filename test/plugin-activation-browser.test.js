import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { activationFixture } from './fixtures/plugin-activation.js'

test('真实工作台页面启用插件，核对前端失败与依赖，保存保护、单选回滚和刷新重绑定', {
  skip: process.env.CORDIS_BROWSER_TEST !== '1', timeout: 90000,
}, async t => {
  const f = await activationFixture(t), browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage(), errors = []
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
  const panel = await enable('panel')
  assert.equal(panel.running, true); assert.equal(panel.clientState, 'enabled'); assert.equal(panel.verification.client, true)
  await frame.getByRole('button', { name: '插件已运行', exact: true }).waitFor({ state: 'visible' })
  const revision = (await f.read()).revision
  assert.equal((await enable('panel')).running, true); assert.equal((await f.read()).revision, revision)

  const waiting = await enable('client-waiting')
  assert.equal(waiting.running, false); assert.equal(waiting.clientState, 'waiting')
  assert.deepEqual(waiting.waitingFor, ['前端 missingClient']); assert.equal(waiting.dependencies[0].bound, false)
  const broken = await enable('client-broken')
  assert.equal(broken.enabled, true); assert.equal(broken.running, false); assert.equal(broken.clientState, 'failed')
  assert.match(broken.error, /前端失败测试/)

  const inner = page.frames().find(candidate => candidate.url().startsWith(f.url))
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
  const restored = await f.read()
  assert.equal(restored.plugins.find(p => p.id === 'theme-second').enabled, true); assert.equal(restored.pendingSwitch, null)

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
