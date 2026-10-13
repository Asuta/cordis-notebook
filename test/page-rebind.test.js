import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPageBridge } from '../workbench/page-bridge.js'

function fixture(t) {
  const application = { mode: 'development', reloads: 1, reloadToken: 'generation-1', settle: async () => {} }
  const bridge = createPageBridge({ application, notify() {}, apps: [{ id: 'sample' }, { id: 'other' }], rebindTimeoutMs: 60 })
  t.after(() => bridge.close())
  const task = { appId: 'sample', clientId: 'client', pageId: 'page-1', session: 'session-1', reloads: 0 }
  const ready = (args = {}) => bridge.receive({ type: 'ready', clientId: 'client', appId: 'sample', pageId: 'page-1', session: 'session-1', tools: [], ...args })
  return { application, bridge, task, ready }
}
test('重载事件迟于新页面绑定到达时，按文档批次确认，无需再等一个 pageId', async t => {
  const { bridge, task, ready } = fixture(t)
  ready({ reloadToken: 'generation-1' })
  const live = await bridge.rebindPage(task)
  assert.equal(live.pageId, 'page-1'); assert.equal(task.awaitingRebind, false)
  assert.equal(task.rebind.status, 'ready'); assert.ok(task.rebind.waitedMs < 50)
})
test('旧文档、新 pageId 和过期心跳不能冒充本批次就绪；超时不重置', async t => {
  const { bridge, task, ready } = fixture(t)
  ready({ pageId: 'page-2', reloadToken: 'generation-0' })
  await assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  const deadlineStart = task.rebindStartedAt
  await assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  assert.equal(task.rebindStartedAt, deadlineStart); assert.ok(task.rebind.waitedMs < 50)
  ready({ pageId: 'page-3', reloadToken: 'generation-1' })
  bridge.clients.get('client').seen = Date.now() - 11000
  await assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  ready({ pageId: 'page-3', reloadToken: 'generation-1' })
  await bridge.rebindPage(task)
  assert.equal(task.pageId, 'page-3'); assert.equal(task.awaitingRebind, false)
})
test('后续刷新有自己的等待期限，切换应用不自动改绑，取消停止等待', async t => {
  const { application, bridge, task, ready } = fixture(t)
  ready()
  await assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  application.reloads++; application.reloadToken = 'generation-2'
  setTimeout(() => ready({ pageId: 'page-2', reloadToken: 'generation-2' }), 10)
  await bridge.rebindPage(task)
  application.reloads++; application.reloadToken = 'generation-3'
  ready({ appId: 'other', pageId: 'other-page', reloadToken: 'generation-3' })
  assert.equal((await bridge.rebindPage(task)).appId, 'other'); assert.equal(task.appId, 'sample')
  task.cancelled = true
  await assert.rejects(bridge.rebindPage(task), /停止/)
})

test('等待中的连续刷新跟进最新批次，忽略旧确认并给新批次完整期限', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const { application, bridge, task, ready } = fixture(t)
  ready()
  const pending = bridge.rebindPage(task)
  const completion = assert.doesNotReject(pending)
  await Promise.resolve()
  t.mock.timers.tick(40)
  application.reloads++; application.reloadToken = 'generation-2'
  ready({ pageId: 'old-page', reloadToken: 'generation-1' })
  t.mock.timers.tick(10); await Promise.resolve()
  const waiting = { ...task.rebind }
  t.mock.timers.tick(10); await Promise.resolve()
  ready({ pageId: 'latest-page', session: 'latest-session', reloadToken: 'generation-2' })
  t.mock.timers.tick(40); await completion
  assert.equal(waiting.status, 'waiting')
  assert.equal(waiting.expectedReloadToken, 'generation-2')
  assert.equal(task.pageId, 'latest-page'); assert.equal(task.session, 'latest-session')
  assert.equal(task.reloads, 2); assert.equal(task.awaitingRebind, false)
  assert.equal(task.rebind.elapsedMs, 50)
})

test('等待中新批次也会超时，同批次再次查询不延长期限', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const { application, bridge, task, ready } = fixture(t)
  ready()
  const completion = assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  await Promise.resolve()
  t.mock.timers.tick(40)
  application.reloads++; application.reloadToken = 'generation-2'
  t.mock.timers.tick(10); await Promise.resolve()
  t.mock.timers.tick(50); await Promise.resolve()
  t.mock.timers.tick(10); await completion
  assert.equal(task.rebind.expectedReloadToken, 'generation-2')
  assert.equal(task.rebind.elapsedMs, 60)
  const started = task.rebindStartedAt
  await assert.rejects(bridge.rebindPage(task), { code: 'PAGE_REBIND_PENDING' })
  assert.equal(task.rebindStartedAt, started)
  assert.equal(task.rebind.waitedMs, 0)
})
