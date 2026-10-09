import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fetch, FormData, EnvHttpProxyAgent } from 'undici'
import { atomic } from './store.js'
import { invalid } from './model.js'
import { prepareReferences } from './references.js'

export function normalizeConfig(input) {
  let baseUrl = String(input.baseUrl || 'https://ai-pixel.online').replace(/\/$/, '').replace(/\/v1(?:\/images\/(?:generations|edits))?$/, '')
  const url = new URL(baseUrl)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) invalid('接口地址需为 HTTPS 服务地址')
  const model = input.model || 'gpt-image-2'
  if (typeof model !== 'string' || !/^[\w./:-]{1,100}$/.test(model)) invalid('图片模型名称无效')
  if (typeof input.apiKey !== 'string' || input.apiKey.length > 4096) invalid('API Key 无效')
  return { baseUrl, model, apiKey: input.apiKey.trim() }
}
export async function createConfig(directory, { env = process.env, configPath = join(homedir(), '.codex', 'config.toml') } = {}) {
  const file = join(directory, 'pixel-private.json')
  let value
  try { value = normalizeConfig(JSON.parse(await readFile(file, 'utf8'))) }
  catch (error) {
    if (error.code !== 'ENOENT') throw Error('图片服务私有配置无法读取，请检查 pixel-private.json；原文件已保留')
    const config = await readFile(configPath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '' })
    const section = config.match(/^\[skills\.ai-pixel-image2\.env\]\s*$([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] || ''
    const get = name => env[name] || section.match(new RegExp('^' + name + '\\s*=\\s*"([^"\\r\\n]*)"', 'm'))?.[1] || ''
    value = normalizeConfig({ baseUrl: get('AI_PIXEL_API_BASE_URL'), model: get('AI_PIXEL_IMAGE_MODEL'), apiKey: get('AI_PIXEL_API_KEY') })
    // Imported once, then independent of Codex or skill installation.
    await atomic(file, value)
  }
  let queue = Promise.resolve()
  return {
    private: () => ({ ...value }),
    public: () => ({ baseUrl: value.baseUrl, model: value.model, hasKey: !!value.apiKey }),
    save(input) {
      const task = queue.then(async () => {
        const next = normalizeConfig({ ...value, ...input, apiKey: input.apiKey?.trim() || value.apiKey })
        await atomic(file, next); value = next
        return { baseUrl: value.baseUrl, model: value.model, hasKey: !!value.apiKey }
      }); queue = task.catch(() => {}); return task
    },
  }
}
export function imageSize(ratio, resolution) {
  const long = { '1k': 1024, '2k': 2048, '4k': 4096 }[resolution], [w, h] = ratio.split(':').map(Number)
  return `${Math.round(long * w / Math.max(w, h) / 64) * 64}x${Math.round(long * h / Math.max(w, h) / 64) * 64}`
}
async function bytes(response, limit = 64 * 1024 * 1024) {
  const chunks = []; let length = 0
  for await (const chunk of response.body) { length += chunk.length; if (length > limit) throw Error('图片服务响应过大'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
function networkFailure(error, stage, apiKey) {
  const codes = new Set(), seen = new Set()
  const visit = cause => {
    if (!cause || typeof cause !== 'object' || seen.has(cause) || seen.size >= 12) return
    seen.add(cause)
    if (/^[A-Z][A-Z0-9_]{1,60}$/.test(cause.code || '')) codes.add(cause.code)
    visit(cause.cause)
    if (Array.isArray(cause.errors)) cause.errors.forEach(visit)
  }
  visit(error)
  const message = String(error.message).replaceAll(apiKey, '[已隐藏]').slice(0, 600)
  if (!codes.size && !['fetch failed', 'terminated'].includes(message)) return Error(message)
  const hints = {
    ENOTFOUND: '域名解析失败', EAI_AGAIN: '域名解析暂时失败',
    ECONNREFUSED: '连接被拒绝，请检查图片服务或代理是否可用',
    ECONNRESET: '连接被重置', EPIPE: '上传连接已断开', UND_ERR_SOCKET: '连接提前断开',
    ETIMEDOUT: '网络连接超时', UND_ERR_CONNECT_TIMEOUT: '连接图片服务或代理超时',
    UND_ERR_HEADERS_TIMEOUT: '等待图片服务响应超时', UND_ERR_BODY_TIMEOUT: '读取图片响应超时',
    ERR_HTTP2_STREAM_ERROR: 'HTTP/2 数据流异常', UND_ERR_HTTP2_STREAM_ERROR: 'HTTP/2 数据流异常',
    UND_ERR_REQ_CONTENT_LENGTH_MISMATCH: '上传数据长度与声明不一致',
  }
  const reasons = [...new Set([...codes].map(code => hints[code]).filter(Boolean))]
  return Error(`${stage}失败${codes.size ? `（${[...codes].join('、')}）` : ''}：${reasons.join('；') || '网络传输未完成'}。请检查网络或代理后手动重试；不要连续重复提交。`)
}
export function createPixel({ request = fetch, dispatcher = new EnvHttpProxyAgent({ noProxy: ['localhost', '127.0.0.1', '::1', process.env.NO_PROXY || process.env.no_proxy || ''].join(',') }), timeoutMs = 600000 } = {}) {
  return {
    async generate(input, config, images, signal) {
      if (!config.apiKey) throw Error('请先在图片服务设置中配置 API Key')
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      const prompt = `请生成一张图片，不要只回复文字。图片比例 ${input.ratio}。\n${input.prompt}`
      const fields = { model: config.model, prompt, n: 1, size: imageSize(input.ratio, input.resolution), response_format: 'b64_json' }
      const headers = { Authorization: `Bearer ${config.apiKey}` }
      let body, endpoint
      if (images.length) {
        body = new FormData(); for (const [key, value] of Object.entries(fields)) body.set(key, String(value))
        const references = await prepareReferences(images)
        references.forEach(image => body.append('image[]', new Blob([image.bytes], { type: image.type }), image.name))
        endpoint = '/v1/images/edits'
      } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(fields); endpoint = '/v1/images/generations' }
      let stage = images.length ? '参考图生成请求' : '文生图请求'
      try {
        const response = await request(config.baseUrl + endpoint, { method: 'POST', headers, body, signal: combined, dispatcher })
        stage = '读取生成结果'
        const raw = await bytes(response)
        let payload; try { payload = JSON.parse(raw.toString()) } catch { throw Error(`图片服务返回无效响应（HTTP ${response.status}）`) }
        if (!response.ok) throw Error(`图片服务 HTTP ${response.status}：${String(payload?.error?.message || '请求失败').slice(0, 400)}`)
        const image = payload?.data?.[0] || payload?.images?.[0] || payload?.choices?.[0]?.message?.images?.[0]
        const encoded = image?.b64_json || image?.base64
        if (encoded) return Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/, ''), 'base64')
        const source = typeof image === 'string' ? image : image?.url || image?.image_url?.url
        if (source?.startsWith('data:image/')) return Buffer.from(source.split(',')[1], 'base64')
        if (source) {
          const url = new URL(source)
          if (url.protocol !== 'https:' || url.username || url.password) throw Error('图片服务返回了无效下载地址')
          stage = '下载生成图片'
          const download = await request(url, { signal: combined, dispatcher })
          if (!download.ok) throw Error(`图片下载失败（HTTP ${download.status}）`)
          return await bytes(download, 20 * 1024 * 1024)
        }
        throw Error('图片服务没有返回图片数据')
      } catch (error) {
        if (signal.aborted) throw Error('生成已中断')
        if (combined.aborted) throw Error('生成超时，请检查结果后手动重试')
        throw networkFailure(error, stage, config.apiKey)
      }
    },
    close: () => dispatcher.close(),
  }
}
