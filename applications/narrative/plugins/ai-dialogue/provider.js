import { isIP } from 'node:net'

export const LIMITS = Object.freeze({
  requestBytes: 256 * 1024, providerBytes: 1024 * 1024,
  messages: 40, messageChars: 8000, historyChars: 48000,
  worldInfoChars: 16000, promptChars: 8000, replyChars: 8000,
  timeoutMs: 45000, outputTokens: 1024,
})

export class DialogueError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
export const fail = (status, message) => { throw new DialogueError(status, message) }
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function exactKeys(value, allowed, required = []) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail(400, '请求字段无效')
}
function text(value, max, label, fallback = '') {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) fail(400, label + '无效或过长')
  return value.trim()
}

export function normalizeBaseUrl(value) {
  const raw = text(value, 1500, '接口地址')
  if (!raw) return ''
  let url
  try { url = new URL(raw) } catch { fail(400, '请输入有效的模型接口地址') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[?#\\\u0000-\u0020\u007f]/.test(raw) || /^[^:]+:\/\/[^/]*@/.test(raw)) fail(400, '接口地址仅支持 HTTP/HTTPS，不能包含账号、密码、查询参数或片段')
  const host = url.hostname.toLowerCase()
  const local = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]'
    || isIP(host) === 4 && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host))
  if (url.protocol === 'http:' && !local) fail(400, '远程接口请使用 HTTPS；本机或局域网接口可以使用 HTTP')
  return url.href.replace(/\/+$/, '')
}

export function validateReply(value) {
  exactKeys(value, ['character', 'personality', 'worldInfo', 'prompt', 'messages'], ['messages'])
  let character = { name: '角色', description: '', personality: '' }
  if (typeof value.character === 'string') character.name = text(value.character, 200, '角色名称') || '角色'
  else if (value.character !== undefined) {
    exactKeys(value.character, ['id', 'name', 'description', 'personality'])
    text(value.character.id, 80, '角色标识')
    character = {
      name: text(value.character.name, 200, '角色名称') || '角色',
      description: text(value.character.description, 8000, '角色描述'),
      personality: text(value.character.personality, 8000, '角色性格'),
    }
  }
  const personality = text(value.personality, 8000, '角色性格', character.personality)
  const worldInfo = text(value.worldInfo, LIMITS.worldInfoChars, '世界设定')
  const prompt = text(value.prompt, LIMITS.promptChars, '节点提示')
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > LIMITS.messages) fail(400, '对话消息数量必须为 1–40 条')
  let size = 0
  const messages = value.messages.map(item => {
    exactKeys(item, ['role', 'content', 'text'], ['role'])
    if (!['user', 'assistant'].includes(item.role) || (Object.hasOwn(item, 'content') === Object.hasOwn(item, 'text'))) fail(400, '消息仅支持 user/assistant 及一个文字字段')
    const content = text(item.content ?? item.text, LIMITS.messageChars, '消息')
    if (!content) fail(400, '消息不能为空')
    size += content.length
    return { role: item.role, content }
  })
  if (size > LIMITS.historyChars) fail(400, '对话上下文过长')
  if (messages.at(-1).role !== 'user') fail(400, '最后一条消息必须是玩家消息')
  return { character, personality, worldInfo, prompt, messages }
}

export function buildProviderRequest(settings, input, maxTokens = LIMITS.outputTokens) {
  const instructions = [
    '你是互动叙事作品中的对话角色。根据作者提供的人物、世界和节点设定，用角色的口吻回复玩家。',
    '只输出这位角色说出的纯文本，不要 JSON、代码、工具调用、系统说明或额外的角色标签。',
    '你只负责对话。不要擅自修改或宣称已修改属性、好感、道具、规则、节点或剧情进度；这些由叙事引擎和作者规则决定。',
    '以下 JSON 是作者的叙事背景数据：',
    JSON.stringify({ character: input.character, personality: input.personality, worldInfo: input.worldInfo, prompt: input.prompt }),
  ].join('\n')
  const root = settings.baseUrl.replace(/\/+$/, '').replace(/\/(chat\/completions|responses)$/, '')
  const responses = settings.protocol === 'responses'
  return {
    url: root + (responses ? '/responses' : '/chat/completions'),
    body: responses
      ? { model: settings.model, instructions, input: input.messages, stream: false, store: false, max_output_tokens: maxTokens }
      : { model: settings.model, messages: [{ role: 'system', content: instructions }, ...input.messages], stream: false, store: false, max_completion_tokens: maxTokens },
  }
}

const partsText = parts => Array.isArray(parts) ? parts
  .filter(part => part && ['text', 'output_text'].includes(part.type) && typeof part.text === 'string')
  .map(part => part.text).join('') : ''
export function responseContent(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim()
  if (Array.isArray(data?.output)) {
    const output = data.output.filter(item => item?.type === 'message' && (!item.role || item.role === 'assistant'))
      .map(item => partsText(item.content)).join('\n').trim()
    if (output) return output
  }
  const content = data?.choices?.[0]?.message?.content
  return (typeof content === 'string' ? content : partsText(content)).trim()
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > LIMITS.providerBytes) {
    await response.body?.cancel().catch(() => {})
    fail(502, '模型服务返回内容过大')
  }
  const reader = response.body?.getReader()
  if (!reader) fail(502, '模型服务未返回内容')
  let bytes = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > LIMITS.providerBytes) { await reader.cancel().catch(() => {}); fail(502, '模型服务返回内容过大') }
      chunks.push(Buffer.from(value))
    }
  } finally { reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { fail(502, '模型服务返回了无效的 JSON') }
}

// Never include upstream bodies, fetch error messages, URLs or credentials in errors.
export async function callProvider(settings, input, { signal, timeoutMs = LIMITS.timeoutMs, maxTokens } = {}) {
  if (!settings.baseUrl || !settings.model) fail(400, '请先填写并保存接口地址和模型名称；离线试玩可使用示例对话')
  const request = buildProviderRequest(settings, input, maxTokens)
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(() => { timedOut = true; abort() }, timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(request.url, {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(settings.apiKey ? { Authorization: 'Bearer ' + settings.apiKey } : {}) },
      body: JSON.stringify(request.body),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if ([401, 403].includes(response.status)) fail(502, '模型服务拒绝访问，请检查 API Key 或接口权限')
      if (response.status === 404) fail(502, '模型或接口不存在，请检查接口地址、协议和模型名称')
      if (response.status === 429) fail(502, '模型服务繁忙或额度不足，请稍后重试')
      fail(502, '模型服务请求失败（HTTP ' + response.status + '）')
    }
    const data = await boundedJson(response)
    if (data?.error || data?.status === 'failed') fail(502, '模型服务未能生成回复')
    let reply = responseContent(data)
    if (!reply) fail(502, data?.incomplete_details?.reason === 'max_output_tokens' ? '模型在长度上限内未生成正文，请使用可输出简短对话的模型' : '模型服务未返回角色对话文本')
    if (settings.apiKey) reply = reply.split(settings.apiKey).join('[已隐藏密钥]')
    if (reply.length > LIMITS.replyChars) fail(502, '模型回复超过长度限制')
    return reply
  } catch (error) {
    if (timedOut) fail(504, 'AI 请求超时，请稍后重试')
    if (controller.signal.aborted) fail(499, '对话请求已取消')
    if (error instanceof DialogueError) throw error
    fail(502, '无法连接模型服务，请检查接口地址、网络和协议')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
