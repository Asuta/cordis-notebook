import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('真实 Pi SDK 使用 Chat Completions，调用文件与应用工具，并读取双层上下文', { timeout: 45000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'cordis-pi-')), requests = [], events = [], outputFile = join(root, 'created-by-agent.txt')
  await mkdir(join(root, 'agent'), { recursive: true }); await mkdir(join(root, 'applications/notebook'), { recursive: true })
  await writeFile(join(root, 'agent/ARCHITECTURE.md'), 'HOST_CONTEXT_SENTINEL')
  await writeFile(join(root, 'applications/notebook/agent.md'), 'APP_CONTEXT_SENTINEL')
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const parsed = JSON.parse(body); requests.push({ url: req.url, ...parsed })
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const tool = requests.length === 1 ? ['write', { path: outputFile, content: '真实 SDK 已执行' }] : requests.length === 2 ? ['app_list_tools', {}] : null
    const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + requests.length, type: 'function', function: { name: tool[0], arguments: JSON.stringify(tool[1]) } }] } : { role: 'assistant', content: '验证成功' }
    res.write('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', model: 'fixture', choices: [{ index: 0, delta, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const worker = fork(resolve('workbench/agent-worker.js'), [], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''; worker.stderr.on('data', chunk => stderr += chunk)
  t.after(() => { if (!events.some(e => e.type === 'done')) t.diagnostic(JSON.stringify({ events, requests: requests.length, stderr })) })
  t.after(async () => { if (worker.exitCode === null) { const exit = once(worker, 'exit'); worker.kill(); await exit }; server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }) })
  const done = new Promise((resolve, reject) => {
    worker.on('error', reject)
    worker.on('exit', code => reject(Error('Pi 提前退出 ' + code + ': ' + stderr)))
    worker.on('message', message => {
      events.push(message)
      if (message.type === 'ready') worker.send({ type: 'run', root, agentDir: join(root, '.pi'), config: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'fixture', thinking: false }, task: { appId: 'notebook', prompt: '测试文件和工具' } })
      if (message.type === 'tool') worker.send({ type: 'result', id: message.id, result: { tools: [{ name: 'notebook_read' }] } })
      if (message.type === 'done') resolve()
    })
  })
  await done
  assert.deepEqual(events.filter(e => e.type === 'error'), [], stderr)
  assert.equal(await readFile(outputFile, 'utf8'), '真实 SDK 已执行')
  assert.equal(events.some(e => e.type === 'tool' && e.name === 'app_list_tools'), true)
  assert.equal(events.some(e => e.type === 'assistant' && e.text === '验证成功'), true)
  assert.equal(requests.length, 3); assert.equal(requests[0].url, '/v1/chat/completions')
  const instructions = JSON.stringify(requests[0].messages)
  assert.match(instructions, /HOST_CONTEXT_SENTINEL/); assert.match(instructions, /APP_CONTEXT_SENTINEL/)
  assert.equal(instructions.includes('test-key'), false)
})
