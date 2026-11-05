import { imageSize, models } from './config.js'

const undici = await import('undici').catch(() => ({}))
const fetchRequest = undici.fetch || globalThis.fetch
const MultipartFormData = undici.FormData || globalThis.FormData
const createDispatcher = () => undici.EnvHttpProxyAgent ? new undici.EnvHttpProxyAgent({ noProxy: process.env.NO_PROXY || process.env.no_proxy || 'localhost,127.0.0.1,::1' }) : undefined

const maxResponseBytes = 64 * 1024 * 1024
async function readBytes(response) {
  const chunks = []; let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > maxResponseBytes) throw Error('4dai 响应过大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
function safeError(value, key) {
  return String(value || '请求失败').replaceAll(key || '\0', '[已隐藏]').replace(/https?:\/\/[^\s"<>]+/g, '[链接]').slice(0, 500)
}
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw Error('参考素材不是支持的 PNG、JPEG 或 WebP 图片')
}
function imageResult(payload) {
  const image = payload?.data?.[0] || payload?.images?.[0] || payload?.choices?.[0]?.message?.images?.[0]
  const encoded = image?.b64_json || image?.base64
  if (encoded) return Buffer.from(encoded.replace(/^data:image\/[^;]+;base64,/i, ''), 'base64')
  const source = typeof image === 'string' ? image : image?.url || image?.image_url?.url
  if (source?.startsWith('data:image/')) return Buffer.from(source.slice(source.indexOf(',') + 1), 'base64')
  if (source) return source
  throw Error('4dai 没有返回图片数据')
}

export function create4dai({ request = fetchRequest, dispatcher = createDispatcher(), timeoutMs = 600000 } = {}) {
  return {
    async generate(input, config, images, signal) {
      if (!config.apiKey) throw Error('请先在 4dai 设置中配置 API Key')
      if (!models.some(item => item.id === config.model)) throw Error('请选择支持的 GPT Image 模型')
      if (images.length > 10) throw Error('4dai 每次最多使用 10 张参考图')
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      const automaticRatio = input.ratio === 'auto'
      const fields = { model: config.model, prompt: input.prompt, n: 1, quality: 'high', response_format: 'b64_json', ...(automaticRatio ? {} : { size: imageSize(input.ratio, input.resolution) }) }
      const headers = { Authorization: 'Bearer ' + config.apiKey }
      let endpoint, body
      if (images.length) {
        endpoint = '/v1/images/edits'
        body = new MultipartFormData()
        for (const [name, value] of Object.entries(fields)) body.set(name, String(value))
        images.forEach((bytes, index) => {
          const mime = imageMime(bytes), extension = mime.slice('image/'.length)
          body.append('image[]', new Blob([bytes], { type: mime }), 'reference-' + (index + 1) + '.' + extension)
        })
      } else {
        endpoint = '/v1/images/generations'
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(fields)
      }
      let stage = images.length ? '参考图编辑请求' : '文生图请求'
      try {
        const response = await request(config.baseUrl + endpoint, { method: 'POST', headers, body, signal: combined, dispatcher, redirect: 'error' })
        stage = '读取生成结果'
        const bytes = await readBytes(response)
        let payload
        try { payload = JSON.parse(bytes.toString()) } catch { throw Error('4dai 返回无效响应（HTTP ' + response.status + '）') }
        if (!response.ok) throw Error('4dai HTTP ' + response.status + '：' + safeError(payload?.error?.message || payload?.message, config.apiKey))
        const result = imageResult(payload)
        if (Buffer.isBuffer(result)) return result
        const url = new URL(result)
        if (url.protocol !== 'https:' || url.username || url.password) throw Error('4dai 返回了无效图片地址')
        stage = '下载生成图片'
        const download = await request(url, { signal: combined, dispatcher, redirect: 'error' })
        if (!download.ok) throw Error('图片下载失败（HTTP ' + download.status + '）')
        return await readBytes(download)
      } catch (error) {
        if (signal.aborted) throw Error('生成已中断')
        if (combined.aborted) throw Error('生成超时，请检查结果后手动重试')
        throw Error(stage + '失败：' + safeError(error.message, config.apiKey))
      }
    },
    close: () => dispatcher?.close(),
  }
}
