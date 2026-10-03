import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate as tick } from 'node:timers/promises'
import { createDevelopmentSaveGuard } from '../scripts/development-save-guard.js'
import { installDevelopmentSave } from '../client/host/development-save.js'

function channel() {
  const ws = new EventEmitter()
  ws.clients = new Set(); ws.sent = []
  ws.send = (event, data) => ws.sent.push({ event, data })
  ws.last = event => ws.sent.findLast(message => message.event === event)?.data
  return ws
}
function page(ws, application) {
  const client = { socket: new EventEmitter() }
  ws.clients.add(client); ws.emit('cordis:ready', { application }, client)
  return client
}
const reply = (ws, client, token, success = true) => ws.emit('cordis:prepared', { token, success, error: success ? undefined : '保存失败' }, client)

test('页面超时保持旧服务、释放已保存页面；恢复后必须重新确认，迟到确认不能授权新一轮', async t => {
  const ws = channel(), events = [], guard = createDevelopmentSaveGuard(ws, { timeout: 40, emit: event => events.push(event) })
  t.after(() => guard.close())
  const healthy = page(ws, '正常页面'), frozen = page(ws, '停滞页面')
  let updates = 0, retries = 0
  const run = guard.run(() => updates++, () => retries++)
  const first = ws.last('cordis:prepare').token
  reply(ws, healthy, first)
  await assert.rejects(run, { code: 'DEVELOPMENT_SAVE_PENDING' })
  assert.equal(updates, 0); assert.equal(retries, 0)
  assert.deepEqual(ws.last('cordis:resume'), { token: first })
  assert.deepEqual(events.at(-1).clients.map(client => client.application), ['停滞页面'])
  reply(ws, frozen, first)
  assert.equal(retries, 1); assert.equal(events.at(-1).type, 'unblocked')
  reply(ws, frozen, first); ws.emit('cordis:ready', {}, frozen)
  assert.equal(retries, 1)
  const next = guard.run(() => updates++, () => retries++)
  const second = ws.last('cordis:prepare').token
  assert.notEqual(second, first)
  reply(ws, healthy, second); reply(ws, frozen, first)
  await tick(); assert.equal(updates, 0)
  reply(ws, frozen, second); await next
  assert.equal(updates, 1)
})

test('多个超时页面必须全部恢复或关闭才自动重试', async t => {
  const ws = channel(), guard = createDevelopmentSaveGuard(ws, { timeout: 20 })
  t.after(() => guard.close())
  const first = page(ws, '页面一'), second = page(ws, '页面二')
  let retries = 0
  await assert.rejects(guard.run(() => assert.fail('不应更新'), () => retries++), { code: 'DEVELOPMENT_SAVE_PENDING' })
  ws.emit('cordis:ready', {}, first)
  assert.equal(retries, 0)
  assert.deepEqual(ws.last('cordis:blocked').clients.map(client => client.application), ['页面二'])
  ws.clients.delete(second); second.socket.emit('close')
  assert.equal(retries, 1)
})

test('明确保存失败不自动重试；关闭开发服务取消等待并移除监听', async () => {
  const ws = channel(), guard = createDevelopmentSaveGuard(ws)
  const client = page(ws, '页面')
  let retries = 0
  const failed = guard.run(() => assert.fail('不应更新'), () => retries++)
  reply(ws, client, ws.last('cordis:prepare').token, false)
  await assert.rejects(failed, /页面保存失败/)
  ws.emit('cordis:ready', {}, client); assert.equal(retries, 0)
  assert.equal(ws.last('cordis:blocked'), undefined)
  const waiting = guard.run(() => assert.fail('不应更新'), () => retries++)
  guard.close()
  await assert.rejects(waiting, /开发服务已关闭/)
  assert.equal(ws.listenerCount('cordis:ready'), 0)
  assert.equal(ws.listenerCount('cordis:prepared'), 0)
  assert.equal(client.socket.listenerCount('close'), 0)
})

function browser(overrides = {}) {
  const hot = channel(), tasks = [], errors = []
  let queue = Promise.resolve(), readyCount = 0
  const dispose = installDevelopmentSave({ hot, ready: () => readyCount++, report: error => errors.push(error),
    enqueue(action) { const task = queue.then(action); tasks.push(task); queue = task.catch(() => {}); return task },
    protect: action => action(), ...overrides })
  return { hot, tasks, errors, dispose, get readyCount() { return readyCount } }
}

test('尚未执行就超时的页面任务不会再锁定编辑器，并通知服务重新尝试', async () => {
  const b = browser({ protect: () => assert.fail('过期任务不应进入保存保护') })
  b.hot.emit('cordis:prepare', { token: 'old' }); b.hot.emit('cordis:resume', { token: 'old' })
  await b.tasks[0]
  assert.equal(b.readyCount, 1); assert.equal(b.hot.last('cordis:prepared'), undefined)
  b.dispose()
})

test('迟到的 resume 不能释放下一次保存保护，卸载能释放当前等待', async () => {
  let locked = false
  const b = browser({ protect: async action => { locked = true; try { await action() } finally { locked = false } } })
  b.hot.emit('cordis:prepare', { token: 'old' }); await tick()
  assert.equal(locked, true)
  b.hot.emit('cordis:resume', { token: 'old' }); await b.tasks[0]
  b.hot.emit('cordis:prepare', { token: 'new' }); await tick()
  assert.equal(locked, true); assert.equal(b.hot.last('cordis:prepared').token, 'new')
  b.hot.emit('cordis:resume', { token: 'old' }); await tick()
  assert.equal(locked, true)
  b.dispose(); await b.tasks[1]
  assert.equal(locked, false)
  assert.equal(b.hot.listenerCount('cordis:prepare'), 0)
})

test('超时后慢保存完成会释放编辑器并请求重试，保存异常则回传失败', async () => {
  let finishSave, locked = false
  const saved = new Promise(resolve => { finishSave = resolve })
  const b = browser({ protect: async action => { locked = true; try { await saved; await action() } finally { locked = false } } })
  b.hot.emit('cordis:prepare', { token: 'slow' }); await tick()
  b.hot.emit('cordis:resume', { token: 'slow' }); finishSave(); await b.tasks[0]
  assert.equal(locked, false); assert.ok(b.readyCount > 0)
  assert.equal(b.hot.last('cordis:prepared'), undefined)
  b.dispose()
  const failure = browser({ protect: async () => { throw Error('磁盘错误') } })
  failure.hot.emit('cordis:prepare', { token: 'failed' }); await tick()
  assert.deepEqual(failure.hot.last('cordis:prepared'), { token: 'failed', success: false, error: '磁盘错误' })
  assert.deepEqual(failure.errors, ['磁盘错误']); assert.equal(failure.readyCount, 0)
  failure.dispose()
})
