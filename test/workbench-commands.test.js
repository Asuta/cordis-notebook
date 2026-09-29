import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CommandSessions } from '../workbench/command-sessions.js'
import { resolve, join, delimiter } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const owner = { threadId: 'chat-a', turnId: 'turn-a' }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) { for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await pause(50) }; throw Error('等待命令状态超时') }
function fixture(t) {
  const updates = [], manager = new CommandSessions({ root: resolve('.'), onChange: event => updates.push(event) })
  t.after(() => manager.close()); return { manager, updates }
}
const startNode = (manager, code, extra = {}, scope = owner) => manager.start(scope, { command: 'node fixture', yield_time_ms: 0, ...extra }, { file: process.execPath, args: ['-e', code] })
async function drain(manager, id, scope = owner) {
  let output = '', dropped = 0, result
  do { result = await manager.read(scope, { session_id: id, yield_time_ms: 100 }); output += result.output; dropped += result.dropped_chars } while (result.status === 'running' || result.has_more)
  return { ...result, output, dropped }
}

test('等待窗口只让出控制权；同一会话输入、增量读取、退出码均正确', async t => {
  const { manager } = fixture(t)
  const first = await startNode(manager, `console.log('就绪'); process.stdin.once('data', data => { console.log('收到:'+data.toString().trim()); process.exit(7) })`)
  assert.equal(first.status, 'running')
  let initial = first.output
  await until(async () => { initial += (await manager.read(owner, { session_id: first.session_id, yield_time_ms: 100 })).output; return initial.includes('就绪') })
  await pause(100)
  assert.equal(manager.list(owner)[0].status, 'running')
  assert.equal((await manager.read(owner, { session_id: first.session_id, yield_time_ms: 0 })).output, '')
  const input = await manager.read(owner, { session_id: first.session_id, chars: '你好\n', yield_time_ms: 100 })
  const end = await drain(manager, first.session_id)
  assert.equal(end.exit_code, 7); assert.match(input.output + end.output, /收到:你好/)
  assert.equal((await manager.read(owner, { session_id: first.session_id, yield_time_ms: 0 })).output, '')
})

test('聊天停止仅结束本轮普通命令及其子进程，后台服务和其他轮次保留', async t => {
  const { manager } = fixture(t)
  const normal = await startNode(manager, `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); console.log(child.pid); setInterval(()=>{},1000)`)
  let pidText = normal.output
  await until(async () => { pidText += (await manager.read(owner, { session_id: normal.session_id, yield_time_ms: 100 })).output; return pidText.trim() })
  const childPid = Number(pidText.trim()); assert.ok(childPid > 0)
  const service = await startNode(manager, 'setInterval(()=>{},1000)', { background: true })
  const prior = await startNode(manager, 'setInterval(()=>{},1000)', {}, { ...owner, turnId: 'previous' })
  await manager.stopTurn(owner)
  assert.equal(manager.get(owner, normal.session_id).status, 'terminated')
  await until(() => { try { process.kill(childPid, 0); return false } catch (error) { return error.code === 'ESRCH' } })
  assert.equal(manager.get(owner, service.session_id).status, 'running')
  assert.equal(manager.get(owner, prior.session_id).status, 'running')
  assert.equal((await manager.terminate(owner, service.session_id)).status, 'terminated')
})

test('命令按聊天隔离；大输出有界并显式报告丢弃量；启动失败可查询', async t => {
  const { manager } = fixture(t)
  const large = await startNode(manager, "process.stdout.write('x'.repeat(400000))")
  await manager.get(owner, large.session_id).done
  await assert.rejects(manager.read({ threadId: 'other' }, { session_id: large.session_id }), /不属于/)
  await assert.rejects(manager.terminate({ threadId: 'other' }, large.session_id), /不属于/)
  assert.deepEqual(manager.list({ threadId: 'other' }), [])
  const end = await drain(manager, large.session_id)
  assert.equal(end.output.length, 256 * 1024); assert.equal(end.dropped, 400000 - 256 * 1024)
  assert.ok(manager.snapshot(manager.get(owner, large.session_id)).output.length <= 12000)
  const failed = await manager.start(owner, { command: 'missing executable', yield_time_ms: 1000 }, { file: 'cordis-command-that-does-not-exist', args: [] })
  assert.equal(failed.status, 'exited'); assert.match(failed.error, /ENOENT/)
})

test('真实 PowerShell/Bash 会话可使用随项目安装的 rg，关闭工作台清理后台服务', async t => {
  const { manager } = fixture(t)
  const result = await manager.start(owner, { command: 'rg --version', yield_time_ms: 1000 })
  const end = await drain(manager, result.session_id)
  assert.equal(end.exit_code, 0); assert.match(result.output + end.output, /ripgrep/)
  const miss = await manager.start(owner, { command: 'rg -q "NONEXISTENT-CORDIS-FIXTURE-42" workbench/command-tools.js', yield_time_ms: 0 })
  assert.equal((await drain(manager, miss.session_id)).exit_code, 1)
  if (process.platform === 'win32') {
    const error = await manager.start(owner, { command: 'rg --version; Write-Error "fixture failure"', yield_time_ms: 0 })
    assert.equal((await drain(manager, error.session_id)).exit_code, 1)
  }
  const service = await startNode(manager, 'setInterval(()=>{},1000)', { background: true })
  await manager.close()
  assert.equal(manager.get(owner, service.session_id).status, 'terminated')
  await assert.rejects(startNode(manager, ''), /已停止/)
})

test('PTY 支持交互输入并返回真实退出状态', async t => {
  const { manager } = fixture(t)
  const result = await startNode(manager, `process.stdout.write('READY'); require('node:readline').createInterface({input:process.stdin}).once('line', line => { console.log('ECHO:'+line); process.exit(0) })`, { tty: true })
  let output = result.output
  await until(async () => { output += (await manager.read(owner, { session_id: result.session_id, yield_time_ms: 100 })).output; return output.includes('READY') })
  const sent = await manager.read(owner, { session_id: result.session_id, chars: 'hello\r', yield_time_ms: 100 })
  const end = await drain(manager, result.session_id)
  assert.equal(end.exit_code, 0); assert.match(sent.output + end.output, /ECHO:hello/)
})

test('启动前已取消的轮次不会生成命令，参数无效不会留下运行会话', async t => {
  const { manager } = fixture(t)
  await assert.rejects(startNode(manager, '', {}, { ...owner, cancelled: () => true }), /已停止/)
  await assert.rejects(startNode(manager, '', { yield_time_ms: -1 }), /yield_time_ms/)
  assert.equal(manager.list(owner).length, 0)
})

test('停止 PTY 服务清理终端内进程', async t => {
  const { manager } = fixture(t)
  const result = await startNode(manager, `console.log('PID:'+process.pid);setInterval(()=>{},1000)`, { tty: true, background: true })
  let text = result.output
  await until(async () => { text += (await manager.read(owner, { session_id: result.session_id, yield_time_ms: 100 })).output; return /PID:\d+/.test(text) })
  const pid = Number(text.match(/PID:(\d+)/)[1])
  await manager.terminate(owner, result.session_id)
  await until(() => { try { process.kill(pid, 0); return false } catch (error) { return error.code === 'ESRCH' } })
})

test('取消读取后台服务只结束等待，下一轮可立即继续读取且服务仍运行', async t => {
  const { manager } = fixture(t), controller = new AbortController()
  const started = await startNode(manager, 'setInterval(()=>{},1000)', { background: true })
  const reading = manager.read({ ...owner, signal: controller.signal }, { session_id: started.session_id, yield_time_ms: 30000 })
  controller.abort()
  await assert.rejects(reading, /已停止/)
  const next = await manager.read({ ...owner, turnId: 'next' }, { session_id: started.session_id, yield_time_ms: 0 })
  assert.equal(next.status, 'running')
})

test('Windows 受限策略下仍可执行 PowerShell 包管理器入口，支持管道及 PTY', { skip: process.platform !== 'win32' }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-command-policy-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const { manager } = fixture(t)
  await writeFile(join(dir, 'pnpm.ps1'), "Write-Output 'fixture-pnpm-version'", 'utf8')
  const pathKey = Object.keys(manager.env).find(key => key.toLowerCase() === 'path')
  manager.env[pathKey] = dir + delimiter + manager.env[pathKey]
  manager.env.PSExecutionPolicyPreference = 'Restricted'
  for (const tty of [false, true]) {
    const result = await manager.start(owner, { command: 'pnpm --version', tty, yield_time_ms: 0 })
    const end = await drain(manager, result.session_id)
    assert.equal(end.exit_code, 0); assert.match(result.output + end.output, /fixture-pnpm-version/)
  }
})

const longCommand = code => code + '\n#' + 'x'.repeat(20000)
test('Windows 长命令保留 Unicode、引号、工作目录和退出码，执行后清理脚本', { skip: process.platform !== 'win32' }, async t => {
  const { manager } = fixture(t)
  for (const tty of [false, true]) {
    const command = longCommand(`Write-Output '中文 "quoted"'; Write-Output (Get-Location).Path; exit 7`)
    const result = await manager.start(owner, { command, tty, yield_time_ms: 0 })
    const s = manager.get(owner, result.session_id)
    assert.ok(s.scriptFile); await access(s.scriptFile)
    const end = await drain(manager, result.session_id)
    assert.equal(end.exit_code, 7); assert.match(result.output + end.output, /中文 "quoted"/)
    assert.ok((result.output + end.output).includes(resolve('.')))
    await assert.rejects(access(s.scriptFile), { code: 'ENOENT' })
  }
})

test('Windows 长命令脚本在停止、关闭工作台及启动失败后清理', { skip: process.platform !== 'win32' }, async t => {
  const { manager } = fixture(t)
  const command = longCommand("Write-Output 'ready'; Start-Sleep -Seconds 120")
  const normal = await manager.start(owner, { command, yield_time_ms: 0 })
  const normalScript = manager.get(owner, normal.session_id).scriptFile
  await manager.terminate(owner, normal.session_id)
  await assert.rejects(access(normalScript), { code: 'ENOENT' })
  const service = await manager.start(owner, { command, background: true, yield_time_ms: 0 })
  const serviceScript = manager.get(owner, service.session_id).scriptFile
  manager.shell = 'cordis-missing-powershell-executable'
  const failed = await manager.start(owner, { command, yield_time_ms: 0 })
  const failedState = manager.get(owner, failed.session_id)
  await failedState.done
  assert.match(failedState.error, /ENOENT/)
  await assert.rejects(access(failedState.scriptFile), { code: 'ENOENT' })
  await manager.close()
  await assert.rejects(access(serviceScript), { code: 'ENOENT' })
})

test('stdin 背压不阻塞零等待读取，队列有界、保持顺序且 EOF 不丢失输入', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-command-input-')), gate = join(dir, 'read-now')
  const { manager } = fixture(t)
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const first = await startNode(manager, `
    const fs=require('node:fs'), crypto=require('node:crypto');
    console.log('READY');
    const timer=setInterval(()=>{
      if(!fs.existsSync(${JSON.stringify(gate)}))return;
      clearInterval(timer);
      let size=0;const hash=crypto.createHash('sha256');
      process.stdin.on('data',data=>{size+=data.length;hash.update(data)});
      process.stdin.on('end',()=>console.log('RESULT:'+size+':'+hash.digest('hex')));
    },10);
  `)
  let output = first.output
  await until(async () => { output += (await manager.read(owner, { session_id: first.session_id, yield_time_ms: 100 })).output; return output.includes('READY') })
  const controller = new AbortController(), scope = { ...owner, signal: controller.signal }
  // Abort the old blocking implementation rather than leaving the test hung.
  const deadline = setTimeout(() => controller.abort(), 2000)
  let accepted = '', rejected = false, pending
  try {
    for (let i = 0; i < 100; i++) {
      const chars = String(i).padStart(4, '0').repeat(4000)
      try { pending = await manager.read(scope, { session_id: first.session_id, chars, yield_time_ms: 0 }); accepted += chars }
      catch (error) { assert.match(error.message, /本次输入未接受/); rejected = true; break }
    }
    assert.equal(rejected, true); assert.ok(pending.stdin_pending_bytes > 0 && pending.stdin_pending_bytes <= 256 * 1024)
    const eof = await manager.read(scope, { session_id: first.session_id, close_stdin: true, yield_time_ms: 0 })
    assert.equal(eof.status, 'running'); assert.ok(eof.stdin_pending_bytes > 0)
    await assert.rejects(manager.read(scope, { session_id: first.session_id, chars: 'must not arrive', yield_time_ms: 0 }), /输入已关闭/)
  } finally { clearTimeout(deadline) }
  await writeFile(gate, '')
  const end = await drain(manager, first.session_id)
  const expected = 'RESULT:' + Buffer.byteLength(accepted) + ':' + createHash('sha256').update(accepted).digest('hex')
  assert.equal(end.exit_code, 0); assert.ok(end.output.includes(expected)); assert.equal(end.stdin_pending_bytes, 0)
  assert.equal(end.stdin_error, undefined)
})

test('子进程退出时报告未完成输入的写入错误；未消费的输入不会阻止停止命令', async t => {
  const { manager } = fixture(t)
  const dir = await mkdtemp(join(tmpdir(), 'cordis-command-exit-')), gate = join(dir, 'exit-now')
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  const closed = await startNode(manager, `console.log('READY'); setInterval(()=>{if(require('node:fs').existsSync(${JSON.stringify(gate)}))process.exit(0)},10)`)
  let output = closed.output
  await until(async () => { output += (await manager.read(owner, { session_id: closed.session_id, yield_time_ms: 100 })).output; return output.includes('READY') })
  for (let i = 0; i < 16; i++) await manager.read(owner, { session_id: closed.session_id, chars: 'x'.repeat(16000), yield_time_ms: 0 })
  await writeFile(gate, '')
  const error = await drain(manager, closed.session_id)
  assert.equal(error.status, 'exited'); assert.ok(error.stdin_error); assert.equal(error.stdin_pending_bytes, 0)
  const blocked = await startNode(manager, 'setInterval(()=>{},1000)')
  for (let i = 0; i < 10; i++) await manager.read(owner, { session_id: blocked.session_id, chars: 'x'.repeat(16000), yield_time_ms: 0 })
  assert.equal((await manager.terminate(owner, blocked.session_id)).status, 'terminated')
})
