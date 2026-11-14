import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { composeContext, demoProject, emptyMemory, LIMITS, normalizeProject, normalizeSession, validateImages, validateMemory, validateMessages, validateOpening, validatePlayer, validateProject, validateSession } from './model.js'

const fail = (status, message) => { throw Object.assign(Error(message), { status }) }
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const idOK = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/i.test(value)
const isoNow = () => new Date().toISOString()
const PROTOCOLS = Object.freeze({ responses: '/responses', chat: '/chat/completions' })
const EFFORTS = Object.freeze(['default', 'off', 'low', 'medium', 'high'])
const DEFAULT_SETTINGS = Object.freeze({ schemaVersion: 3, protocol: 'chat', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '', reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
const MAX_PROVIDER_BYTES = 1024 * 1024
const MAX_ERROR_CHARS = 300

function exactKeys(input, required, optional = []) {
  if (!object(input) || Object.keys(input).some(key => ![...required, ...optional].includes(key)) || required.some(key => !(key in input))) fail(400, '请求字段无效')
}

function normalizeBaseUrl(input) {
  if (typeof input !== 'string' || input.length > 1000 || !input.trim()) fail(400, '模型接口地址无效')
  let url
  try { url = new URL(input.trim()) } catch { fail(400, '模型接口地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail(400, '模型接口地址必须是有效的 HTTP 或 HTTPS 地址')
  return url.toString().replace(/\/+$/, '')
}

function validateSettings(value) {
  exactKeys(value, ['schemaVersion', 'protocol', 'baseUrl', 'model', 'apiKey', 'reasoningEffort', 'timeoutSeconds', 'stream'])
  if (value.schemaVersion !== 3 || !Object.hasOwn(PROTOCOLS, value.protocol) || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 160 || /[\r\n]/.test(value.model) || typeof value.apiKey !== 'string' || value.apiKey.length > 4096 || /[\r\n]/.test(value.apiKey)) fail(400, '模型设置无效')
  if (!EFFORTS.includes(value.reasoningEffort) || !Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 30 || value.timeoutSeconds > 600 || typeof value.stream !== 'boolean') fail(400, '调用参数无效')
  return { schemaVersion: 3, protocol: value.protocol, baseUrl: normalizeBaseUrl(value.baseUrl), model: value.model.trim(), apiKey: value.apiKey.trim(), reasoningEffort: value.reasoningEffort, timeoutSeconds: value.timeoutSeconds, stream: value.stream }
}

// 旧版本只保存连接信息，读取时补齐协议与调用参数，不改动密钥。
export function normalizeSettings(value) {
  if (object(value) && value.schemaVersion === 1) return validateSettings({ schemaVersion: 3, protocol: 'chat', baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey, reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
  if (object(value) && value.schemaVersion === 2) return validateSettings({ schemaVersion: 3, protocol: value.protocol, baseUrl: value.baseUrl, model: value.model, apiKey: value.apiKey, reasoningEffort: 'default', timeoutSeconds: 120, stream: true })
  return validateSettings(value)
}

function publicSettings(value) {
  return { protocol: value.protocol, baseUrl: value.baseUrl, model: value.model, hasApiKey: !!value.apiKey, reasoningEffort: value.reasoningEffort, timeoutSeconds: value.timeoutSeconds, stream: value.stream }
}

// Responses 用 reasoning.effort，Chat Completions 用 reasoning_effort；默认值不发送字段。
function reasoningFields(modelSettings) {
  const effort = modelSettings.reasoningEffort
  if (!effort || effort === 'default') return {}
  return modelSettings.protocol === 'responses' ? { reasoning: { effort } } : { reasoning_effort: effort }
}

function message(role, content, images) {
  return { id: randomUUID(), role, content, createdAt: isoNow(), ...(images?.length ? { images: structuredClone(images) } : {}) }
}

function unwrap(value, key) {
  if (object(value) && Object.keys(value).length === 1 && key in value) return value[key]
  return value
}

async function responseText(response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PROVIDER_BYTES) { await reader.cancel(); fail(502, '模型服务返回内容过大') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks).toString('utf8')
}

function responseContent(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  if (Array.isArray(data?.output)) {
    const text = data.output.flatMap(item => Array.isArray(item?.content) ? item.content : [])
      .map(part => part && typeof part.text === 'string' ? part.text : '').join('').trim()
    if (text) return text
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.filter(part => part && typeof part.text === 'string').map(part => part.text).join('').trim()
  return ''
}

async function providerError(response) {
  const text = await response.text().catch(() => '')
  if (!text) return ''
  try {
    const data = JSON.parse(text)
    const detail = data?.error?.message || data?.error || data?.message || data?.detail
    if (typeof detail === 'string' && detail.trim()) return detail.trim().slice(0, MAX_ERROR_CHARS)
  } catch {}
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CHARS)
}

// Responses 接口把系统提示放在 instructions，并要求每轮携带完整输入。
function responsesPayload(snapshot, modelSettings, contextSettings) {
  const system = snapshot.messages.find(item => item.role === 'system')?.content || ''
  const input = snapshot.messages.filter(item => item.role !== 'system').map(item => {
    const images = item.images || []
    if (!images.length) return { role: item.role, content: item.content }
    const parts = [{ type: 'input_text', text: item.content }]
    for (const image of images) parts.push({ type: 'input_image', image_url: image.dataUrl })
    return { role: item.role, content: parts }
  })
  return {
    model: modelSettings.model,
    instructions: system,
    input,
    temperature: contextSettings.temperature,
    max_output_tokens: contextSettings.maxTokens,
  }
}

function chatPayload(snapshot, modelSettings, contextSettings) {
  const messages = snapshot.messages.map(item => {
    const images = item.images || []
    if (!images.length) return { role: item.role, content: item.content }
    return { role: item.role, content: [
      { type: 'text', text: item.content },
      ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ] }
  })
  return { model: modelSettings.model, messages, temperature: contextSettings.temperature, max_tokens: contextSettings.maxTokens }
}

async function* sseEvents(response) {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (payload) yield payload
      }
    }
    const tail = buffer.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
    if (tail) yield tail
  } finally { reader.releaseLock() }
}

export default async function (ctx, _config, runtime) {
  const root = runtime.dataDir
  const sessionsDir = join(root, 'sessions')
  const projectFile = join(root, 'project.json')
  const settingsFile = join(root, 'settings-private.json')
  await mkdir(sessionsDir, { recursive: true })

  let project, settings, settingsRevision = 0
  const sessions = new Map()
  let writeQueue = Promise.resolve()
  const enqueue = task => {
    const run = writeQueue.then(task)
    writeQueue = run.catch(() => {})
    return run
  }
  const sessionLocks = new Map()
  const withSessionLock = (id, task) => {
    const previous = sessionLocks.get(id) || Promise.resolve()
    const current = previous.catch(() => {}).then(task)
    sessionLocks.set(id, current)
    current.finally(() => { if (sessionLocks.get(id) === current) sessionLocks.delete(id) }).catch(() => {})
    return current
  }
  const saveSession = async next => {
    validateSession(next)
    await runtime.writeSnapshot(join(sessionsDir, next.id + '.json'), JSON.stringify(next))
    sessions.set(next.id, structuredClone(next))
    return structuredClone(next)
  }
  const getSession = id => {
    if (!idOK(id)) fail(404, '会话不存在')
    const session = sessions.get(id)
    if (!session) fail(404, '会话不存在')
    return session
  }
  const sessionSummary = session => ({ id: session.id, revision: session.revision, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length })

  try {
    const stored = await readFile(projectFile, 'utf8')
    const previous = JSON.parse(stored)
    project = normalizeProject(previous)
    if (previous.schemaVersion !== project.schemaVersion) await runtime.writeSnapshot(projectFile, JSON.stringify(project))
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('角色扮演作品无法读取；原文件已保留，请检查作品数据')
    project = demoProject()
    await runtime.writeSnapshot(projectFile, JSON.stringify(project))
  }
  try {
    settings = normalizeSettings(JSON.parse(await readFile(settingsFile, 'utf8')))
  } catch (error) {
    if (error.code !== 'ENOENT') throw Error('模型私有设置无法读取；原文件已保留，请检查设置文件')
    settings = { ...DEFAULT_SETTINGS }
    await runtime.writeSnapshot(settingsFile, JSON.stringify(settings))
  }
  for (const name of await readdir(sessionsDir)) {
    if (!/^[a-z0-9-]{1,80}\.json$/i.test(name)) continue
    let session, previous
    try { previous = JSON.parse(await readFile(join(sessionsDir, name), 'utf8')); session = normalizeSession(previous, project) }
    catch { throw Error('会话数据无法读取；原文件已保留，请检查会话文件：' + name) }
    if (name !== session.id + '.json' || sessions.has(session.id)) throw Error('会话文件标识无效：' + name)
    // 固定迁移时的身份和开场，避免下次启动时被新故事的默认设定覆盖。
    if (previous.player === undefined || previous.opening === undefined || previous.memory === undefined) await runtime.writeSnapshot(join(sessionsDir, name), JSON.stringify(session))
    sessions.set(session.id, structuredClone(session))
  }
  if (sessions.size > LIMITS.sessions) throw Error('会话数量超过支持上限')

  const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
  route('GET', /^\/api\/roleplay\/project$/, () => structuredClone(project))
  route('PUT', /^\/api\/roleplay\/project$/, async ({ req }) => enqueue(async () => {
    const next = validateProject(unwrap(await ctx.http.body(req), 'project'))
    if (next.id !== project.id) fail(400, '角色扮演作品标识不能更改')
    if (next.revision !== project.revision) fail(409, '作品已在其他页面修改，请重新载入')
    const saved = { ...structuredClone(next), revision: project.revision + 1 }
    await runtime.writeSnapshot(projectFile, JSON.stringify(saved))
    project = saved
    return structuredClone(project)
  }))

  route('GET', /^\/api\/roleplay\/sessions$/, () => [...sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(sessionSummary))
  route('POST', /^\/api\/roleplay\/sessions$/, async ({ req }) => enqueue(async () => {
    const input = await ctx.http.body(req)
    exactKeys(input, [], ['title', 'messages', 'sourceSessionId', 'player', 'opening'])
    if (sessions.size >= LIMITS.sessions) fail(400, '最多创建 200 个会话')
    let messages
    if ('messages' in input) messages = structuredClone(validateMessages(input.messages))
    else messages = project.character.greeting.trim() ? [message('assistant', project.character.greeting)] : []
    const now = isoNow()
    const title = input.title === undefined ? ('messages' in input ? '新分支' : '新对话') : input.title
    const source = input.sourceSessionId ? getSession(input.sourceSessionId) : null
    const session = validateSession({ id: randomUUID(), revision: 0, title, createdAt: now, updatedAt: now, messages,
      player: structuredClone(input.player ? validatePlayer(input.player) : source?.player || project.player),
      opening: structuredClone(input.opening ? validateOpening(input.opening) : source?.opening || project.opening),
      // 从较早消息分支时清空后来的剧情记忆，避免未来事件泄漏到过去。
      memory: structuredClone(source && JSON.stringify(messages) === JSON.stringify(source.messages) ? source.memory : emptyMemory()) })
    return saveSession(session)
  }))
  route('GET', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})$/i, ({ match }) => structuredClone(getSession(match[1])))
  route('PUT', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})$/i, async ({ match, req }) => enqueue(async () => {
    const current = getSession(match[1])
    const input = validateSession(unwrap(await ctx.http.body(req), 'session'))
    const next = normalizeSession({ ...current, ...input }, project)
    if (next.id !== current.id || next.createdAt !== current.createdAt) fail(400, '会话标识或创建时间不能更改')
    if (next.revision !== current.revision) fail(409, '会话已在其他页面修改，请重新载入')
    return saveSession({ ...structuredClone(next), revision: current.revision + 1, updatedAt: isoNow() })
  }))

  route('PUT', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})\/state$/i, async ({ match, req }) => enqueue(async () => {
    const input = await ctx.http.body(req)
    exactKeys(input, ['revision'], ['player', 'memory'])
    const current = getSession(match[1])
    if (input.revision !== current.revision) fail(409, '会话已变化，请重新打开后编辑')
    if (input.player !== undefined) validatePlayer(input.player)
    if (input.memory !== undefined) validateMemory(input.memory)
    return saveSession({ ...current, ...(input.player !== undefined ? { player: structuredClone(input.player) } : {}), ...(input.memory !== undefined ? { memory: structuredClone(input.memory) } : {}), revision: current.revision + 1, updatedAt: isoNow() })
  }))

  route('GET', /^\/api\/roleplay\/settings$/, () => publicSettings(settings))
  route('PUT', /^\/api\/roleplay\/settings$/, async ({ req }) => enqueue(async () => {
    const input = await ctx.http.body(req)
    exactKeys(input, ['baseUrl', 'model'], ['protocol', 'apiKey', 'clearApiKey', 'reasoningEffort', 'timeoutSeconds', 'stream'])
    if (input.clearApiKey !== undefined && typeof input.clearApiKey !== 'boolean') fail(400, 'clearApiKey 必须是布尔值')
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /[\r\n]/.test(input.apiKey))) fail(400, 'API Key 无效')
    if (input.clearApiKey && input.apiKey?.trim()) fail(400, '不能同时设置和清除 API Key')
    const key = input.clearApiKey ? '' : input.apiKey?.trim() || settings.apiKey
    const next = validateSettings({ schemaVersion: 3, protocol: input.protocol === undefined ? settings.protocol : input.protocol, baseUrl: input.baseUrl, model: input.model, apiKey: key,
      reasoningEffort: input.reasoningEffort === undefined ? settings.reasoningEffort : input.reasoningEffort,
      timeoutSeconds: input.timeoutSeconds === undefined ? settings.timeoutSeconds : input.timeoutSeconds,
      stream: input.stream === undefined ? settings.stream : input.stream })
    await runtime.writeSnapshot(settingsFile, JSON.stringify(next))
    settings = next; settingsRevision++
    return publicSettings(settings)
  }))

  route('POST', /^\/api\/roleplay\/context-preview$/, async ({ req }) => {
    const input = await ctx.http.body(req)
    exactKeys(input, [], ['sessionId', 'messages'])
    if (('sessionId' in input) === ('messages' in input)) fail(400, '请提供 sessionId 或 messages 其中一项')
    const history = 'sessionId' in input ? getSession(input.sessionId).messages : validateMessages(input.messages)
    const composed = composeContext(project, history, input.sessionId ? getSession(input.sessionId) : {})
    // 预览只展示文字，避免把整张图片的 base64 送到浏览器对话框里。
    const messages = composed.messages.map(({ role, content, images }) => ({ role, content, ...(images?.length ? { imageCount: images.length } : {}) }))
    return { messages, activeWorldInfoIds: composed.activeWorldInfoIds }
  })

  const callModel = async (snapshot, modelSettings, contextSettings) => {
    if (!modelSettings.apiKey) fail(400, '请先在模型设置中填写 API Key')
    const endpoint = modelSettings.baseUrl.replace(/\/+$/, '') + PROTOCOLS[modelSettings.protocol]
    const payload = modelSettings.protocol === 'responses'
      ? responsesPayload(snapshot, modelSettings, contextSettings)
      : chatPayload(snapshot, modelSettings, contextSettings)
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + modelSettings.apiKey },
        body: JSON.stringify({ ...payload, ...reasoningFields(modelSettings) }),
        signal: AbortSignal.timeout(modelSettings.timeoutSeconds * 1000),
      })
    } catch (error) {
      fail(502, '无法连接模型服务，请检查接口地址、网络或系统代理' + (error?.name === 'TimeoutError' ? '（请求超时）' : ''))
    }
    if (!response.ok) {
      const detail = await providerError(response)
      if (response.status === 401 || response.status === 403) fail(502, '模型服务拒绝了请求，请检查 API Key' + (detail ? '：' + detail : ''))
      if (response.status === 404) fail(502, '模型或接口不存在，请检查模型名称与 API 地址' + (detail ? '：' + detail : ''))
      if (response.status === 429) fail(502, '模型服务暂时繁忙或额度不足，请稍后检查服务状态' + (detail ? '：' + detail : ''))
      fail(502, '模型服务请求失败（HTTP ' + response.status + '）' + (detail ? '：' + detail : ''))
    }
    let data
    try { data = JSON.parse(await responseText(response)) } catch (error) {
      if (error.status) throw error
      fail(502, '模型服务返回了无法识别的内容')
    }
    const content = responseContent(data)
    if (!content) {
      if (data?.incomplete_details?.reason === 'max_output_tokens') fail(502, '模型在思考阶段用尽了回复长度上限，还没有写出正文。请在“上下文设置”里调高“回复长度上限”后重试')
      const kinds = Array.isArray(data?.output) ? data.output.map(item => item?.type).filter(Boolean).join('、') : ''
      fail(502, '模型服务没有返回有效回复' + (kinds ? '（输出类型：' + kinds + '）' : ''))
    }
    if (content.length > LIMITS.messageChars) fail(502, '模型回复超过单条消息长度限制')
    return content
  }

  route('POST', /^\/api\/roleplay\/settings\/test$/, async ({ req }) => {
    exactKeys(await ctx.http.body(req), [])
    if (!settings.apiKey) fail(400, '请先填写并保存 API Key')
    const snapshot = { messages: [
      { role: 'system', content: '你正在接受接口连通性检查。' },
      { role: 'user', content: '请只回复四个字：连接成功' },
    ] }
    const reply = await callModel(snapshot, { ...settings }, { temperature: 0, maxTokens: 64 })
    return { ok: true, protocol: settings.protocol, model: settings.model, reply }
  })

  const jsonReply = text => {
    try { return JSON.parse(text.trim().replace(/^(?:\x60){3}(?:json)?\s*/i, '').replace(/\s*(?:\x60){3}$/, '')) }
    catch { fail(502, '模型没有返回有效的结构化内容，请重试') }
  }

  // 辅助生成只返回候选结果，不写消息，也不自动覆盖已确认的记忆。
  route('POST', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})\/(suggestions|memory-draft)$/i, async ({ match, req }) => {
    exactKeys(await ctx.http.body(req), [])
    const current = structuredClone(getSession(match[1]))
    const projectSnapshot = structuredClone(project), modelSnapshot = { ...settings }, configRevision = settingsRevision
    const composed = composeContext(projectSnapshot, current.messages, current)
    const isMemory = match[2] === 'memory-draft'
    const instruction = isMemory
      ? '整理已发生的对话与现有记忆，仅输出 JSON：{"summary":"共同经历摘要","scene":"当前地点与情境","relationship":"当前关系","facts":["重要事实或约定"]}。只记录明确发生或确认的信息，不臆测。summary 最多1500字，scene/relationship各最多800字，facts最多20条、每条最多300字。保留已确认的重要约定。'
      : '暂时作为玩家的写作助手，给出3种不同方向的下一步玩家回复或行动（例如好奇、坦诚、探索）。仅输出 JSON：{"suggestions":["回复或动作1","回复或动作2","回复或动作3"]}。每条最多160字，可直接放入输入框。不要替NPC回答，不改变已发生的事实。'
    const result = jsonReply(await callModel({ messages: [...composed.messages, { role: 'user', content: instruction }] }, modelSnapshot, { ...projectSnapshot.context, maxTokens: Math.max(2048, projectSnapshot.context.maxTokens) }))
    if (getSession(current.id).revision !== current.revision || project.revision !== projectSnapshot.revision || configRevision !== settingsRevision) fail(409, '设定或对话已变化，请重新生成')
    if (isMemory) {
      if (!object(result) || !Array.isArray(result.facts) || result.facts.length > 20 || result.facts.some(fact => typeof fact !== 'string')) fail(502, '模型返回的记忆格式无效，请重试')
      const memory = { summary: result.summary, scene: result.scene, relationship: result.relationship, facts: result.facts.map(content => ({ id: randomUUID(), content, enabled: true })) }
      try { validateMemory(memory) } catch { fail(502, '模型返回的记忆内容无效，请重试') }
      return { revision: current.revision, memory }
    }
    if (!Array.isArray(result?.suggestions) || result.suggestions.length !== 3 || result.suggestions.some(text => typeof text !== 'string' || !text.trim() || text.length > 500)) fail(502, '模型返回的建议格式无效，请重试')
    return { revision: current.revision, suggestions: result.suggestions.map(text => text.trim()) }
  })

  route('POST', /^\/api\/roleplay\/playtest$/, async ({ req }) => {
    const input = await ctx.http.body(req)
    exactKeys(input, ['project', 'messages', 'message'])
    const draft = validateProject(input.project)
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > LIMITS.messageChars) fail(400, '请输入有效的试聊消息')
    const history = [...validateMessages(input.messages), message('user', input.message)]
    const text = await callModel(composeContext(draft, history), { ...settings }, draft.context)
    const messages = [...history, message('assistant', text)]
    validateMessages(messages)
    return { messages }
  })

  const streamModel = async (snapshot, modelSettings, contextSettings, onDelta, signal) => {
    if (!modelSettings.apiKey) fail(400, '请先在模型设置中填写 API Key')
    const endpoint = modelSettings.baseUrl.replace(/\/+$/, '') + PROTOCOLS[modelSettings.protocol]
    const base = modelSettings.protocol === 'responses'
      ? responsesPayload(snapshot, modelSettings, contextSettings)
      : chatPayload(snapshot, modelSettings, contextSettings)
    let response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + modelSettings.apiKey, Accept: 'text/event-stream' },
        body: JSON.stringify({ ...base, ...reasoningFields(modelSettings), stream: true }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(modelSettings.timeoutSeconds * 1000)]) : AbortSignal.timeout(modelSettings.timeoutSeconds * 1000),
      })
    } catch (error) {
      if (signal?.aborted) fail(499, '生成已停止')
      fail(502, '无法连接模型服务，请检查接口地址、网络或系统代理' + (error?.name === 'TimeoutError' ? '（请求超时）' : ''))
    }
    if (!response.ok) {
      const detail = await providerError(response)
      if (response.status === 401 || response.status === 403) fail(502, '模型服务拒绝了请求，请检查 API Key' + (detail ? '：' + detail : ''))
      if (response.status === 404) fail(502, '模型或接口不存在，请检查模型名称与 API 地址' + (detail ? '：' + detail : ''))
      if (response.status === 429) fail(502, '模型服务暂时繁忙或额度不足，请稍后检查服务状态' + (detail ? '：' + detail : ''))
      fail(502, '模型服务请求失败（HTTP ' + response.status + '）' + (detail ? '：' + detail : ''))
    }
    // 少数兼容服务会忽略 stream 参数并直接返回完整 JSON，这里兼容该情况。
    if (!(response.headers.get('content-type') || '').includes('text/event-stream')) {
      let data
      try { data = JSON.parse(await responseText(response)) } catch (error) { if (error.status) throw error; fail(502, '模型服务返回了无法识别的内容') }
      const text = responseContent(data)
      if (!text) fail(502, '模型服务没有返回有效回复')
      onDelta(text)
      return text
    }
    let content = '', completed = false
    for await (const payload of sseEvents(response)) {
      if (payload === '[DONE]') {
        if (modelSettings.protocol === 'chat') completed = true
        break
      }
      let event
      try { event = JSON.parse(payload) } catch { continue }
      if (event?.type === 'error' || event?.type === 'response.failed' || event?.type === 'response.incomplete') {
        const detail = event.error?.message || event.response?.error?.message || event.message || '模型生成失败'
        fail(502, String(detail).slice(0, MAX_ERROR_CHARS))
      }
      if (modelSettings.protocol === 'responses' && event?.type === 'response.completed') {
        if (event.response?.status !== 'completed') fail(502, '模型服务未完成生成')
        completed = true
      }
      const delta = event?.type === 'response.output_text.delta' ? event.delta : event?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) { content += delta; onDelta(delta) }
    }
    if (signal?.aborted) fail(499, '生成已停止')
    if (!completed) fail(502, '模型服务提前结束，回复未完成')
    content = content.trim()
    if (!content) fail(502, '模型服务没有返回有效回复')
    if (content.length > LIMITS.messageChars) fail(502, '模型回复超过单条消息长度限制')
    return content
  }

  const buildGeneration = (id, mode, input) => {
    if (mode === 'reply') {
      if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > LIMITS.messageChars) fail(400, '请输入不超过 12000 字的消息')
      if (input.images !== undefined) validateImages(input.images)
    }
    const current = structuredClone(getSession(id))
    const projectAtStart = structuredClone(project)
    const settingsAtStart = { ...settings }
    const settingsRevisionAtStart = settingsRevision
    let history
    if (mode === 'reply') history = [...current.messages, message('user', input.message, input.images)]
    else {
      const lastIndex = current.messages.length - 1
      if (lastIndex <= 0 || current.messages[lastIndex].role !== 'assistant' || !current.messages.slice(0, lastIndex).some(item => item.role === 'user')) fail(400, '当前会话没有可重新生成的 NPC 回复')
      history = current.messages.slice(0, lastIndex)
    }
    validateMessages(history)
    return { current, projectAtStart, settingsAtStart, settingsRevisionAtStart, history, composed: composeContext(projectAtStart, history, current) }
  }

  const finalizeGeneration = (id, generation, content, signal) => {
    const { current, projectAtStart, settingsRevisionAtStart, history } = generation
    const next = { ...current, revision: current.revision + 1, updatedAt: isoNow(), messages: [...history, message('assistant', content)] }
    return enqueue(async () => {
      if (signal?.aborted) fail(499, '生成已停止')
      const latest = getSession(id)
      if (latest.revision !== current.revision || project.revision !== projectAtStart.revision || settingsRevision !== settingsRevisionAtStart) fail(409, '作品、会话或模型设置已变化，请重新载入后再试')
      return saveSession(next)
    })
  }

  const runChat = (id, mode, rawBody) => withSessionLock(id, async () => {
    if (mode === 'reply') exactKeys(rawBody, ['message'], ['images'])
    else exactKeys(rawBody, [])
    const generation = buildGeneration(id, mode, rawBody)
    const content = await callModel(generation.composed, generation.settingsAtStart, generation.projectAtStart.context)
    return finalizeGeneration(id, generation, content)
  })
  route('POST', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})\/reply$/i, async ({ match, req }) => runChat(match[1], 'reply', await ctx.http.body(req)))
  route('POST', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})\/regenerate$/i, async ({ match, req }) => runChat(match[1], 'regenerate', await ctx.http.body(req)))

  // 流式生成：先写 SSE 头，再逐段推送文本；只有完整成功才保存会话。
  route('POST', /^\/api\/roleplay\/sessions\/([a-z0-9-]{1,80})\/stream$/i, async ({ match, req, res }) => {
    const input = await ctx.http.body(req)
    exactKeys(input, ['mode'], ['message', 'images'])
    if (!['reply', 'regenerate'].includes(input.mode)) fail(400, '生成模式无效')
    if (input.mode === 'regenerate' && ('message' in input || 'images' in input)) fail(400, '重新生成不能附带新消息')
    const id = match[1]
    getSession(id)
    if (!settings.apiKey) fail(400, '请先在模型设置中填写 API Key')

    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.flushHeaders?.()
    const send = payload => { if (!res.writableEnded && !res.destroyed) res.write('data: ' + JSON.stringify(payload) + '\n\n') }
    const controller = new AbortController()
    const onClose = () => controller.abort()
    res.on('close', onClose)
    if (res.destroyed) onClose()
    try {
      const saved = await withSessionLock(id, async () => {
        const generation = buildGeneration(id, input.mode, input)
        const content = await streamModel(generation.composed, generation.settingsAtStart, generation.projectAtStart.context,
          delta => send({ type: 'delta', text: delta }), controller.signal)
        return finalizeGeneration(id, generation, content, controller.signal)
      })
      send({ type: 'done', session: saved })
    } catch (error) {
      send({ type: 'error', message: error.message })
    } finally { res.off('close', onClose); if (!res.destroyed) res.end() }
  })

  ctx.effect(() => async () => { await Promise.allSettled([...sessionLocks.values(), writeQueue]) })
}
