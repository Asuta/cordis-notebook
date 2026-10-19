import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { createServer as createHTTPServer } from 'node:http'
import { ApplicationProcess } from '../workbench/processes.js'
import { createWorkbench } from '../workbench/server.js'

async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port }
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-workbench-dev-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, "process.send({type:'ready'}); process.on('message', m => { if (m.type === 'run') { process.send({type:'assistant', text:JSON.stringify(m.task)}); process.send({type:'done'}) } })")
  await writeFile(join(dir, 'config.json'), JSON.stringify({ apiKey: 'fixture-private-key' }))
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: await freePort(), dataDir: dir, appDataDir: join(dir, 'data'), autoStart: false, workerFile, appMode: 'development', ...options })
  t.after(async () => { await wb.close(); await rm(dir, { recursive: true, force: true }) })
  return wb
}

test('开发模式由工作台启动 Vite 服务，状态报告模式并能受管理重启', { timeout: 120000 }, async t => {
  const wb = await fixture(t)
  const status = await wb.application.start()
  assert.equal(status.online, true); assert.equal(status.mode, 'development')
  assert.equal(status.managed, true)
  const base = 'http://127.0.0.1:' + wb.application.port
  assert.ok((await (await fetch(base)).text()).includes('/@vite/client'))
  assert.equal((await fetch(base + '/server/server.js')).status, 404)
  const first = wb.application.child.pid
  const identity = await (await fetch(base + '/__cordis/identity')).json()
  assert.equal(identity.pid, first); assert.equal(identity.session, wb.application.session)
  await wb.application.restart()
  assert.notEqual(wb.application.child.pid, first)
  assert.notEqual(wb.application.session, identity.session)
  assert.equal((await wb.application.status()).online, true)
})

test('开发工作台识别外部服务及旧开发会话，正式模式保留外部连接', async t => {
  let identity = null
  const external = createHTTPServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/__cordis/identity') { res.statusCode = identity ? 200 : 404; res.end(JSON.stringify(identity)); return }
    res.end(JSON.stringify({ current: { id: 'notebook' } }))
  })
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { external.closeAllConnections(); external.close(resolve) }))
  const options = { root: resolve('.'), dataDir: './data', port: external.address().port, commands: {} }
  const dev = new ApplicationProcess({ ...options, mode: 'development' })
  const state = await dev.status()
  assert.equal(state.online, false); assert.equal(state.mode, 'external'); assert.equal(state.managed, false)
  assert.match(state.error, /被其他服务占用/)
  assert.equal(dev.child, null)
  identity = { mode: 'development', pid: 123, session: 'old-session' }
  dev.child = { pid: 123 }; dev.session = 'new-session'
  assert.equal((await dev.status()).mode, 'external')
  identity.session = dev.session; identity.pid = 456
  assert.equal((await dev.status()).mode, 'external')
  dev.child = null
  const runtime = new ApplicationProcess(options)
  const connected = await runtime.start()
  assert.equal(connected.online, true); assert.equal(connected.mode, 'runtime'); assert.equal(connected.managed, false)
  const wb = await fixture(t, { appPort: external.address().port })
  const base = 'http://127.0.0.1:' + wb.server.address().port
  const run = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: 'notebook', prompt: '检查连接' }) })
  assert.equal(run.status, 200)
  let task
  for (let i = 0; i < 100; i++) {
    const state = await (await fetch(base + '/api/state')).json()
    if (!state.activeThreadId && state.threads[0]?.messages.at(-1)?.role === 'assistant') { task = JSON.parse(state.threads[0].messages.at(-1).text); break }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(task); assert.equal(task.appMode, 'external'); assert.equal(task.appOnline, false)
  assert.equal(task.appManaged, false); assert.match(task.appError, /被其他服务占用/)
})

test('应用端口被占用时继续向上寻找可用端口', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-workbench-app-port-'))
  await mkdir(join(dir, 'scripts'), { recursive: true })
  // Stand-in for scripts/dev.js: binds ${PORT} and answers the identity/workbench probes.
  await writeFile(join(dir, 'scripts/dev.js'), [
    "const http = require('node:http')",
    "const port = Number(process.env.PORT)",
    "const server = http.createServer((req, res) => {",
    "  res.setHeader('Content-Type', 'application/json')",
    "  if (req.url === '/__cordis/identity') return res.end(JSON.stringify({ mode: 'development', session: process.env.CORDIS_DEV_SESSION, pid: process.pid }))",
    "  res.end(JSON.stringify({ current: { id: 'notebook' } }))",
    "})",
    "server.listen(port, '127.0.0.1', () => { if (process.connected) process.send({ type: 'cordis-vite', port }) })",
    "process.on('message', message => { if (message?.type === 'workbench-shutdown') server.close(() => process.exit(0)) })",
  ].join('\n'))
  const blocked = createHTTPServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{}') })
  await new Promise(resolve => blocked.listen(0, '127.0.0.1', resolve))
  const startPort = blocked.address().port
  const app = new ApplicationProcess({ root: dir, port: startPort, dataDir: join(dir, 'data'), commands: {}, mode: 'development' })
  t.after(async () => {
    if (app.child) await app.stop().catch(() => {})
    await new Promise(resolve => { blocked.closeAllConnections(); blocked.close(resolve) })
    await rm(dir, { recursive: true, force: true })
  })
  const status = await app.start()
  assert.equal(status.online, true); assert.equal(status.managed, true)
  assert.ok(app.port > startPort, `应跳过被占用的 ${startPort}，实际 ${app.port}`)
  const identity = await (await fetch(`http://127.0.0.1:${app.port}/__cordis/identity`)).json()
  assert.equal(identity.pid, app.child.pid); assert.equal(identity.session, app.session)

  // Port 0 means "let the system choose"; it must not be reported as occupied.
  await app.stop()
  const ephemeral = new ApplicationProcess({ root: dir, port: 0, dataDir: join(dir, 'data'), commands: {}, mode: 'development' })
  t.after(async () => { if (ephemeral.child) await ephemeral.stop().catch(() => {}) })
  assert.equal((await ephemeral.start()).online, true)
  assert.ok(ephemeral.port > 0)
  assert.ok(!ephemeral.logs.some(log => log.text.includes('端口 0')), '端口 0 不应被当成占用')
  await ephemeral.stop()
})

test('应用端口上是另一个 Cordis 实例时不会另起第二个', async t => {
  const blocked = createHTTPServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/__cordis/identity') { res.end(JSON.stringify({ mode: 'development', session: 'other-session', pid: 4242 })); return }
    res.end(JSON.stringify({ current: { id: 'notebook' } }))
  })
  await new Promise(resolve => blocked.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { blocked.closeAllConnections(); blocked.close(resolve) }))
  const app = new ApplicationProcess({ root: resolve('.'), port: blocked.address().port, dataDir: join(tmpdir(), 'unused'), commands: {}, mode: 'development' })
  await assert.rejects(app.start(), /被其他服务占用/)
  assert.equal(app.child, null)
  assert.equal(app.port, blocked.address().port, '检测到同项目实例时不应换端口')
})

test('同一 checkout 的并行工作台使用不同缓存，单实例重启复用自己的缓存', { timeout: 120000 }, async t => {
  const first = await fixture(t), second = await fixture(t)
  const caches = [first, second].map(wb => wb.application.env.CORDIS_VITE_CACHE_DIR)
  assert.notEqual(caches[0], caches[1])
  const statuses = await Promise.all([first.application.start(), second.application.start()])
  assert.ok(statuses.every(status => status.online && status.managed))
  for (const wb of [first, second]) {
    const html = await (await fetch(`http://127.0.0.1:${wb.application.port}/`)).text()
    assert.ok(html.includes('/@vite/client'))
  }
  await first.application.restart()
  assert.equal(first.application.env.CORDIS_VITE_CACHE_DIR, caches[0])
  assert.equal((await second.application.status()).online, true)
})

test('等待页面的状态不随事件日志截断而丢失，恢复后清除', async () => {
  const app = new ApplicationProcess({ mode: 'development', port: 1 })
  app.receive({ type: 'cordis-dev', event: { type: 'blocked', clients: [{ id: 'page', application: '笔记' }] } })
  for (let i = 0; i < 55; i++) app.receive({ type: 'cordis-dev', event: { type: 'css', paths: [] } })
  assert.equal((await app.status()).development.blocked.clients[0].id, 'page')
  app.receive({ type: 'cordis-dev', event: { type: 'unblocked' } })
  assert.equal((await app.status()).development.blocked, null)
})

test('工作台保留各页面保存阶段和耗时，解除等待后不伪报更新成功', async () => {
  const app = new ApplicationProcess({ mode: 'development', port: 1 }), startedAt = Date.now() - 1200
  app.receive({ type: 'cordis-dev', event: { type: 'save-progress', token: 'one', startedAt, clients: [{ id: 'page', application: '笔记', phase: 'queued' }] } })
  const status = await app.status()
  assert.equal(status.development.saving.clients[0].phase, 'queued')
  assert.ok(status.development.saving.clients[0].elapsedMs >= 1200)
  app.receive({ type: 'cordis-dev', event: { type: 'blocked', startedAt, clients: [{ id: 'page', application: '笔记', phase: 'saving' }] } })
  app.receive({ type: 'cordis-dev', event: { type: 'unblocked', message: '重新尝试' } })
  const resumed = (await app.status()).development
  assert.equal(resumed.saving, null); assert.equal(resumed.blocked, null)
  assert.equal(resumed.events.some(event => event.type === 'save-result' && event.status === 'completed'), false)
})

test('开发事件只返回本轮内容，Vite 刷新页面后任务自动绑定新页面', async t => {
  const wb = await fixture(t)
  const app = wb.application
  app.status = async () => ({ online: true, mode: 'development', state: { current: { id: 'notebook' }, session: 's1' }, development: { pending: false, events: app.events.slice(-20) } })
  app.receive({ type: 'cordis-dev', event: { type: 'error', message: '上一轮的旧错误' } })
  wb.clients.set('browser', { appId: 'notebook', pageId: 'p1', session: 's1', tools: [{ name: 'notebook_read' }], seen: Date.now() })
  const task = { appId: 'notebook', clientId: 'browser', pageId: 'p1', session: 's1', devSequence: app.sequence, reloads: app.reloads }
  // Busy blocks status until the queued update reports idle.
  app.child = {}
  app.receive({ type: 'cordis-dev', event: { type: 'busy' } })
  const reading = wb.execute(task, 'workspace_status', {})
  setTimeout(() => {
    app.receive({ type: 'cordis-dev', event: { type: 'plugins', targets: { notebook: ['editor'] } } })
    app.receive({ type: 'cordis-dev', event: { type: 'reload' } })
    app.receive({ type: 'cordis-dev', event: { type: 'idle' } })
  }, 700)
  const result = await reading
  assert.deepEqual(result.development.events.map(event => event.type), ['plugins', 'reload'])
  // The reloaded page registers again with a new page id; the task follows it.
  setTimeout(() => wb.clients.set('browser', { appId: 'notebook', pageId: 'p2', session: 's1', tools: [{ name: 'notebook_read' }], seen: Date.now() }), 200)
  const tools = await wb.execute(task, 'app_list_tools', {})
  assert.equal(tools.pageId, 'p2'); assert.equal(task.pageId, 'p2')
  app.child = null
})
