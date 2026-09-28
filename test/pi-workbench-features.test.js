import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { AttachmentStore } from '../workbench/attachments.js'

test('真实 Pi 请求：多图、Low/High/Max、思考事件、手动与自动压缩', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-pi-features-')), requests = [], events = []
  await mkdir(join(root, 'agent'), { recursive: true }); await mkdir(join(root, 'applications/notebook'), { recursive: true })
  await writeFile(join(root, 'agent/ARCHITECTURE.md'), '只运行测试')
  let answer = '## 完成\n\n' + '保留测试内容。'.repeat(2000), promptTokens = 10000
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body); requests.push(parsed)
    const usage = { prompt_tokens: promptTokens, completion_tokens: 100, total_tokens: promptTokens + 100 }
    if (parsed.stream === false) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: answer, reasoning_content: '思考示例' }, finish_reason: 'stop' }], usage })); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const delta of [{ role: 'assistant', reasoning_content: '思考示例' }, { content: answer }]) res.write('data: ' + JSON.stringify({ id: 'mock', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ id: 'mock', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage }) + '\n\n'); res.end('data: [DONE]\n\n')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const worker = fork(resolve('workbench/agent-worker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = '', resolveRun
  worker.stderr.on('data', chunk => stderr += chunk)
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
        config: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'deepseek-flash', thinking: effort !== 'off', reasoningEffort: effort === 'off' ? 'high' : effort, compaction: options.compaction || { enabled: false, threshold: 128000, keepRecentTokens: 1000 } },
        task: { appId: 'notebook', prompt: '继续分析' + '测试文字'.repeat(1500), sessionFile, images: options.images || [], mode: options.mode || 'chat' } })
    })
    const result = events.slice(start)
    assert.deepEqual(result.filter(e => e.type === 'error'), [], stderr)
    sessionFile = result.find(e => e.type === 'session')?.file || sessionFile
    return { events: result, requests: requests.slice(requestStart) }
  }
  const low = await run('low', { images })
  assert.equal(low.requests[0].reasoning_effort, 'low')
  assert.equal(low.requests[0].thinking.type, 'enabled')
  const user = low.requests[0].messages.findLast(m => m.role === 'user')
  assert.equal(user.content.filter(c => c.type === 'image_url').length, 2)
  assert.equal(low.events.some(e => e.type === 'trace' && e.event.kind === 'thinking' && e.event.delta === '思考示例'), true)
  assert.equal(low.events.some(e => e.type === 'trace' && e.event.kind === 'text'), true)
  const high = await run('high'); assert.equal(high.requests[0].reasoning_effort, 'high')
  const max = await run('max'); assert.equal(max.requests[0].reasoning_effort, 'max')
  answer = '压缩摘要：继续验证图片与配置。'; promptTokens = 500
  const compact = await run('low', { mode: 'compact' })
  const compactionEvents = compact.events.filter(e => e.type === 'trace' && e.event.kind === 'compaction')
  assert.equal(compactionEvents[0].event.status, 'running'); assert.equal(compactionEvents.at(-1).event.status, 'done')
  assert.match(compactionEvents.at(-1).event.text, /压缩摘要/)
  assert.ok(compact.requests.every(request => (request.max_tokens || request.max_completion_tokens) <= 16384))
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
})
