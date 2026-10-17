import { fetch, EnvHttpProxyAgent } from 'undici'
import { setTimeout as wait } from 'node:timers/promises'

async function readBytes(response, limit) {
  const chunks = []; let size = 0
  for await (const chunk of response.body || []) { size += chunk.length; if (size > limit) { await response.body?.cancel?.().catch(() => {}); throw Error('WaveSpeed 返回的文件超过本地大小限制') }; chunks.push(chunk) }
  return Buffer.concat(chunks)
}
const safeMessage = (value, key) => String(typeof value === 'string' ? value : '服务请求失败').replaceAll(key || '\u0000', '[已隐藏]').replace(/https?:\/\/[^\s"<>]+/g, '[链接]').slice(0, 600)
const terminal = message => Object.assign(Error(message), { terminal: true })
function mediaURL(value) {
  let url; try { url = new URL(value) } catch { throw Error('WaveSpeed 返回的素材地址无效') }
  if (!(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password) throw Error('WaveSpeed 素材地址需为 HTTPS')
  return url.href
}
export function outputURLs(outputs, fallbackKind) {
  const items = []
  function visit(value, kind = fallbackKind, depth = 0) {
    if (depth > 8 || items.length > 100) throw Error('WaveSpeed 输出结构过于复杂')
    if (typeof value === 'string') {
      if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) items.push({ data: value, kind: 'image' })
      else if (/^https?:\/\//i.test(value)) items.push({ url: mediaURL(value), kind })
      return
    }
    if (Array.isArray(value)) { value.forEach(item => visit(item, kind, depth + 1)); return }
    if (!value || typeof value !== 'object') return
    const hint = String(value.type || value.mime_type || value.content_type || '')
    if (/video/.test(hint)) kind = 'video'
    else if (/image/.test(hint)) kind = 'image'
    if (typeof value.url === 'string') { visit(value.url, kind, depth + 1); return }
    for (const key of ['images', 'image', 'image_url', 'videos', 'video', 'video_url', 'outputs']) if (value[key] !== undefined) visit(value[key], /^video/.test(key) ? 'video' : /^image/.test(key) ? 'image' : kind, depth + 1)
  }
  visit(outputs)
  if (!items.length || items.length > 100) throw Error('WaveSpeed 未返回可保存的图片或视频')
  return items
}
export function createWaveSpeed({ request = fetch, dispatcher = new EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1' }), pollInterval = 2000, sleep = (ms, signal) => wait(ms, undefined, { signal }) } = {}) {
  let closed = false
  async function api(config, method, path, body, signal, submission = false) {
    if (closed) throw Error('WaveSpeed 服务已停止')
    const timeout = AbortSignal.timeout(submission ? 60000 : 30000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try { response = await request(config.baseUrl + path, { method, headers: { Authorization: 'Bearer ' + config.apiKey, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), dispatcher, signal: combined, redirect: 'error' }) }
    catch (error) { if (signal?.aborted) throw error; throw Error('连接 WaveSpeed 失败，请检查网络或代理') }
    let payload
    try { payload = JSON.parse((await readBytes(response, 64 * 1024 * 1024)).toString()) } catch {
      const error = Error(response.ok ? 'WaveSpeed 响应无效，请稍后查询任务状态' : `WaveSpeed HTTP ${response.status} · 服务响应无效`)
      error.statusCode = response.status
      if (submission && [400, 401, 402, 403, 404, 413, 422, 429].includes(response.status)) error.terminal = true
      throw error
    }
    if (!response.ok || (payload.code && ![200, 201, 202].includes(payload.code))) {
      const code = !response.ok ? response.status : payload.code, error = Error(`WaveSpeed HTTP ${code} · ` + safeMessage(payload.message || payload.error, config.apiKey))
      if ([400, 401, 402, 403, 404, 413, 422, 429].includes(code)) error.terminal = submission
      error.statusCode = code; throw error
    }
    return payload.data
  }
  async function upload(config, bytes, ref, signal) {
    const extension = ref.kind === 'video' ? (bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3 ? 'webm' : 'mp4') : 'png', mime = ref.kind === 'video' ? 'video/' + extension : 'image/png'
    const ticket = await api(config, 'POST', '/api/v3/media/uploads', { filename: `reference.${extension}`, size: bytes.length, content_type: mime }, signal)
    if (!ticket?.upload?.url || !ticket.download_url) throw Error('WaveSpeed 上传凭证无效')
    const url = mediaURL(ticket.upload.url), download = mediaURL(ticket.download_url), headers = ticket.upload.headers || {}
    if (Object.values(headers).some(value => typeof value !== 'string' || value.includes(config.apiKey))) throw Error('上传凭证包含无效的请求头')
    // The upload URL is opaque. Only ticket headers are sent; never add the API key.
    const response = await request(url, { method: 'PUT', headers, body: bytes, dispatcher, signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]), redirect: 'error' })
    if (!response.ok) { await response.body?.cancel?.(); throw Error(`参考素材上传失败（HTTP ${response.status}）`) }
    await response.body?.cancel?.(); return download
  }
  async function download(outputs, kind, signal) {
    const results = []
    for (const item of outputURLs(outputs, kind)) {
      signal.throwIfAborted()
      if (item.data) { if (item.data.length > 28 * 1024 * 1024) throw Error('返回图片超过 20 MB'); results.push({ bytes: Buffer.from(item.data.split(',')[1], 'base64'), kind: 'image' }); continue }
      const response = await request(item.url, { dispatcher, signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]) })
      if (!response.ok) { await response.body?.cancel?.(); throw Error(`结果下载失败（HTTP ${response.status}），可恢复查询再次下载`) }
      const type = response.headers.get('content-type') || '', actualKind = type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'image' : item.kind
      const limit = (actualKind === 'video' ? 200 : 20) * 1024 * 1024, size = Number(response.headers.get('content-length'))
      if (size > limit) { await response.body?.cancel?.(); throw Error('生成结果超过本地大小限制') }
      results.push({ bytes: await readBytes(response, limit), kind: actualKind })
    }
    return results
  }
  async function poll(config, id, kind, signal) {
    let failures = 0
    for (;;) {
      signal.throwIfAborted()
      let data
      try { data = await api(config, 'GET', '/api/v3/predictions/' + encodeURIComponent(id) + '/result', undefined, signal); failures = 0 }
      catch (error) {
        if (signal.aborted) throw error
        if (++failures >= 5 || [401, 403, 404].includes(error.statusCode)) throw error
        await sleep(Math.min(30000, Math.max(2000, pollInterval) * 2 ** failures), signal); continue
      }
      if (!data || typeof data.status !== 'string') throw Error('WaveSpeed 任务状态格式无效')
      if (data.status === 'completed') return download(data.outputs, kind, signal)
      if (['failed', 'cancelled', 'timeout', 'deleted'].includes(data.status)) throw terminal('WaveSpeed 任务已结束（' + data.status + '） · ' + safeMessage(data.error || '未返回生成结果', config.apiKey))
      await sleep(Math.max(2000, pollInterval), signal)
    }
  }
  return {
    api, poll,
    async generate(config, model, input, prepared, buffers, signal, checkpoint, account) {
      await checkpoint({ phase: 'preparing', account }); signal.throwIfAborted()
      const urls = new Map(), uploaded = new Map()
      for (const [index, ref] of input.references.entries()) {
        let url = uploaded.get(ref.assetId)
        if (!url) { url = await upload(config, buffers[index], ref, signal); uploaded.set(ref.assetId, url) }
        urls.set(ref.key, url)
      }
      const body = prepared.fill(urls)
      signal.throwIfAborted(); await checkpoint({ phase: 'submitting', account }); signal.throwIfAborted()
      // Once POST begins, allow it to return its ID even if local polling is stopped.
      // A timeout here is uncertain and is never retried automatically.
      const result = await api(config, 'POST', model.path, body, undefined, true)
      if (!result?.id || !/^[a-zA-Z0-9_-]{1,200}$/.test(result.id)) throw Error('提交响应缺少任务 ID，请在 WaveSpeed 核对任务记录')
      await checkpoint({ phase: 'submitted', taskId: result.id, account })
      signal.throwIfAborted(); return poll(config, result.id, model.outputKind, signal)
    },
    async close() { closed = true; await dispatcher.close() },
  }
}
