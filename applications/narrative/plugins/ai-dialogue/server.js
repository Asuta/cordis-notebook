import { createSettingsStore, publicSettings } from './settings.js'
import { callProvider, DialogueError, exactKeys, fail, LIMITS, validateReply } from './provider.js'

export default async function (ctx, _config, runtime) {
  const settings = await createSettingsStore(runtime.dataDir)
  const active = new Set()
  let stopped = false
  ctx.effect(() => () => { stopped = true; for (const controller of active) controller.abort(); active.clear() })
  const body = async req => {
    const value = await ctx.http.body(req)
    if (Buffer.byteLength(JSON.stringify(value) ?? '') > LIMITS.requestBytes) fail(413, 'AI 请求内容过大')
    return value
  }
  const route = (method, endpoint, handler) => ctx.http.route(ctx, method, new RegExp('^/api/narrative/ai/' + endpoint + '$'), async request => {
    try {
      if (stopped) fail(503, 'AI 对话插件已停用')
      return await handler(request)
    } catch (error) {
      if (error instanceof DialogueError) throw error
      // A host parser or filesystem exception must not expose private data.
      fail(error?.status === 400 ? 400 : error?.status === 413 ? 413 : 500, error?.status === 400 ? 'AI 请求 JSON 无效' : error?.status === 413 ? 'AI 请求内容过大' : 'AI 请求处理失败，请稍后重试')
    }
  })
  const generate = async ({ req, res }, input, maxTokens) => {
    const controller = new AbortController()
    active.add(controller)
    const abort = () => controller.abort()
    const disconnected = () => { if (!res.writableEnded) abort() }
    req.once('aborted', abort)
    res.once('close', disconnected)
    if (req.aborted || res.destroyed || stopped) abort()
    try { return await callProvider(settings.snapshot(), input, { signal: controller.signal, maxTokens }) }
    finally { active.delete(controller); req.off('aborted', abort); res.off('close', disconnected) }
  }
  route('GET', 'settings', () => publicSettings(settings.snapshot()))
  route('PUT', 'settings', async ({ req }) => settings.update(await body(req)))
  route('POST', 'test', async request => {
    exactKeys(await body(request.req), [])
    const input = validateReply({ character: '连接检查', prompt: '这是接口连接检查。', messages: [{ role: 'user', content: '请简短回复：连接成功' }] })
    return { ok: true, reply: await generate(request, input, 128) }
  })
  route('POST', 'reply', async request => ({ reply: await generate(request, validateReply(await body(request.req))) }))
}
