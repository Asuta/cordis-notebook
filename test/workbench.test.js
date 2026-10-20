import { openConversationStore } from '../workbench/conversation-store.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { createWorkbench } from '../workbench/server.js'
import sharp from 'sharp'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) { for (let i = 0; i < 150; i++) { const result = await check(); if (result) return result; await delay(50) }; throw Error('等待超时') }
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port }
async function fixture(t, { realApp = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-workbench-')), workerFile = join(dir, 'worker.cjs')
  await writeFile(workerFile, `process.send({type:'ready'}); process.on('message', m => {
    if(m.type === 'run') { process.send({type:'assistant', text:'完成：'+m.task.prompt}); process.send({type:'done'}); }
  })`)
  await writeFile(join(dir, 'config.json'), JSON.stringify({ apiKey: 'fixture-private-key', model: 'deepseek-v4-pro' }))
  const wb = await createWorkbench({ root: resolve('.'), port: 0, appPort: await freePort(), dataDir: dir, appDataDir: join(dir, 'data'), autoStart: false, workerFile })
  t.after(async () => { await wb.close(); await rm(dir, { recursive: true, force: true }) })
  const url = 'http://127.0.0.1:' + wb.server.address().port
  const request = async (path, data, headers) => {
    const response = await fetch(url + '/api/' + path, data === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) })
    return { status: response.status, body: await response.json() }
  }
  if (realApp) await wb.application.start()
  return { wb, dir, url, request }
}

test('工作台隐藏密钥、拒绝跨站请求，保存独立会话并在应用离线时继续任务', async t => {
  const { request, dir } = await fixture(t)
  const config = await request('config'); assert.equal(config.body.hasKey, true); assert.equal(JSON.stringify(config).includes('fixture-private-key'), false)
  assert.equal(config.body.maxConcurrentAgents, 3); assert.equal(config.body.customSystemPrompt, '')
  assert.equal((await request('state', undefined, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await request('run', { appId: 'notebook', prompt: '离线修复' }, { 'Content-Type': 'text/plain' })).status, 415)
  const run = await request('run', { appId: 'notebook', prompt: '离线修复' }); assert.equal(run.status, 200)
  const state = await until(async () => { const s = (await request('state')).body; return !s.activeThreadId && s.threads.length && s })
  assert.equal(state.application.online, false); assert.equal(state.threads[0].messages.at(-1).text, '完成：离线修复')
  assert.equal((await request('run', { appId: 'drawing', threadId: run.body.id, prompt: '越界' })).status, 400)
  await until(async () => (await openConversationStore(dir)).conversations[0]?.running === false)
  const saved = (await openConversationStore(dir)).conversations; assert.equal(saved[0].appId, 'notebook')
  assert.equal(saved[0].turns[0].presentationVersion, 1)
  assert.equal(saved[0].turns[0].finalAnswer.text, '完成：离线修复')
  assert.deepEqual(saved[0].turns[0].finalAnswer.eventIds, [saved[0].turns[0].events[0].id])
})

test('工具绑定页面和服务会话，切换应用后拒绝旧任务，刷新后拒绝旧附件', async t => {
  const { wb, request } = await fixture(t)
  wb.application.status = async () => ({ online: true, state: { current: { id: 'notebook' }, session: 's1' } })
  const task = { appId: 'notebook', clientId: 'browser', pageId: 'p1', session: 's1' }
  await request('bridge', { ...task, type: 'ready', tools: [{ name: 'notebook_read' }] })
  assert.equal((await wb.execute(task, 'app_list_tools', {})).tools[0].name, 'notebook_read')
  await request('bridge', { ...task, type: 'ready', pageId: 'p2', tools: [] })
  await assert.rejects(wb.execute(task, 'app_list_tools', {}), /断开或切换/)
  assert.equal((await request('run', { ...task, prompt: '过期选区', attachments: [{ appId: 'notebook', pageId: 'p1', session: 's1', text: '文字' }] })).status, 409)
  await request('bridge', { ...task, type: 'ready', appId: 'drawing', tools: [] })
  await assert.rejects(wb.execute(task, 'app_list_tools', {}), /断开或切换/)
})

test('页面调用只由绑定客户端回传，插件停用后不能继续调用', async t => {
  const { wb, request, url } = await fixture(t)
  wb.application.status = async () => ({ online: true, state: { current: { id: 'notebook' }, session: 's1' } })
  const task = { appId: 'notebook', clientId: 'browser', pageId: 'p1', session: 's1' }
  await request('bridge', { ...task, type: 'ready', tools: [{ name: 'notebook_read' }] })
  const controller = new AbortController(), response = await fetch(url + '/api/events', { signal: controller.signal }), reader = response.body.getReader()
  t.after(() => controller.abort())
  const result = wb.execute(task, 'app_call', { name: 'notebook_read', arguments: {} })
  let buffer = '', message
  while (!message) { buffer += new TextDecoder().decode((await reader.read()).value); const line = buffer.split('\n').find(line => line.startsWith('data: ')); if (line) message = JSON.parse(line.slice(6)) }
  assert.equal(message.clientId, 'browser'); assert.equal(message.name, 'notebook_read')
  await request('bridge', { ...task, type: 'result', id: message.id, result: { title: '未保存内容' } })
  assert.deepEqual(await result, { title: '未保存内容' })
  await request('bridge', { ...task, type: 'ready', tools: [] })
  await assert.rejects(wb.execute(task, 'app_call', { name: 'notebook_read' }), /工具不存在/)
  controller.abort()
})

test('真实业务进程崩溃后，工作台与聊天仍存活并可恢复应用', async t => {
  const { wb, request } = await fixture(t, { realApp: true })
  const child = wb.application.child, originalPid = child.pid
  child.kill(); await until(() => !wb.application.child)
  assert.equal((await request('state')).body.application.online, false)
  assert.equal((await request('run', { appId: 'notebook', prompt: '崩溃后继续' })).status, 200)
  await until(async () => !(await request('state')).body.activeThreadId)
  await wb.execute({ appId: 'notebook' }, 'workspace_restart', {})
  assert.notEqual(wb.application.child.pid, originalPid)
  const state = (await request('state')).body
  assert.equal(state.application.online, true); assert.equal(state.threads[0].messages.at(-1).text, '完成：崩溃后继续')
})

test('有浏览器事件连接时，受管理重启正常释放 HTTP 服务并以 0 退出', async t => {
  const { wb } = await fixture(t, { realApp: true })
  const child = wb.application.child, controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${wb.application.port}/api/events`, { signal: controller.signal })
  assert.equal(response.status, 200)
  t.after(() => controller.abort())
  await wb.application.restart()
  assert.equal(child.exitCode, 0)
  assert.equal(wb.application.logs.some(entry => entry.text.includes('TypeError')), false)
  controller.abort()
})

test('仅支持 Flash，旧配置归一、压缩校验、图片上传与历史引用保护', async t => {
  const { request, url, dir } = await fixture(t)
  const config = (await request('config')).body
  assert.equal(config.compaction.threshold, 128000)
  assert.equal(config.model, 'deepseek-flash')
  assert.deepEqual(config.models.map(model => [model.id, model.images]), [['deepseek-flash', true]])
  assert.equal((await request('config', { model: 'deepseek-v4-pro' })).status, 400)
  assert.equal((await request('config', { reasoningEffort: 'medium' })).status, 400)
  assert.equal((await request('config', { compaction: { threshold: 20000 } })).status, 400)
  assert.equal((await request('config', { model: 'deepseek-flash', reasoningEffort: 'max', customSystemPrompt: '通用行为指令 sentinel', maxConcurrentAgents: 2, compaction: { threshold: 96000, keepRecentTokens: 10000 } })).status, 200)
  const saved = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
  assert.equal(saved.apiKey, 'fixture-private-key'); assert.equal(saved.compaction.threshold, 96000)
  assert.equal(saved.customSystemPrompt, '通用行为指令 sentinel'); assert.equal(saved.maxConcurrentAgents, 2)
  assert.equal((await request('config', { maxConcurrentAgents: 9 })).status, 400)
  assert.equal((await request('config', { customSystemPrompt: 'x'.repeat(50001) })).status, 400)
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } }).png().toBuffer()
  const upload = data => fetch(url + '/api/images', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: data })
  assert.equal((await upload(Buffer.from('<svg><script>bad</script></svg>'))).status, 400)
  const images = await Promise.all([upload(png), upload(png)]).then(responses => Promise.all(responses.map(r => r.json())))
  assert.equal(images[0].mimeType, 'image/png')
  const preview = await fetch(url + '/api/images/' + images[0].id)
  assert.equal(preview.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png)
  const input = { appId: 'notebook', prompt: '比较图片', images: images.map(image => image.id) }
  assert.equal((await request('run', { ...input, model: 'deepseek-v4-pro' })).status, 400)
  assert.equal((await request('run', { ...input, images: ['../config.json'] })).status, 400)
  const run = await request('run', input); assert.equal(run.status, 200)
  const state = await until(async () => { const value = (await request('state')).body; return !value.activeThreadId && value })
  const thread = state.threads[0]
  assert.equal(thread.turns[0].model, 'deepseek-flash')
  assert.equal(thread.messages[0].images.length, 2); assert.equal(thread.turns[0].effort, 'max')
  assert.equal(thread.turns[0].events[0].kind, 'text'); assert.equal(thread.turns[0].status, 'done')
  assert.equal((await request('images/remove', { id: images[0].id })).status, 409)
  assert.equal((await request('run', { appId: 'notebook', threadId: run.body.id, prompt: '继续', model: 'deepseek-v4-pro' })).status, 400)
})

test('执行过程持久化、相同工具调用分别记录、日志密钥脱敏', async t => {
  const { request, dir } = await fixture(t)
  await writeFile(join(dir, 'worker.cjs'), `process.send({type:'ready'}); process.on('message', m => {
    if(m.type !== 'run') return;
    for (const id of ['call-a','call-b']) {
      process.send({type:'trace',event:{id,kind:'tool',name:'read',input:'file.txt',status:'running'}});
      process.send({type:'trace',event:{id,output:'fixture-private-key',status:id==='call-b'?'error':'done'}});
    }
    process.send({type:'trace',event:{id:'thinking',kind:'thinking',delta:'分析文件',status:'running'}});
    process.send({type:'trace',event:{id:'model',kind:'model',status:'done',startedAt:100,endedAt:300,timing:{invokedAt:100,requestStartedAt:110,firstOutputAt:200,endedAt:300,waitMs:90,streamingMs:100,totalMs:200,private:'fixture-private-key'}}});
    process.send({type:'usage',usage:{tokens:5000,contextWindow:1048576}});
    process.send({type:'done'});
  })`)
  await request('run', { appId: 'notebook', prompt: '显示过程' })
  const state = await until(async () => { const value = (await request('state')).body; return !value.activeThreadId && value.threads.length && value })
  const thread = state.threads[0]
  assert.equal(thread.turns[0].events.length, 4)
  assert.deepEqual(thread.turns[0].events[3].timing, { invokedAt: 100, requestStartedAt: 110, firstOutputAt: 200, endedAt: 300, waitMs: 90, streamingMs: 100, totalMs: 200 })
  assert.equal(thread.turns[0].events[3].startedAt, 100); assert.equal(thread.turns[0].events[3].endedAt, 300)
  assert.equal(thread.turns[0].events[1].status, 'error')
  assert.equal(thread.turns[0].events[0].output, '[密钥已隐藏]')
  assert.equal(thread.contextUsage.tokens, 5000)
  await until(async () => (await openConversationStore(dir)).conversations[0]?.running === false)
  const saved = (await openConversationStore(dir)).conversations[0]
  assert.deepEqual(saved.turns, thread.turns)
})

test('worker 就绪前停止任务会释放槽位，排队任务能继续且已取消任务不会执行', async t => {
  const { request, dir } = await fixture(t)
  const worker = [
    "const fs = require('node:fs'), path = require('node:path');",
    "const file = name => path.join(__dirname, name);",
    "const ready = setInterval(() => { if (fs.existsSync(file('allow-ready'))) { clearInterval(ready); process.send({type:'ready'}); } }, 10);",
    "process.on('message', m => {",
    "  if (m.type !== 'run') return;",
    "  fs.appendFileSync(file('dispatched.jsonl'), JSON.stringify(m.task.prompt)+'\\n');",
    "  process.send({type:'assistant', text:'完成：'+m.task.prompt}); process.send({type:'done'});",
    "});",
    "fs.writeFileSync(file('booted'), 'yes');",
  ].join('\n')
  await writeFile(join(dir, 'worker.cjs'), worker)
  await request('config', { maxConcurrentAgents: 1 })
  const first = await request('run', { appId: 'notebook', prompt: '启动期间取消' })
  assert.equal(first.status, 200)
  await until(() => readFile(join(dir, 'booted'), 'utf8').catch(() => null))
  const second = await request('run', { appId: 'notebook', prompt: '原先排队的任务' })
  assert.equal(second.status, 200); assert.equal(second.body.queued, true)
  assert.equal((await request('interrupt', { threadId: first.body.id })).status, 200)
  const state = (await request('state')).body
  const stopped = state.threads.find(thread => thread.id === first.body.id)
  assert.equal(stopped.running, false); assert.equal(stopped.queued, false)
  assert.equal(stopped.turns[0].status, 'stopped')
  assert.equal(state.runningCount, 1); assert.deepEqual(state.activeThreadIds, [second.body.id])
  assert.deepEqual(state.queuedThreadIds, [])
  await writeFile(join(dir, 'allow-ready'), 'yes')
  const done = await until(async () => {
    const thread = (await request('state')).body.threads.find(thread => thread.id === second.body.id)
    return !thread.running && thread
  })
  assert.equal(done.turns[0].status, 'done')
  assert.equal(done.messages.at(-1).text, '完成：原先排队的任务')
  assert.equal((await request('state')).body.runningCount, 0)
  assert.equal(await readFile(join(dir, 'dispatched.jsonl'), 'utf8'), JSON.stringify('原先排队的任务') + '\n')
})

test('等待应用状态时停止启动任务可以立即重试，迟到状态不会重新执行旧任务', { timeout: 15000 }, async t => {
  const { wb, request } = await fixture(t)
  let enterStatus, releaseStatus
  const entered = new Promise(resolve => { enterStatus = resolve })
  const gate = new Promise(resolve => { releaseStatus = resolve })
  t.after(() => releaseStatus())
  let firstStatus = true
  wb.application.status = async () => {
    if (firstStatus) { firstStatus = false; enterStatus(); await gate }
    return { online: false, logs: [] }
  }
  const first = await request('run', { appId: 'notebook', prompt: '等待应用状态时取消' })
  assert.equal(first.status, 200)
  await entered
  assert.equal((await request('interrupt', { threadId: first.body.id })).status, 200)
  const stopped = (await request('state')).body
  assert.equal(stopped.runningCount, 0)
  assert.equal(stopped.threads[0].running, false)
  assert.equal(stopped.threads[0].turns[0].status, 'stopped')
  const retry = await request('run', { appId: 'notebook', threadId: first.body.id, prompt: '同一对话重试' })
  assert.equal(retry.status, 200)
  releaseStatus()
  const done = await until(async () => {
    const state = (await request('state')).body
    return !state.activeThreadId && state.threads[0]
  })
  assert.deepEqual(done.turns.map(turn => turn.status), ['stopped', 'done'])
  assert.deepEqual(done.messages.filter(message => message.role === 'assistant').map(message => message.text), ['完成：同一对话重试'])
})

test('多个独立对话并行运行、只停止指定任务并取消排队对话', async t => {
  const { request, dir } = await fixture(t)
  const worker = [
    "process.send({type:'ready'}); let timer;",
    "process.on('message', m => {",
    "  if (m.type === 'interrupt' && timer) { clearTimeout(timer); timer = null; process.send({type:'done', cancelled:true}); return; }",
    "  if (m.type !== 'run') return;",
    "  if (m.task.prompt.startsWith('hold:')) {",
    "    process.send({type:'assistant', text:'执行中：'+m.task.prompt+'：PID '+process.pid});",
    "    timer = setTimeout(() => { timer = null; process.send({type:'assistant', text:'完成：'+m.task.prompt+'：PID '+process.pid}); process.send({type:'done'}); }, 10000); return;",
    "  }",
    "  process.send({type:'assistant', text:'完成：'+m.task.prompt}); process.send({type:'done'});",
    "});",
  ].join('\n')
  await writeFile(join(dir, 'worker.cjs'), worker)
  await request('config', { customSystemPrompt: '', maxConcurrentAgents: 2, compaction: { enabled: true, threshold: 128000, keepRecentTokens: 20000 } })
  const first = await request('run', { appId: 'notebook', prompt: 'hold:first' })
  const second = await request('run', { appId: 'notebook', prompt: 'hold:second' })
  assert.equal(first.status, 200); assert.equal(second.status, 200)
  const parallel = await until(async () => {
    const state = (await request('state')).body, active = state.threads.filter(thread => thread.running && !thread.queued)
    return active.length === 2 && active.every(thread => thread.messages.some(message => message.role === 'assistant')) ? { state, active } : null
  })
  assert.equal(parallel.state.runningCount, 2)
  const pids = parallel.active.map(thread => thread.messages.find(message => message.role === 'assistant').text.match(/PID (\d+)/)?.[1])
  assert.ok(pids.every(Boolean)); assert.equal(new Set(pids).size, 2)
  assert.equal((await request('interrupt', { threadId: first.body.id })).status, 200)
  await until(async () => {
    const state = (await request('state')).body
    return state.runningCount === 1 && state.threads.find(thread => thread.id === second.body.id)?.running
  })
  assert.equal((await request('interrupt', { threadId: second.body.id })).status, 200)
  await until(async () => !(await request('state')).body.activeThreadId)

  await request('config', { customSystemPrompt: '', maxConcurrentAgents: 1, compaction: { enabled: true, threshold: 128000, keepRecentTokens: 20000 } })
  const running = await request('run', { appId: 'notebook', prompt: 'hold:capacity' })
  const queued = await request('run', { appId: 'notebook', prompt: 'hold:queued' })
  assert.equal(queued.status, 200); assert.equal(queued.body.queued, true)
  const queuedState = await until(async () => { const state = (await request('state')).body; return state.queuedThreadIds.includes(queued.body.id) ? state : null })
  assert.equal(queuedState.runningCount, 1)
  assert.equal((await request('interrupt', { threadId: queued.body.id })).status, 200)
  await until(async () => {
    const state = (await request('state')).body
    return !state.threads.find(thread => thread.id === queued.body.id)?.running && state.threads.find(thread => thread.id === running.body.id)?.running
  })
  await request('interrupt', { threadId: running.body.id })
  await until(async () => !(await request('state')).body.activeThreadId)
})
