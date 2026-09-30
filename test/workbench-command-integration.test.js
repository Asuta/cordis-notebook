import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { createWorkbench } from '../workbench/server.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) { for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value; await delay(50) }; throw Error('工作台状态未就绪') }
async function fixture(t, realWorker = false) {
  const root = await mkdtemp(join(tmpdir(), 'cordis-command-integration-')), dataDir = join(root, '.workbench')
  await mkdir(join(root, 'applications/notebook'), { recursive: true }); await mkdir(join(root, 'scripts')); await mkdir(dataDir)
  await writeFile(join(root, 'applications/notebook/package.json'), JSON.stringify({ cordisApp: { id: 'notebook', name: '测试笔记' } }))
  await writeFile(join(root, 'scripts/build.js'), `console.log('building');const timer=setInterval(()=>{if(require('node:fs').existsSync('finish-build')){clearInterval(timer);console.log('built')}},50)`)
  await writeFile(join(root, 'wait.cjs'), `console.log('ready');setInterval(()=>{},1000)`)
  await writeFile(join(root, 'slow.cjs'), `console.log('first');const timer=setInterval(()=>console.log('progress'),250);setTimeout(()=>{clearInterval(timer);console.log('last')},12000)`)
  const workerFile = join(root, 'worker.cjs')
  await writeFile(workerFile, `process.send({type:'ready'});process.on('message',m=>{if(m.type==='run'&&m.task.prompt!=='hold')process.send({type:'done'});if(m.type==='interrupt')process.send({type:'done',cancelled:true});})`)
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ apiKey: 'fixture-key', thinking: false }))
  let wb
  const open = async () => {
    wb = await createWorkbench({ root, dataDir, port: 0, autoStart: false, ...(realWorker ? {} : { workerFile }) })
    wb.application.status = async () => ({ online: false, logs: [] }); return wb
  }
  await open()
  t.after(async () => { await wb.close(); await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }) })
  const request = async (path, data) => {
    const response = await fetch(`http://127.0.0.1:${wb.server.address().port}/api/${path}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    return { status: response.status, body: await response.json() }
  }
  return { root, dataDir, wb, request, open }
}

test('HTTP 停止保留后台服务；回复结束及刷新不改命令状态；重启标记旧会话中断', async t => {
  const f = await fixture(t), thread = (await f.request('run', { appId: 'notebook', prompt: 'hold' })).body
  const task = { appId: 'notebook', thread, turn: thread.turns[0] }
  const normal = await f.wb.execute(task, 'exec_command', { command: 'node wait.cjs', yield_time_ms: 0 })
  const service = await f.wb.execute(task, 'exec_command', { command: 'node wait.cjs', background: true, yield_time_ms: 0 })
  await f.request('interrupt', {})
  const stopped = await until(async () => { const state = (await f.request('state')).body; return !state.activeThreadId && state.threads[0] })
  assert.equal(stopped.commands.find(c => c.session_id === normal.session_id).status, 'terminated')
  assert.equal(stopped.commands.find(c => c.session_id === service.session_id).status, 'running')
  assert.equal((await f.request('commands/terminate', { threadId: thread.id, session_id: service.session_id })).status, 200)
  const another = (await f.request('run', { appId: 'notebook', prompt: 'done' })).body
  await until(async () => !(await f.request('state')).body.activeThreadId)
  await assert.rejects(f.wb.execute({ ...task, thread: another }, 'write_stdin', { session_id: service.session_id }), /不属于/)
  await f.wb.close()
  const saved = JSON.parse(await readFile(join(f.dataDir, 'conversations.json'), 'utf8'))
  saved[0].commands[1].status = 'running' // Simulate a crash snapshot, with no orphan process.
  await writeFile(join(f.dataDir, 'conversations.json'), JSON.stringify(saved))
  await f.open()
  const restored = (await f.request('state')).body.threads[0]
  assert.equal(restored.commands[1].status, 'interrupted')
  assert.equal((await f.request('commands/terminate', { threadId: thread.id, session_id: service.session_id })).status, 500)
})

test('workspace_build 返回会话且保持构建互斥，结束或取消后释放', async t => {
  const { wb, request, root } = await fixture(t)
  const thread = (await request('run', { appId: 'notebook', prompt: 'hold' })).body, task = { appId: 'notebook', thread, turn: thread.turns[0] }
  const build = await wb.execute(task, 'workspace_build', { yield_time_ms: 0 })
  assert.equal(build.status, 'running'); assert.equal(wb.application.busy, true)
  await assert.rejects(wb.execute(task, 'workspace_build', {}), /正在构建/)
  await assert.rejects(wb.application.restart(), /正在构建/)
  await writeFile(join(root, 'finish-build'), '')
  let result, output = build.output
  do { result = await wb.execute(task, 'write_stdin', { session_id: build.session_id }); output += result.output } while (result.status === 'running' || result.has_more)
  assert.equal(result.exit_code, 0); assert.match(output, /built/); assert.equal(wb.application.busy, false)
  await rm(join(root, 'finish-build'))
  const interrupted = wb.execute(task, 'workspace_build', { yield_time_ms: 0 })
  await until(() => wb.commands.list({ threadId: thread.id }).some(command => command.status === 'running'))
  await request('interrupt', {})
  await interrupted
  assert.equal(wb.application.busy, false)
})

test('真实 Pi 使用新工具定义，通过模型往返启动并继续读取同一个命令', { timeout: 60000 }, async t => {
  const f = await fixture(t, true), requests = []
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const input = JSON.parse(body); requests.push(input)
    const results = input.messages.filter(message => message.role === 'tool')
    let call
    if (!results.length) call = { name: 'exec_command', arguments: JSON.stringify({ command: 'node slow.cjs', yield_time_ms: 10000 }) }
    else {
      const result = JSON.parse(results.at(-1).content)
      if (result.status === 'running' || result.has_more) call = { name: 'write_stdin', arguments: JSON.stringify({ session_id: result.session_id, yield_time_ms: 300000 }) }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const delta = call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-' + requests.length, type: 'function', function: call }] } : { role: 'assistant', content: '命令完成' }
    res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(() => { provider.closeAllConnections(); provider.close() })
  await f.wb.close()
  await writeFile(join(f.dataDir, 'config.json'), JSON.stringify({ apiKey: 'fixture-key', thinking: false, baseUrl: `http://127.0.0.1:${provider.address().port}/v1` }))
  await f.open()
  await f.request('run', { appId: 'notebook', prompt: '执行测试命令并等到结束' })
  await until(async () => (await f.request('state')).body.threads[0]?.commands?.[0]?.output?.includes('progress'))
  assert.equal(requests.length, 1, '界面已收到输出，但初次执行工具仍在收集，不请求模型')
  const done = await until(async () => { const state = (await f.request('state')).body; return !state.activeThreadId && state.threads.length && state.threads[0] })
  assert.equal(done.turns[0].status, 'done'); assert.equal(done.messages.at(-1).text, '命令完成')
  assert.equal(requests.length, 3, '连续日志只需启动、轮询、最终答复三次模型请求')
  const names = requests[0].tools.map(tool => tool.function.name)
  for (const name of ['exec_command', 'write_stdin', 'terminate_command', 'list_commands', 'read', 'edit', 'write']) assert.ok(names.includes(name), name)
  for (const name of ['powershell', 'bash', 'grep', 'find', 'ls']) assert.equal(names.includes(name), false, name)
  assert.match(JSON.stringify(requests[0].messages), /rg --files/)
  assert.equal(done.commands.length, 1); assert.equal(done.commands[0].status, 'exited'); assert.equal(done.commands[0].exit_code, 0)
  assert.match(done.commands[0].output, /first[\s\S]*last/)
})
