import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Value } from '@sinclair/typebox/value'
import { execWaitMs, stdinWaitMs } from '../workbench/command-wait.js'
import { commandTools, execWaitParameter } from '../workbench/command-tools.js'
import { CommandSessions } from '../workbench/command-sessions.js'

test('首次执行、纯轮询和输入交互分别使用已确认的默认值与边界', () => {
  assert.equal(execWaitMs(undefined, 'win32'), 10000)
  assert.equal(execWaitMs(0, 'win32'), 10000)
  assert.equal(execWaitMs(1000, 'win32'), 10000)
  assert.equal(execWaitMs(20000, 'win32'), 20000)
  assert.equal(execWaitMs(300000, 'win32'), 30000)
  assert.equal(execWaitMs(undefined, 'linux'), 10000)
  assert.equal(execWaitMs(0, 'linux'), 0)
  for (const chars of [undefined, '']) {
    assert.equal(stdinWaitMs({ chars }), 5000)
    assert.equal(stdinWaitMs({ chars, yield_time_ms: 0 }), 5000)
    assert.equal(stdinWaitMs({ chars, yield_time_ms: 300000 }), 300000)
    assert.equal(stdinWaitMs({ chars, yield_time_ms: 300001 }), 300000)
  }
  for (const args of [{ chars: 'y\n' }, { chars: ' ' }, { close_stdin: true }]) {
    assert.equal(stdinWaitMs(args), 250)
    assert.equal(stdinWaitMs({ ...args, yield_time_ms: 0 }), 0)
    assert.equal(stdinWaitMs({ ...args, yield_time_ms: 300000 }), 30000)
  }
  for (const invalid of [-1, 1.5, '5000', null, NaN, Infinity]) {
    assert.throws(() => execWaitMs(invalid), /yield_time_ms/)
    assert.throws(() => stdinWaitMs({ yield_time_ms: invalid }), /yield_time_ms/)
  }
})

test('模型工具 schema 允许省略等待参数并接受 300 秒轮询', () => {
  const exec = commandTools.find(([name]) => name === 'exec_command')[2]
  const stdin = commandTools.find(([name]) => name === 'write_stdin')[2]
  assert.equal(Value.Check(exec, { command: 'pnpm test' }), true)
  assert.equal(Value.Check(stdin, { session_id: 'existing' }), true)
  assert.equal(Value.Check(stdin, { session_id: 'existing', chars: '', yield_time_ms: 300000 }), true)
  assert.equal(Value.Check(stdin, { session_id: 'existing', chars: 'y\n', yield_time_ms: 250 }), true)
  assert.equal(Value.Check(stdin, { session_id: 'existing', yield_time_ms: -1 }), false)
  assert.equal(exec.properties.yield_time_ms, execWaitParameter)
})

const owner = { threadId: 'wait-chat', turnId: 'wait-turn' }
function waitingSession(t) {
  const manager = new CommandSessions({ root: process.cwd() })
  // Drive the real output collector with a quiet process state and a fake clock,
  // so the 300-second boundary and cancellation can be tested without sleeping.
  const s = { id: 'quiet', owner, status: 'running', output: '', total: 0, cursor: 0, stdinPendingBytes: 0, waiters: new Set(), resolveDone() {} }
  manager.sessions.set(s.id, s)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.after(() => manager.close())
  return { manager, s }
}

test('省略参数或传空字符串时实际等 5 秒，窗口结束不会终止进程', async t => {
  const { manager, s } = waitingSession(t)
  for (const extra of [{}, { chars: '' }, { yield_time_ms: 0 }]) {
    let returned = false
    const pending = manager.read(owner, { session_id: s.id, ...extra }).then(value => { returned = true; return value })
    t.mock.timers.tick(4999); await Promise.resolve()
    assert.equal(returned, false)
    t.mock.timers.tick(1)
    assert.equal((await pending).status, 'running')
    assert.equal(s.waiters.size, 0)
  }
})

test('纯轮询支持 300 秒窗口，实际输出和退出会提前唤醒', async t => {
  const { manager, s } = waitingSession(t)
  let returned = false
  const long = manager.read(owner, { session_id: s.id, yield_time_ms: 300000 }).then(value => { returned = true; return value })
  t.mock.timers.tick(299999); await Promise.resolve()
  assert.equal(returned, false)
  t.mock.timers.tick(1); assert.equal((await long).status, 'running')
  const output = manager.read(owner, { session_id: s.id, yield_time_ms: 300000 })
  manager.append(s, 'new output')
  assert.equal((await output).output, 'new output')
  const exit = manager.read(owner, { session_id: s.id, yield_time_ms: 300000 })
  manager.finish(s, 7)
  const ended = await exit
  assert.equal(ended.status, 'exited'); assert.equal(ended.exit_code, 7)
})

test('300 秒轮询可立即取消，后台会话保留且下一轮可继续读取', async t => {
  const { manager, s } = waitingSession(t), controller = new AbortController()
  s.background = true
  const pending = manager.read({ ...owner, signal: controller.signal }, { session_id: s.id, yield_time_ms: 300000 })
  controller.abort()
  await assert.rejects(pending, /任务已停止/)
  assert.equal(s.status, 'running'); assert.equal(s.reading, false); assert.equal(s.waiters.size, 0)
  manager.append(s, 'still alive')
  assert.equal((await manager.read({ ...owner, turnId: 'next' }, { session_id: s.id })).output, 'still alive')
})

test('非空输入使用 250 毫秒窗口，写入阻塞不会改用纯轮询等待', async t => {
  const { manager, s } = waitingSession(t)
  let acknowledge
  s.child = { stdin: { writable: true, destroyed: false, write(chars, callback) { acknowledge = callback } } }
  let returned = false
  const pending = manager.read(owner, { session_id: s.id, chars: 'y\n' }).then(value => { returned = true; return value })
  t.mock.timers.tick(249); await Promise.resolve(); assert.equal(returned, false)
  t.mock.timers.tick(1)
  assert.equal((await pending).stdin_pending_bytes, 2)
  acknowledge(); assert.equal(s.stdinPendingBytes, 0)
})
