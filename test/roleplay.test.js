import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../server/server.js'
import { composeContext, demoProject, emptyMemory, normalizeProject, normalizeSession, validateMemory, validateProject } from '../applications/roleplay/plugins/chat/model.js'
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

test('旧作品升级保留原文案与会话，记忆独立于历史窗口并过滤关闭条目', () => {
  const old = demoProject()
  old.schemaVersion = 1; delete old.player; delete old.opening; delete old.presentation
  old.character.scenario = '用户原来的情境'; old.revision = 8
  const upgraded = normalizeProject(old)
  assert.equal(upgraded.schemaVersion, 2)
  assert.equal(upgraded.revision, 8)
  assert.equal(upgraded.opening.situation, '用户原来的情境')
  assert.equal(old.schemaVersion, 1, '升级不能修改输入对象')
  const now = new Date().toISOString()
  const session = normalizeSession({ id: 'legacy', revision: 3, title: '旧对话', createdAt: now, updatedAt: now, messages: [] }, upgraded)
  assert.deepEqual(session.memory, emptyMemory())
  assert.equal(session.revision, 3)
  session.player.name = '另一位玩家'
  session.memory = { summary: '已经聊过喜欢的唱片', scene: '旧街', relationship: '逐渐熟悉', facts: [{ id: 'promise', content: '周六一起听雨', enabled: true }, { id: 'hidden', content: '不该进入上下文的记忆', enabled: false }] }
  upgraded.context.maxHistoryMessages = 0
  const context = composeContext(upgraded, [{ id: 'newest', role: 'user', content: '周六几点见？', createdAt: now }], session)
  assert.match(context.messages[0].content, /另一位玩家/)
  assert.match(context.messages[0].content, /周六一起听雨/)
  assert.doesNotMatch(context.messages[0].content, /不该进入上下文的记忆/)
  assert.equal(context.messages.at(-1).content, '周六几点见？', '即使关闭历史也必须发送本轮玩家消息')
  assert.ok(context.activeWorldInfoIds.includes('old-street'), '当前情境可激活相关世界信息')
  assert.throws(() => validateMemory({ ...emptyMemory(), facts: [{ id: 'bad', content: '', enabled: true }] }), /记忆条目内容无效/)
  assert.throws(() => validateProject({ ...upgraded, presentation: { portrait: 'javascript:alert(1)', background: '', theme: 'amber' } }), /视觉设置内容无效/)
})

test('旧故事迁移后固定身份与开场，修改新故事默认设定并重启不影响旧故事', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-migration-'))
  const pluginDirectory = join(directory, 'plugin-data', 'chat')
  await mkdir(join(pluginDirectory, 'sessions'), { recursive: true })
  const oldProject = demoProject()
  oldProject.schemaVersion = 1; oldProject.revision = 7
  delete oldProject.player; delete oldProject.opening; delete oldProject.presentation
  const now = new Date().toISOString()
  const oldSession = { id: 'legacy', revision: 4, title: '旧故事', createdAt: now, updatedAt: now, messages: [{ id: 'legacy-greeting', role: 'assistant', content: oldProject.character.greeting, createdAt: now }] }
  await writeFile(join(pluginDirectory, 'project.json'), JSON.stringify(oldProject))
  await writeFile(join(pluginDirectory, 'sessions', 'legacy.json'), JSON.stringify(oldSession))
  const options = { port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin }
  let app = await createHost(options)
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }) })
  const request = async (path, method = 'GET', body) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/roleplay' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  const migrated = await request('/sessions/legacy')
  assert.equal(migrated.revision, oldSession.revision)
  assert.deepEqual(migrated.messages, oldSession.messages)
  const project = await request('/project')
  assert.equal(project.schemaVersion, 2); assert.equal(project.revision, 7)
  project.player.name = '新的默认玩家'; project.opening.location = '另一个地方'
  await request('/project', 'PUT', project)
  await app.close()
  app = await createHost(options)
  assert.deepEqual(await request('/sessions/legacy'), migrated)
  assert.deepEqual(JSON.parse(await readFile(join(pluginDirectory, 'sessions', 'legacy.json'), 'utf8')), migrated)
})

test('故事 HTTP：身份、记忆与分支隔离；接话、候选记忆、试聊不会污染正式对话', async t => {
  const calls = []; let malformed = false
  const provider = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body)
    const last = body.messages.at(-1).content
    let content = '*她微微点头。*「周六见。」'
    if (last.includes('写作助手')) content = malformed ? '格式错误' : JSON.stringify({ suggestions: ['「这张唱片有什么故事？」', '*走到窗边听雨。*', '「我也喜欢安静的地方。」'] })
    if (last.includes('整理已发生')) content = JSON.stringify({ summary: '一起听过一张唱片', scene: '唱片店窗边', relationship: '彼此熟悉了一些', facts: ['约好周六见'] })
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) })
  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-story-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = await createHost({ port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin })
  t.after(() => app.close())
  const request = async (path, method = 'GET', body) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/roleplay' + path, { method,
      headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, data: await response.json() }
  }
  await request('/settings', 'PUT', { baseUrl: 'http://127.0.0.1:' + provider.address().port + '/v1', model: 'story-test', apiKey: 'test-only' })
  const project = (await request('/project')).data
  const player = { name: '阿舟', description: '成年摄影师', relationship: '刚认识' }
  const opening = { title: '茶凉之前', location: '窗边', time: '夜晚', situation: '停电后，你们点起一盏灯。' }
  const first = (await request('/sessions', 'POST', { player, opening })).data
  assert.equal(first.player.name, '阿舟'); assert.equal(first.opening.title, '茶凉之前')
  const memory = { summary: '听过唱片', scene: '窗边', relationship: '逐渐熟悉', facts: [{ id: 'promise', content: '周六一起听雨', enabled: true }, { id: 'disabled', content: '关闭的事实', enabled: false }] }
  const saved = await request('/sessions/' + first.id + '/state', 'PUT', { revision: 0, memory })
  assert.equal(saved.status, 200); assert.equal(saved.data.revision, 1)
  assert.equal((await request('/sessions/' + first.id + '/state', 'PUT', { revision: 0, memory })).status, 409)
  const replied = await request('/sessions/' + first.id + '/reply', 'POST', { message: '周六见。' })
  assert.equal(replied.status, 200)
  assert.match(calls.at(-1).messages[0].content, /阿舟/)
  assert.match(calls.at(-1).messages[0].content, /周六一起听雨/)
  assert.doesNotMatch(calls.at(-1).messages[0].content, /关闭的事实/)
  const before = (await request('/sessions/' + first.id)).data
  const suggested = await request('/sessions/' + first.id + '/suggestions', 'POST', {})
  assert.equal(suggested.status, 200); assert.equal(suggested.data.suggestions.length, 3)
  const candidate = await request('/sessions/' + first.id + '/memory-draft', 'POST', {})
  assert.equal(candidate.status, 200); assert.equal(candidate.data.memory.facts[0].content, '约好周六见')
  assert.deepEqual((await request('/sessions/' + first.id)).data, before, '辅助生成不能写入消息或覆盖确认的记忆')
  malformed = true
  assert.equal((await request('/sessions/' + first.id + '/suggestions', 'POST', {})).status, 502)
  assert.deepEqual((await request('/sessions/' + first.id)).data, before)
  const draft = structuredClone(project); draft.player.name = '试聊者'; draft.character.personality = '新的语气设定'
  const played = await request('/playtest', 'POST', { project: draft, messages: [], message: '试一试。' })
  assert.equal(played.status, 200); assert.equal(played.data.messages.length, 2)
  assert.match(calls.at(-1).messages[0].content, /试聊者/)
  assert.deepEqual((await request('/project')).data, project)
  assert.deepEqual((await request('/sessions/' + first.id)).data, before)
  const fork = (await request('/sessions', 'POST', { sourceSessionId: first.id, messages: before.messages })).data
  assert.deepEqual(fork.memory, memory); assert.deepEqual(fork.player, player)
  const earlier = (await request('/sessions', 'POST', { sourceSessionId: first.id, messages: before.messages.slice(0, 1) })).data
  assert.deepEqual(earlier.memory, emptyMemory(), '回到过去的分支不能带入未来事件')
  const rewrittenMessages = structuredClone(before.messages)
  rewrittenMessages.at(-1).content = '这是另一个发展方向。'
  const rewritten = (await request('/sessions', 'POST', { sourceSessionId: first.id, messages: rewrittenMessages })).data
  assert.deepEqual(rewritten.memory, emptyMemory(), '消息数量相同但剧情已改变时也不能继承旧记忆')
  const fresh = (await request('/sessions', 'POST', {})).data
  assert.deepEqual(fresh.memory, emptyMemory()); assert.deepEqual(fresh.player, project.player)
})

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
    assert.deepEqual(savedSettings.result, { protocol: 'chat', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: true, reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
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
    assert.deepEqual(cleared.result, { protocol: 'chat', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: false, reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
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
    assert.deepEqual(saved.result, { protocol: 'responses', baseUrl: settings.baseUrl, model: settings.model, hasApiKey: true, reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
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
      { schemaVersion: 3, protocol: 'chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'legacy', reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
    assert.deepEqual(normalizeSettings({ schemaVersion: 2, protocol: 'responses', baseUrl: 'https://ollama.com/v1', model: 'deepseek-v4.1-flash:1017', apiKey: 'legacy-key' }),
      { schemaVersion: 3, protocol: 'responses', baseUrl: 'https://ollama.com/v1', model: 'deepseek-v4.1-flash:1017', apiKey: 'legacy-key', reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
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

test('设置页的思考强度、超时与流式开关会保存并传给模型服务', async t => {
  const bodies = []
  const provider = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    bodies.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(req.url.endsWith('/responses')
      ? { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '好的' }] }] }
      : { choices: [{ message: { role: 'assistant', content: '好的' } }] }))
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) })

  const directory = await mkdtemp(join(tmpdir(), 'cordis-roleplay-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const app = await createHost({ port: 0, dataDir: directory, initialApplication: 'roleplay', standalone: { id: 'roleplay', name: '角色剧场', pluginsDir: directory, default: true }, discoverPlugins: discoverRoleplayPlugin })
  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }
  const base = 'http://127.0.0.1:' + app.server.address().port
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) })
    return { status: response.status, result: await response.json() }
  }
  const providerUrl = 'http://127.0.0.1:' + provider.address().port + '/v1'
  try {
    const initial = await call('/api/roleplay/settings')
    assert.equal(initial.result.reasoningEffort, 'default')
    assert.equal(initial.result.timeoutSeconds, 120)
    assert.equal(initial.result.stream, true)

    const saved = await call('/api/roleplay/settings', 'PUT', { protocol: 'responses', baseUrl: providerUrl, model: 'settings-model', apiKey: 'settings-key', reasoningEffort: 'high', timeoutSeconds: 45, stream: false })
    assert.equal(saved.status, 200)
    assert.equal(saved.result.reasoningEffort, 'high')
    assert.equal(saved.result.timeoutSeconds, 45)
    assert.equal(saved.result.stream, false)

    const created = await call('/api/roleplay/sessions', 'POST', {})
    const replied = await call('/api/roleplay/sessions/' + created.result.id + '/reply', 'POST', { message: '你好' })
    assert.equal(replied.status, 200)
    assert.deepEqual(bodies.at(-1).body.reasoning, { effort: 'high' })
    assert.equal('reasoning_effort' in bodies.at(-1).body, false)

    const kept = await call('/api/roleplay/settings', 'PUT', { protocol: 'chat', baseUrl: providerUrl, model: 'settings-model' })
    assert.equal(kept.result.reasoningEffort, 'high', '未提供的参数保持原值')
    assert.equal(kept.result.timeoutSeconds, 45)
    assert.equal(kept.result.stream, false)

    await call('/api/roleplay/sessions/' + created.result.id + '/reply', 'POST', { message: '再说一句' })
    assert.equal(bodies.at(-1).url, '/v1/chat/completions')
    assert.equal(bodies.at(-1).body.reasoning_effort, 'high')
    assert.equal('reasoning' in bodies.at(-1).body, false)

    assert.equal((await call('/api/roleplay/settings', 'PUT', { baseUrl: providerUrl, model: 'settings-model', reasoningEffort: 'ultra' })).status, 400)
    assert.equal((await call('/api/roleplay/settings', 'PUT', { baseUrl: providerUrl, model: 'settings-model', timeoutSeconds: 5 })).status, 400)
    assert.equal((await call('/api/roleplay/settings', 'PUT', { baseUrl: providerUrl, model: 'settings-model', stream: 'yes' })).status, 400)
  } finally { await app.close() }
})
