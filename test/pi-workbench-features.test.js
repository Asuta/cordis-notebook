import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { AttachmentStore } from '../workbench/attachments.js'

const messageText = message => typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('')

test('真实 Pi 请求：多图、Low/High/Max、思考事件、手动与自动压缩', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-pi-features-')), requests = [], events = []
  await mkdir(join(root, 'agent'), { recursive: true }); await mkdir(join(root, 'applications/notebook'), { recursive: true })
  await writeFile(join(root, 'agent/ARCHITECTURE.md'), '只运行测试')
  await mkdir(join(root, 'applications/notebook/plugins'))
  await writeFile(join(root, 'applications/notebook/package.json'), JSON.stringify({ cordisApp: { id: 'notebook', name: '测试笔记' } }))
  let answer = '## 完成\n\n' + '保留测试内容。'.repeat(2000), promptTokens = 10000, toolOnly = false, providerError = false
  let toolName = 'workspace_development_info', toolArguments = { focus: 'ui' }
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body); requests.push(parsed)
    if (providerError) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'fixture summary request rejected', type: 'invalid_request_error' } })); return }
    const usage = { prompt_tokens: promptTokens, completion_tokens: 100, total_tokens: promptTokens + 100 }
    if (parsed.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: answer, reasoning_content: '思考示例' }, finish_reason: 'stop' }], usage })); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const tools = toolOnly && !parsed.messages.some(message => message.role === 'tool')
    const deltas = tools ? [{ tool_calls: [{ index: 0, id: 'model-tool', type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArguments) } }] }]
      : [{ role: 'assistant', reasoning_content: '思考示例' }, { content: answer }]
    for (const delta of deltas) res.write('data: ' + JSON.stringify({ id: 'mock', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: tools ? 'tool_calls' : 'stop' }], usage }) + '\n\n'); res.end('data: [DONE]\n\n')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const worker = fork(resolve('workbench/agent-worker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = '', resolveRun
  worker.stderr.on('data', chunk => stderr += chunk)
  worker.on('message', message => { if (message.type === 'tool') worker.send({ type: 'result', id: message.id, result: { appId: 'notebook', contracts: [] } }) })
  const ready = new Promise(resolve => worker.on('message', message => { events.push(message); if (message.type === 'ready') resolve(); if (message.type === 'done') resolveRun?.() }))
  t.after(async () => { if (worker.exitCode === null) { const exit = once(worker, 'exit'); worker.kill(); await exit }; server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }) })
  await ready
  const dataDir = join(root, '.workbench'), store = new AttachmentStore(dataDir)
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()
  const images = await Promise.all([store.upload(Readable.from([png])), store.upload(Readable.from([png]))])
  let sessionFile
  const run = async (effort, options = {}) => {
    const start = events.length, requestStart = requests.length
    await new Promise(resolve => {
      resolveRun = resolve
      worker.send({ type: 'run', root, dataDir, agentDir: join(dataDir, 'pi'),
        config: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: options.model || 'deepseek-flash', thinking: effort !== 'off', reasoningEffort: effort === 'off' ? 'high' : effort, skills: options.skills, compaction: options.compaction || { enabled: false, threshold: 128000, keepRecentTokens: 1000 } },
        task: { appId: options.appId || 'notebook', browserVerificationEnabled: true, prompt: options.prompt ?? '继续分析' + '测试文字'.repeat(1500), sessionFile, images: options.images || [], mode: options.mode || 'chat' } })
    })
    assert.ok(requests.slice(requestStart).every(request => request.model === 'deepseek-flash'))
    const result = events.slice(start)
    if (options.expectError) assert.ok(result.some(e => e.type === 'error'), stderr)
    else assert.deepEqual(result.filter(e => e.type === 'error'), [], stderr)
    const timings = result.filter(e => e.type === 'trace' && e.event.kind === 'model' && e.event.status === 'done').map(e => e.event.timing)
    if (!options.expectError) assert.equal(timings.length, requests.length - requestStart, '正常回复及只读 result 的压缩请求均记录完成时间')
    for (const timing of timings) {
      assert.ok(timing.requestStartedAt >= timing.invokedAt)
      assert.ok(timing.firstOutputAt >= timing.requestStartedAt)
      assert.ok(timing.endedAt >= timing.firstOutputAt)
      assert.ok(timing.totalMs >= timing.waitMs)
    }
    sessionFile = result.find(e => e.type === 'session')?.file || sessionFile
    return { events: result, requests: requests.slice(requestStart) }
  }
  await t.test('技能目录、应用范围、手动加载和下一轮文件更新进入真实 Pi 请求', async () => {
    const directory = join(root, 'custom-skills')
    const files = {}
    for (const name of ['shared', 'limited', 'disabled', 'manual']) {
      await mkdir(join(directory, name), { recursive: true })
      files[name] = join(directory, name, 'SKILL.md')
      await writeFile(files[name], ['---', 'name: ' + name, 'description: CATALOG_' + name, name === 'manual' ? 'disable-model-invocation: true' : '', '---', 'BODY_ONLY_' + name].join(String.fromCharCode(10)))
    }
    const skills = { directory, rules: [{ path: files.limited, enabled: true, apps: ['notebook'] }, { path: files.disabled, enabled: false, apps: null }] }
    const first = await run('off', { skills, prompt: '检查目录' })
    const system = first.requests[0].messages.filter(m => m.role === 'system').map(messageText).join(' ')
    assert.match(system, /CATALOG_shared/); assert.match(system, /CATALOG_limited/)
    assert.doesNotMatch(system, /CATALOG_disabled|CATALOG_manual|BODY_ONLY_/)
    sessionFile = undefined
    const other = await run('off', { skills, appId: 'drawing', prompt: '检查范围' })
    assert.doesNotMatch(other.requests[0].messages.filter(m => m.role === 'system').map(messageText).join(' '), /CATALOG_limited/)
    sessionFile = undefined
    const explicit = await run('off', { skills, prompt: '/skill:manual 执行测试' })
    assert.match(messageText(explicit.requests[0].messages.findLast(m => m.role === 'user')), /BODY_ONLY_manual/)
    await writeFile(files.manual, (await readFile(files.manual, 'utf8')).replace('BODY_ONLY_manual', 'UPDATED_BODY_manual'))
    const updated = await run('off', { skills, prompt: '/skill:manual 再次执行' })
    assert.match(messageText(updated.requests[0].messages.findLast(m => m.role === 'user')), /UPDATED_BODY_manual/)
    const unavailable = await run('off', { skills, prompt: '/skill:disabled 执行', expectError: true })
    assert.equal(unavailable.requests.length, 0)
    assert.match(unavailable.events.find(e => e.type === 'error').error, /没有可用的技能/)
    sessionFile = undefined
  })
  const low = await run('low', { images, model: 'deepseek-v4-pro' })
  assert.equal(low.requests[0].reasoning_effort, 'low')
  assert.equal(low.requests[0].thinking.type, 'enabled')
  const user = low.requests[0].messages.findLast(m => m.role === 'user')
  assert.equal(user.content.filter(c => c.type === 'image_url').length, 2)
  assert.equal(low.events.some(e => e.type === 'trace' && e.event.kind === 'thinking' && e.event.delta === '思考示例'), true)
  assert.equal(low.events.some(e => e.type === 'trace' && e.event.kind === 'text'), true)
  for (const name of ['workspace_development_info', 'workspace_scaffold_plugin', 'workspace_enable_plugin', 'browser_report', 'browser_batch', 'browser_retest']) assert.ok(low.requests[0].tools.some(tool => tool.function.name === name))
  toolOnly = true; sessionFile = undefined
  const tool = await run('low'); assert.equal(tool.requests.length, 2)
  assert.ok(tool.events.some(e => e.type === 'tool' && e.name === 'workspace_development_info'))
  toolOnly = false
  await t.test('Pi read 返回图片在 done 前落盘并发送图片元数据', async () => {
    const imageFile = join(root, 'generated.png')
    await writeFile(imageFile, png)
    toolOnly = true; toolName = 'read'; toolArguments = { path: imageFile }; sessionFile = undefined
    const result = await run('off', { prompt: '显示图片' })
    const imageEvent = result.events.find(event => event.type === 'trace' && event.event.images?.length)
    assert.ok(imageEvent, '真实 Pi 图片结果应带可持久化附件元数据')
    assert.deepEqual(await store.bytes(imageEvent.event.images[0].id), png)
    assert.ok(result.events.indexOf(imageEvent) < result.events.findIndex(event => event.type === 'done'))
    toolOnly = false; toolName = 'workspace_development_info'; toolArguments = { focus: 'ui' }
  })
  const high = await run('high'); assert.equal(high.requests[0].reasoning_effort, 'high')
  const max = await run('max'); assert.equal(max.requests[0].reasoning_effort, 'max')
  answer = '压缩摘要：继续验证图片与配置。'; promptTokens = 500
  const compact = await run('low', { mode: 'compact' })
  const compactionEvents = compact.events.filter(e => e.type === 'trace' && e.event.kind === 'compaction')
  assert.equal(compactionEvents[0].event.status, 'running'); assert.equal(compactionEvents.at(-1).event.status, 'done')
  assert.match(compactionEvents.at(-1).event.text, /压缩摘要/)
  assert.ok(compact.requests.every(request => (request.max_tokens || request.max_completion_tokens) <= 16384))
  await t.test('压缩后立即再次压缩无需请求模型且不改写历史', async () => {
    const before = await readFile(sessionFile, 'utf8')
    const repeated = await run('low', { mode: 'compact' })
    assert.equal(repeated.requests.length, 0)
    assert.match(repeated.events.findLast(e => e.type === 'trace' && e.event.kind === 'compaction').event.output, /已经压缩/)
    assert.equal(repeated.events.some(e => e.type === 'trace' && e.event.status === 'error'), false)
    assert.equal(await readFile(sessionFile, 'utf8'), before)
  })
  const off = await run('off'); assert.equal(off.requests[0].thinking.type, 'disabled')
  // A provider usage report beyond our chosen threshold triggers Pi's own
  // compression without altering the real 1,048,576-token model window.
  sessionFile = undefined; promptTokens = 500
  await run('low')
  promptTokens = 50000
  const auto = await run('low', { compaction: { enabled: true, threshold: 40000, keepRecentTokens: 1000 } })
  if (!auto.events.some(e => e.type === 'trace' && e.event.kind === 'compaction')) t.diagnostic(JSON.stringify(auto.events.filter(e => e.type !== 'assistant' && e.event?.kind !== 'text')))
  assert.equal(auto.events.some(e => e.type === 'trace' && e.event.name === '自动压缩上下文'), true)
  assert.equal(auto.events.some(e => e.type === 'trace' && e.event.kind === 'compaction' && e.event.status === 'done'), true)
  await t.test('默认保留量下短对话压缩显示无需压缩，原记录不变且仍能继续对话', async () => {
    sessionFile = undefined; answer = '简短回复。'; promptTokens = 12000
    const compaction = { enabled: true, threshold: 128000, keepRecentTokens: 20000 }
    await run('low', { prompt: '你好', compaction })
    const before = await readFile(sessionFile, 'utf8')
    for (let i = 0; i < 2; i++) {
      const small = await run('low', { mode: 'compact', compaction })
      assert.equal(small.requests.length, 0)
      const event = small.events.findLast(e => e.type === 'trace' && e.event.kind === 'compaction').event
      assert.equal(event.status, 'done'); assert.match(event.output, /当前对话较短.*20,000 tokens.*可以继续对话/)
      assert.equal(small.events.some(e => e.type === 'trace' && e.event.status === 'error'), false)
      assert.equal(await readFile(sessionFile, 'utf8'), before)
    }
    const continued = await run('low', { prompt: '继续这段对话', compaction })
    assert.ok(continued.requests[0].messages.some(message => message.role === 'user' && messageText(message) === '你好'))
    assert.ok(continued.requests[0].messages.some(message => message.role === 'assistant' && messageText(message) === '简短回复。'))
  })
  await t.test('真实压缩请求失败仍报告错误并保留原始历史', async () => {
    sessionFile = undefined; answer = '保留测试内容。'.repeat(2000); promptTokens = 10000
    await run('low')
    const before = await readFile(sessionFile, 'utf8')
    providerError = true
    const failed = await run('low', { mode: 'compact', expectError: true })
    providerError = false
    assert.ok(failed.requests.length > 0)
    const event = failed.events.findLast(e => e.type === 'trace' && e.event.kind === 'compaction').event
    assert.equal(event.status, 'error'); assert.match(event.output, /fixture summary request rejected/)
    assert.equal(await readFile(sessionFile, 'utf8'), before)
    const continued = await run('low', { prompt: '失败后继续' })
    const restored = messageText(continued.requests[0].messages.find(message => message.role === 'assistant'))
    assert.ok(restored.includes('保留测试内容。'.repeat(50)))
  })
})
