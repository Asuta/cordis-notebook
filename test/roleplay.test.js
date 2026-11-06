import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../server/server.js'
import { composeContext, demoProject, validateProject } from '../applications/roleplay/plugins/chat/model.js'
import roleplayServer, { normalizeSettings } from '../applications/roleplay/plugins/chat/server.js'

const discoverRoleplayPlugin = async () => [{
  manifest: {
    id: 'chat', name: '角色卡与自由对话', description: '', version: '1.0.0', schemaVersion: 1,
    packageDependencies: {}, client: null, requires: { server: ['http'], client: [] },
    provides: { server: [], client: [] }, capabilities: [], styles: [],
    category: { id: 'features', label: '功能' }, icon: 'Puzzle',
  },
  defaultEnabled: true,
  server: { inject: ['http'], apply: (ctx, activation) => roleplayServer(ctx, activation.settings, activation.runtime) },
}]

test('角色扮演模型严格校验字段，并按关键词组装人物、属性和世界信息上下文', () => {
  const project = demoProject()
  assert.equal(validateProject(project), project)
  assert.match(project.character.description, /28 岁的成年女性/)
  assert.match(project.character.greeting, /聊点什么都可以/)
  const nodeBuffer = globalThis.Buffer
  try { globalThis.Buffer = undefined; assert.equal(validateProject(project), project) }
  finally { globalThis.Buffer = nodeBuffer }
  assert.throws(() => validateProject({ ...structuredClone(project), unexpected: true }), /字段无效/)
  assert.throws(() => validateProject({ ...structuredClone(project), context: { ...project.context, maxTokens: 9000 } }), /上下文设置无效/)

  const now = new Date().toISOString()
  const preview = composeContext(project, [{ id: 'hello', role: 'user', content: '我想聊聊回声唱片店和旧街。', createdAt: now }])
  assert.deepEqual(preview.activeWorldInfoIds, ['echo-records', 'old-street'])
  assert.equal(preview.messages[0].role, 'system')
  assert.match(preview.messages[0].content, /林澄/)
  assert.match(preview.messages[0].content, /桂花乌龙/)
  assert.match(preview.messages[0].content, /这片街区正慢慢翻修/)
  assert.doesNotMatch(preview.messages[0].content, /用于作者自己的提醒/)
  assert.deepEqual(preview.messages[1], { role: 'user', content: '我想聊聊回声唱片店和旧街。' })

  const withoutKeyword = composeContext(project, [{ id: 'unrelated', role: 'user', content: '今天的天气真不错。', createdAt: now }])
  assert.deepEqual(withoutKeyword.activeWorldInfoIds, ['echo-records'])
  const disabled = structuredClone(project)
  disabled.worldInfo[0].enabled = false
  assert.deepEqual(composeContext(disabled, []).activeWorldInfoIds, [])
})

test('角色扮演 HTTP：首启示例、分支、密钥、并发版本、模型对话、重新生成与持久化', async t => {
  const providerCalls = []
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    providerCalls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body })
    res.setHeader('Content-Type', 'application/json')
    if (providerCalls.length === 3) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: { message: 'provider failure' } }))
      return
    }
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '模拟回复 ' + providerCalls.length } }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) })

  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const hostOptions = { port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin }
  let app = await createHost(hostOptions)
  const request = async (path, method = 'GET', body = {}) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, result: await response.json() }
  }
  try {
    assert.equal(app.applications.current.app.id, 'roleplay')
    const initial = await request('/api/roleplay/project')
    assert.equal(initial.status, 200)
    assert.equal(initial.result.id, 'main')
    assert.match(initial.result.character.description, /28 岁的成年女性/)
    assert.equal((await request('/api/roleplay/settings')).result.hasApiKey, false)

    const now = new Date().toISOString()
    const directPreview = await request('/api/roleplay/context-preview', 'POST', {
      messages: [{ id: 'preview-message', role: 'user', content: '我想听听回声唱片店和旧街的故事。', createdAt: now }],
    })
    assert.equal(directPreview.status, 200)
    assert.deepEqual(directPreview.result.activeWorldInfoIds, ['echo-records', 'old-street'])
    assert.equal(directPreview.result.messages[0].role, 'system')
    assert.match(directPreview.result.messages[0].content, /桂花乌龙/)
    assert.doesNotMatch(directPreview.result.messages[0].content, /用于作者自己的提醒/)

    const created = await request('/api/roleplay/sessions', 'POST', { title: '雨天初见' })
    assert.equal(created.status, 200)
    assert.equal(created.result.revision, 0)
    assert.equal(created.result.messages.length, 1)
    assert.equal(created.result.messages[0].role, 'assistant')
    assert.equal(created.result.messages[0].content, initial.result.character.greeting)
    const sessionId = created.result.id

    const withoutKey = await request('/api/roleplay/sessions/' + sessionId + '/reply', 'POST', { message: '先试着聊一句。' })
    assert.equal(withoutKey.status, 400)
    assert.match(withoutKey.result.error, /API Key/)
    assert.equal((await request('/api/roleplay/sessions/' + sessionId)).result.messages.length, 1)

    const prefix = [{ id: 'branch-prefix', role: 'user', content: '我常听老唱片。', createdAt: now }]
    const branch = await request('/api/roleplay/sessions', 'POST', { title: '从一句话分支', messages: prefix })
    assert.equal(branch.status, 200)
    assert.deepEqual(branch.result.messages, prefix)
    assert.equal(branch.result.messages.some(message => message.role === 'assistant'), false)
    const branchPreview = await request('/api/roleplay/context-preview', 'POST', { sessionId: branch.result.id })
    assert.deepEqual(branchPreview.result.activeWorldInfoIds, ['echo-records'])

    const secret = 'roleplay-secret-test-key'
    const settings = { baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', model: 'local-roleplay-model', apiKey: secret }
    const savedSettings = await request('/api/roleplay/settings', 'PUT', settings)
    assert.equal(savedSettings.status, 200)
    assert.deepEqual(savedSettings.result, { protocol: 'chat', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: true })
    assert.equal(JSON.stringify(savedSettings.result).includes(secret), false)
    const retainedKey = await request('/api/roleplay/settings', 'PUT', { baseUrl: settings.baseUrl, model: settings.model, apiKey: '' })
    assert.equal(retainedKey.result.hasApiKey, true)
    assert.equal(Object.hasOwn((await request('/api/roleplay/settings')).result, 'apiKey'), false)

    const reply = await request('/api/roleplay/sessions/' + sessionId + '/reply', 'POST', { message: '我想听听旧街和唱片店的故事。' })
    assert.equal(reply.status, 200)
    assert.equal(reply.result.revision, 1)
    assert.equal(reply.result.messages.length, 3)
    assert.equal(reply.result.messages[0].content, initial.result.character.greeting)
    assert.equal(reply.result.messages[1].role, 'user')
    assert.equal(reply.result.messages[2].content, '模拟回复 1')
    assert.equal(providerCalls[0].method, 'POST')
    assert.equal(providerCalls[0].url, '/v1/chat/completions')
    assert.equal(providerCalls[0].authorization, 'Bearer ' + secret)
    assert.equal(providerCalls[0].body.model, settings.model)
    assert.equal(providerCalls[0].body.temperature, initial.result.context.temperature)
    assert.equal(providerCalls[0].body.max_tokens, initial.result.context.maxTokens)
    assert.ok(providerCalls[0].body.messages.some(message => message.content.includes('这片街区正慢慢翻修')))

    const regenerated = await request('/api/roleplay/sessions/' + sessionId + '/regenerate', 'POST', {})
    assert.equal(regenerated.status, 200)
    assert.equal(regenerated.result.revision, 2)
    assert.equal(regenerated.result.messages.length, 3)
    assert.equal(regenerated.result.messages[0].content, initial.result.character.greeting)
    assert.deepEqual(regenerated.result.messages[1], reply.result.messages[1])
    assert.equal(regenerated.result.messages[2].content, '模拟回复 2')
    assert.notEqual(regenerated.result.messages[2].id, reply.result.messages[2].id)
    assert.equal(providerCalls[1].body.messages.filter(message => message.role === 'assistant').length, 1, '重新生成时保留开场 greeting，且不把旧回复再次送入模型')

    const failedReply = await request('/api/roleplay/sessions/' + sessionId + '/reply', 'POST', { message: '这次模拟上游错误。' })
    assert.equal(failedReply.status, 502)
    assert.equal(providerCalls.length, 3, '上游错误后只发起一次请求，不自动重试')
    const afterFailure = await request('/api/roleplay/sessions/' + sessionId)
    assert.deepEqual(afterFailure.result.messages, regenerated.result.messages, '模型失败时不保存孤立的用户消息')

    const updateSession = { ...regenerated.result, title: '更新后的会话' }
    const savedSession = await request('/api/roleplay/sessions/' + sessionId, 'PUT', updateSession)
    assert.equal(savedSession.status, 200)
    assert.equal(savedSession.result.revision, 3)
    assert.equal(savedSession.result.title, '更新后的会话')
    assert.equal((await request('/api/roleplay/sessions/' + sessionId, 'PUT', updateSession)).status, 409)

    const updateProjectA = structuredClone(initial.result)
    updateProjectA.description = '并发保存版本 A。'
    const updateProjectB = structuredClone(initial.result)
    updateProjectB.description = '并发保存版本 B。'
    const projectUpdates = await Promise.all([
      request('/api/roleplay/project', 'PUT', updateProjectA),
      request('/api/roleplay/project', 'PUT', updateProjectB),
    ])
    assert.deepEqual(projectUpdates.map(item => item.status).sort(), [200, 409])
    const savedProject = projectUpdates.find(item => item.status === 200)
    assert.equal(savedProject.result.revision, 1)
    assert.ok(['并发保存版本 A。', '并发保存版本 B。'].includes(savedProject.result.description))
    assert.equal((await request('/api/roleplay/project', 'PUT', updateProjectA)).status, 409)

    const list = await request('/api/roleplay/sessions')
    assert.equal(list.status, 200)
    assert.ok(Array.isArray(list.result))
    assert.equal(list.result.find(item => item.id === sessionId).messageCount, 3)
    assert.equal((await request('/api/roleplay/context-preview', 'POST', { sessionId })).result.messages.at(-1).content, '模拟回复 2')

    await app.close()
    app = await createHost(hostOptions)
    const persistedProject = await request('/api/roleplay/project')
    const persistedSession = await request('/api/roleplay/sessions/' + sessionId)
    const persistedSettings = await request('/api/roleplay/settings')
    assert.equal(persistedProject.result.revision, 1)
    assert.equal(persistedProject.result.description, savedProject.result.description)
    assert.equal(persistedSession.result.revision, 3)
    assert.equal(persistedSession.result.title, '更新后的会话')
    assert.equal(persistedSettings.result.hasApiKey, true)
    assert.equal(Object.hasOwn(persistedSettings.result, 'apiKey'), false)
    assert.equal(JSON.stringify(persistedSettings.result).includes(secret), false)

    const cleared = await request('/api/roleplay/settings', 'PUT', { baseUrl: settings.baseUrl, model: settings.model, clearApiKey: true })
    assert.deepEqual(cleared.result, { protocol: 'chat', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: false })
  } finally { await app.close() }
})

test('角色扮演支持 Responses 协议、图片输入、连接测试与旧设置迁移', async t => {
  const calls = []
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    calls.push({ url: req.url, body })
    res.setHeader('Content-Type', 'application/json')
    if (req.url.endsWith('/responses')) {
      res.end(JSON.stringify({ id: 'resp_1', object: 'response', status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Responses 回复 ' + calls.length }] }] }))
      return
    }
    res.statusCode = 500
    res.end(JSON.stringify({ error: { message: '不应调用 Chat Completions' } }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) })

  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-responses-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const hostOptions = { port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin }
  const app = await createHost(hostOptions)
  const request = async (path, method = 'GET', body = {}) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, result: await response.json() }
  }
  try {
    const settings = { protocol: 'responses', baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', model: 'deepseek-v4.1-flash:1017', apiKey: 'responses-test-key' }
    const saved = await request('/api/roleplay/settings', 'PUT', settings)
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.result, { protocol: 'responses', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: true })
    assert.equal(JSON.stringify(saved.result).includes(settings.apiKey), false)

    const tested = await request('/api/roleplay/settings/test', 'POST', {})
    assert.equal(tested.status, 200, JSON.stringify(tested.result))
    assert.match(tested.result.reply, /Responses 回复/)
    const testCall = calls.at(-1)
    assert.equal(testCall.url, '/v1/responses')
    assert.equal(testCall.body.model, settings.model)
    assert.equal(testCall.body.instructions, '你正在接受接口连通性检查。')
    assert.deepEqual(testCall.body.input, [{ role: 'user', content: '请只回复四个字：连接成功' }])
    assert.equal(testCall.body.max_output_tokens, 64)

    const created = await request('/api/roleplay/sessions', 'POST', { title: '图片对话' })
    const image = { id: 'image-one', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' }
    const replied = await request('/api/roleplay/sessions/' + created.result.id + '/reply', 'POST', { message: '看看这张照片里有什么。', images: [image] })
    assert.equal(replied.status, 200, JSON.stringify(replied.result))
    assert.equal(replied.result.messages.at(-1).role, 'assistant')
    assert.equal(replied.result.messages.at(-2).images.length, 1)
    const call = calls.at(-1)
    assert.equal(call.url, '/v1/responses')
    assert.ok(call.body.instructions.includes('林澄'))
    const lastUser = call.body.input.at(-1)
    assert.equal(lastUser.role, 'user')
    assert.equal(lastUser.content[0].type, 'input_text')
    assert.deepEqual(lastUser.content[1], { type: 'input_image', image_url: image.dataUrl })

    const preview = await request('/api/roleplay/context-preview', 'POST', { sessionId: created.result.id })
    assert.equal(preview.result.messages.at(-2).imageCount, 1)
    assert.equal(JSON.stringify(preview.result).includes('iVBORw0KGgo'), false, '上下文预览不应包含图片本体')

    const invalid = await request('/api/roleplay/sessions/' + created.result.id + '/reply', 'POST', { message: '坏图', images: [{ id: 'bad', mimeType: 'image/gif', dataUrl: 'data:image/gif;base64,AAAA' }] })
    assert.equal(invalid.status, 400)
    assert.equal(calls.length, 2, '图片校验失败时不应请求模型')

    assert.deepEqual(normalizeSettings({ schemaVersion: 1, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'legacy' }),
      { schemaVersion: 2, protocol: 'chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'legacy' })
  } finally { await app.close() }
})

test('角色扮演流式输出逐段推送，完成后保存完整会话', async t => {
  const seen = []
  let upstreamClosed
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    seen.push({ url: req.url, stream: body.stream })
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const userText = (req.url.endsWith('/responses') ? body.input : body.messages).at(-1).content
    if (userText === '取消请求') {
      upstreamClosed = new Promise(resolve => res.once('close', resolve))
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '不应保存' } }] }) + '\n\n')
      return
    }
    if (userText === '提前断开') {
      res.end('data: ' + JSON.stringify(req.url.endsWith('/responses')
        ? { type: 'response.output_text.delta', delta: '半截回复' }
        : { choices: [{ delta: { content: '半截回复' } }] }) + '\n\n')
      return
    }
    if (userText === '明确未完成' && req.url.endsWith('/responses')) {
      res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '半截回复' }) + '\n\n')
      res.end('data: ' + JSON.stringify({ type: 'response.incomplete', response: { status: 'incomplete' } }) + '\n\n')
      return
    }
    if (req.url.endsWith('/responses')) {
      res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '雨停了，' }) + '\n\n')
      res.write('data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '街上安静下来。' }) + '\n\n')
      res.end('data: ' + JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }) + '\n\n')
      return
    }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '唱片还在转，' } }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '雨声小了。' } }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) })

  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-stream-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = await createHost({ port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin })
  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }
  const base = 'http://127.0.0.1:' + app.server.address().port
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) })
    return { status: response.status, result: await response.json() }
  }
  const readStream = async (path, message = '雨停了吗？') => {
    const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify({ mode: 'reply', message }) })
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let raw = ''
    while (true) { const { done, value } = await reader.read(); if (done) break; raw += decoder.decode(value, { stream: true }) }
    return { type: response.headers.get('content-type'), events: raw.split('\n\n').filter(block => block.trim()).map(block => JSON.parse(block.split('\n').find(line => line.startsWith('data:')).slice(5).trim())) }
  }
  try {
    const created = await call('/api/roleplay/sessions', 'POST', { title: '流式对话' })
    await call('/api/roleplay/settings', 'PUT', { protocol: 'responses', baseUrl: base.replace(/:\d+$/, ':' + provider.address().port) + '/v1', model: 'stream-model', apiKey: 'stream-key' })

    const responsesStream = await readStream('/api/roleplay/sessions/' + created.result.id + '/stream')
    assert.match(responsesStream.type, /text\/event-stream/)
    assert.deepEqual(responsesStream.events.filter(event => event.type === 'delta').map(event => event.text), ['雨停了，', '街上安静下来。'])
    const doneEvent = responsesStream.events.find(event => event.type === 'done')
    assert.ok(doneEvent)
    assert.equal(doneEvent.session.messages.at(-1).content, '雨停了，街上安静下来。')
    assert.equal(seen.at(-1).stream, true)

    const saved = await call('/api/roleplay/sessions/' + created.result.id)
    assert.equal(saved.result.messages.at(-1).content, '雨停了，街上安静下来。')

    await call('/api/roleplay/settings', 'PUT', { protocol: 'chat', baseUrl: base.replace(/:\d+$/, ':' + provider.address().port) + '/v1', model: 'stream-model' })
    const chatStream = await readStream('/api/roleplay/sessions/' + created.result.id + '/stream')
    assert.deepEqual(chatStream.events.filter(event => event.type === 'delta').map(event => event.text), ['唱片还在转，', '雨声小了。'])
    assert.equal(chatStream.events.find(event => event.type === 'done').session.messages.at(-1).content, '唱片还在转，雨声小了。')

    const streamPath = '/api/roleplay/sessions/' + created.result.id + '/stream'
    const messageCount = (await call('/api/roleplay/sessions/' + created.result.id)).result.messages.length
    for (const protocol of ['chat', 'responses']) {
      await call('/api/roleplay/settings', 'PUT', { protocol, baseUrl: base.replace(/:\d+$/, ':' + provider.address().port) + '/v1', model: 'stream-model' })
      const truncated = await readStream(streamPath, '提前断开')
      assert.ok(truncated.events.some(event => event.type === 'delta'))
      assert.match(truncated.events.find(event => event.type === 'error')?.message || '', /提前结束/)
      assert.equal(truncated.events.some(event => event.type === 'done'), false)
      assert.equal((await call('/api/roleplay/sessions/' + created.result.id)).result.messages.length, messageCount)
    }
    const incomplete = await readStream(streamPath, '明确未完成')
    assert.ok(incomplete.events.some(event => event.type === 'error'))
    assert.equal(incomplete.events.some(event => event.type === 'done'), false)
    assert.equal((await call('/api/roleplay/sessions/' + created.result.id)).result.messages.length, messageCount)

    await call('/api/roleplay/settings', 'PUT', { protocol: 'chat', baseUrl: base.replace(/:\d+$/, ':' + provider.address().port) + '/v1', model: 'stream-model' })
    const controller = new AbortController()
    const cancelled = await fetch(base + streamPath, { method: 'POST', headers, body: JSON.stringify({ mode: 'reply', message: '取消请求' }), signal: controller.signal })
    const reader = cancelled.body.getReader()
    assert.equal((await reader.read()).done, false, '先收到部分回复，再停止生成')
    controller.abort()
    await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(Error('上游请求未取消')), 3000))])
    const resumed = await readStream(streamPath)
    assert.ok(resumed.events.some(event => event.type === 'done'), '取消后同一会话还能继续生成')
    assert.equal((await call('/api/roleplay/sessions/' + created.result.id)).result.messages.length, messageCount + 2, '取消的回复和用户消息均未保存')

    const badMode = await call('/api/roleplay/sessions/' + created.result.id + '/stream', 'POST', { mode: 'unknown' })
    assert.equal(badMode.status, 400)
  } finally { await app.close() }
})
