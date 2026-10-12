import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createHost } from '../server/server.js'
import { Operations } from '../server/host/operations.js'
import { createRequest } from '../client/host/request.js'
import { createPageBridge } from '../workbench/page-bridge.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-operations-')), app = await createApp({ port: 0, file: join(dir, 'notes.json') })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + app.server.address().port
  return { app, request: createRequest(app.applications.session, (path, options) => fetch(base + path, options)) }
}

test('同编号并发操作只执行一次，不同参数拒绝，失败仍可查询且不会重放', async () => {
  const ledger = new Operations(() => ({ plugins: [] })), calls = []
  let release; const gate = new Promise(resolve => { release = resolve })
  const action = async () => { calls.push(1); await gate; return {} }
  const first = ledger.run('test', ['demo'], { a: 1, b: 2 }, 'same', action)
  const second = ledger.run('test', ['demo'], { b: 2, a: 1 }, 'same', action)
  await assert.rejects(ledger.run('test', ['demo'], { a: 2 }, 'same', action), { code: 'OPERATION_ID_REUSED' })
  release(); await Promise.all([first, second]); assert.equal(calls.length, 1)
  assert.equal(ledger.get('same').status, 'succeeded')
  const fail = () => { calls.push(1); throw Error('测试失败') }
  await assert.rejects(ledger.run('test', [], {}, 'failed', fail), { code: 'OPERATION_FAILED', operationId: 'failed' })
  await assert.rejects(ledger.run('test', [], {}, 'failed', fail), /测试失败/)
  assert.equal(calls.length, 2); assert.equal(ledger.get('failed').status, 'failed')
})

test('配置操作经历等待页面和完成，重复请求不增加版本；拒绝和超时保留明确失败', async t => {
  const { app, request } = await fixture(t)
  const payload = { config: { includeWhitespace: true }, expectedRevision: 0, operationId: 'configure' }
  const staged = await request('/api/plugins/stats/config', 'POST', payload)
  assert.equal(staged.operation.status, 'awaiting-client')
  assert.equal((await request('/api/operations/configure')).status, 'awaiting-client')
  assert.equal((await request('/api/plugins/stats/config', 'POST', payload)).pendingConfig.token, staged.pendingConfig.token)
  const result = await request('/api/plugins/config/confirm', 'POST', { token: staged.pendingConfig.token, success: true })
  assert.equal(result.operation.status, 'succeeded')
  const duplicate = await request('/api/plugins/stats/config', 'POST', payload)
  assert.equal(duplicate.preview, undefined); assert.equal(duplicate.plugins.find(p => p.id === 'stats').configRevision, 1)
  await assert.rejects(request('/api/plugins/stats/config', 'POST', { ...payload, operationId: 'stale' }), { code: 'CONFIG_REVISION_CONFLICT' })
  const next = await request('/api/plugins/stats/config', 'POST', { config: { includeWhitespace: false }, expectedRevision: 1, operationId: 'cancel' })
  await app.manager.settings.cancel(next.pendingConfig.token, '模拟页面确认超时')
  assert.equal((await request('/api/operations/cancel')).error.code, 'CONFIG_CHANGE_REJECTED')
  assert.equal((await request('/api/operations/cancel')).status, 'failed')
  assert.equal(app.manager.settings.describe(app.manager.records.get('stats')).config.includeWhitespace, true)
})

test('HTTP 响应丢失后先查询，不重新执行已经完成的插件操作', async t => {
  const { app } = await fixture(t), base = 'http://127.0.0.1:' + app.server.address().port, calls = []
  let lost = false
  const request = createRequest(app.applications.session, async (path, options) => {
    calls.push([path, options.method])
    const response = await fetch(base + path, options)
    if (!lost && options.method === 'POST') { lost = true; throw Error('响应丢失') }
    return response
  })
  const result = await request('/api/plugins/search/toggle', 'POST', { enabled: false })
  assert.equal(result.operation.status, 'succeeded')
  assert.equal(result.plugins.find(p => p.id === 'search').enabled, false)
  assert.equal(calls.filter(([, method]) => method === 'POST').length, 1)
  assert.ok(calls.some(([path]) => path.startsWith('/api/operations/')))
})

test('恢复丢失响应及重复已完成请求不返回另一操作的确认 token', async t => {
  for (const kind of ['switch', 'config']) await t.test(kind, async t => {
    const { app, request: direct } = await fixture(t), base = 'http://127.0.0.1:' + app.server.address().port
    const headers = { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }
    const payload = { enabled: false, operationId: 'completed' }, field = kind === 'switch' ? 'pendingSwitch' : 'pendingConfig'
    let lost = false, other
    const request = createRequest(app.applications.session, async (path, options) => {
      const response = await fetch(base + path, options)
      if (!lost && options.method === 'POST') {
        lost = true
        other = kind === 'switch'
          ? await direct('/api/plugins/theme-rose/toggle', 'POST', { enabled: true, operationId: 'other' })
          : await direct('/api/plugins/stats/config', 'POST', { config: { includeWhitespace: true }, expectedRevision: 0, operationId: 'other' })
        throw Error('初始响应丢失，另一页面已发起新事务')
      }
      return response
    })
    const recovered = await request('/api/plugins/search/toggle', 'POST', payload)
    assert.equal(recovered.operation.id, 'completed'); assert.equal(recovered.operation.status, 'succeeded')
    assert.equal(recovered[field], null); assert.equal(recovered.preview, undefined)
    // Read raw HTTP so server replay filtering is checked independently of the client.
    const duplicate = await (await fetch(base + '/api/plugins/search/toggle', { method: 'POST', headers, body: JSON.stringify(payload) })).json()
    assert.equal(duplicate[field], null); assert.equal(duplicate.operation.id, 'completed')
    assert.equal((await direct('/api/plugins'))[field].token, other[field].token)
    assert.equal((await direct('/api/operations/other')).status, 'awaiting-client')
  })
})

test('重放已确认配置不带回新配置事务或旧预览', async t => {
  const { app, request } = await fixture(t)
  const payload = { config: { includeWhitespace: true }, expectedRevision: 0, operationId: 'old-config' }
  const first = await request('/api/plugins/stats/config', 'POST', payload)
  await request('/api/plugins/config/confirm', 'POST', { token: first.pendingConfig.token, success: true })
  const next = await request('/api/plugins/stats/config', 'POST', { config: { includeWhitespace: false }, expectedRevision: 1, operationId: 'new-config' })
  const result = await app.manager.settings.begin('stats', payload.config, payload.expectedRevision, payload.operationId)
  assert.equal(result.operation.status, 'succeeded'); assert.equal(result.pendingConfig, null); assert.equal(result.preview, undefined)
  assert.equal(app.manager.settings.pending.token, next.pendingConfig.token)
  const replay = await request('/api/plugins/stats/config', 'POST', { config: { includeWhitespace: false }, expectedRevision: 1, operationId: 'new-config' })
  assert.equal(replay.pendingConfig.token, next.pendingConfig.token); assert.equal(replay.preview.config.includeWhitespace, false)
})

test('丢失配置预览响应时使用同编号恢复待确认预览，最终仅提交一个版本', async t => {
  const { app } = await fixture(t), base = 'http://127.0.0.1:' + app.server.address().port, ids = []
  let lost = false
  const request = createRequest(app.applications.session, async (path, options) => {
    const response = await fetch(base + path, options)
    if (path === '/api/plugins/stats/config') { ids.push(JSON.parse(options.body).operationId); if (!lost) { lost = true; throw Error('预览响应丢失') } }
    return response
  })
  const preview = await request('/api/plugins/stats/config', 'POST', { config: { includeWhitespace: true }, expectedRevision: 0 })
  assert.equal(preview.operation.status, 'awaiting-client'); assert.equal(preview.preview.config.includeWhitespace, true)
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1])
  await request('/api/plugins/config/confirm', 'POST', { token: preview.pendingConfig.token, success: true })
  assert.equal(app.manager.settings.describe(app.manager.records.get('stats')).configRevision, 1)
})

test('笔记与画布使用同一启停协议，切换应用后旧会话与旧操作不混用', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-operation-apps-'))
  const app = await createHost({ port: 0, dataDir: dir, initialApplication: 'notebook' })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + app.server.address().port
  const oldRequest = createRequest(app.applications.session, (path, options) => fetch(base + path, options))
  const first = await oldRequest('/api/plugins/search/toggle', 'POST', { enabled: false, operationId: 'notebook-action' })
  assert.equal(first.operation.status, 'succeeded')
  await app.applications.switch('studio', app.applications.session)
  await assert.rejects(oldRequest('/api/operations/notebook-action'), { status: 409 })
  const request = createRequest(app.applications.session, (path, options) => fetch(base + path, options))
  await assert.rejects(request('/api/operations/notebook-action'), { code: 'OPERATION_UNKNOWN' })
  const second = await request('/api/plugins/canvas-agent-tools/toggle', 'POST', { enabled: false })
  assert.equal(second.operation.kind, first.operation.kind)
  assert.equal(second.operation.status, 'succeeded')
})

test('查询不到的写请求不自动重放，结构化错误经过页面桥接仍保持语义', async () => {
  let writes = 0
  const request = createRequest('session', async (_, options) => {
    if (options.method === 'POST') { writes++; throw Error('离线') }
    return new Response('{}', { status: 404 })
  })
  await assert.rejects(request('/api/plugins/demo/toggle', 'POST', { enabled: true, operationId: 'unknown' }), { code: 'OPERATION_RESULT_UNKNOWN', operationId: 'unknown', retryable: false })
  assert.equal(writes, 1)
  let sent
  const bridge = createPageBridge({ application: { mode: 'runtime' }, apps: [{ id: 'demo' }], notify: message => { sent = message } })
  bridge.receive({ type: 'ready', clientId: 'client', appId: 'demo', pageId: 'page', session: 'session', tools: [] })
  const pending = bridge.pageCall({ clientId: 'client', appId: 'demo', pageId: 'page', session: 'session' }, 'test')
  bridge.receive({ ...sent, type: 'result', error: '旧版本', errorDetail: { code: 'CONFIG_REVISION_CONFLICT', message: '旧版本', status: 409, retryable: false, operationId: 'original' } })
  await assert.rejects(pending, { code: 'CONFIG_REVISION_CONFLICT', status: 409, operationId: 'original' }); bridge.close()
})

test('查询与取回预览之间已经确认时，以最终响应状态为准', async () => {
  let posts = 0
  const request = createRequest('session', async (_, options) => {
    if (options.method === 'POST' && ++posts === 1) throw Error('丢失初始响应')
    return Response.json(options.method === 'POST'
      ? { plugins: [], operation: { id: 'race', status: 'succeeded' } }
      : { id: 'race', status: 'awaiting-client' })
  })
  const result = await request('/api/plugins/demo/config', 'POST', { operationId: 'race', config: {}, expectedRevision: 0 })
  assert.equal(result.operation.status, 'succeeded')
  assert.equal(result.preview, undefined)
})
