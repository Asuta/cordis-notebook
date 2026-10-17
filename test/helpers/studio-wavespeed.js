import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

export const row = (id, type, properties, required = [], extra = {}) => ({
  model_id: id, name: id.split('/').at(-1), type, description: '本机模拟模型，禁止付费请求', base_price: 0.02,
  api_schema: { api_schemas: [{ type: 'model_run', method: 'POST', api_path: '/api/v3/' + id,
    request_schema: { type: 'object', properties, required, additionalProperties: false } }] }, ...extra,
})
export const modelRows = [
  row('mock/image', 'text-to-image', {
    prompt: { type: 'string', minLength: 1 }, steps: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    size: { type: 'string', enum: ['1k', '2k'], default: '1k' }, seed: { type: 'integer', default: -1 },
    options: { type: 'object', properties: { strength: { type: 'number', minimum: 0, maximum: 1, default: 0.5 } }, additionalProperties: false },
    metadata: { type: 'object', additionalProperties: true }, enable_sync_mode: { type: 'boolean', default: true }, enable_base64_output: { type: 'boolean', default: true },
  }, ['prompt']),
  row('mock/edit', 'image-to-image', { prompt: { type: 'string' }, images: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', format: 'uri' } }, strength: { type: 'number', minimum: 0, maximum: 1, default: 0.4 } }, ['images']),
  row('mock/video', 'image-to-video', {
    prompt: { type: 'string' }, start_image: { type: 'string', format: 'uri' }, end_image: { type: 'string', format: 'uri' },
    duration: { type: 'integer', enum: [3, 5, 10], default: 3 }, seed: { type: 'integer', default: -1 },
  }, ['start_image']),
  row('mock/video-edit', 'video-to-video', { prompt: { type: 'string' }, video: { type: 'string', format: 'uri' } }, ['video']),
  row('mock/no-schema', 'text-to-image', {}, [], { api_schema: null }),
  row('mock/audio', 'text-to-audio', { prompt: { type: 'string' } }),
  row('mock/text', 'image-to-text', { image: { type: 'string' } }),
]
export const videoFixture = format => readFile(new URL('../fixtures/studio-media/sample.' + format, import.meta.url))
export const imageFixture = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#5778a2' } }).png().toBuffer()
export async function until(predicate, message = '等待任务超时', timeout = 7000) {
  const deadline = Date.now() + timeout
  while (!await predicate()) { if (Date.now() > deadline) throw Error(message); await new Promise(resolve => setTimeout(resolve, 15)) }
}

export async function createWaveMock() {
  const [png, mp4] = await Promise.all([imageFixture(), videoFixture('mp4')])
  const requests = [], uploads = new Map(), tasks = new Map(), errors = []
  const state = { complete: true, submissionStatus: 200, delaySubmission: false, releaseSubmit: null }
  let origin, nextUpload = 0, nextTask = 0
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk)
      const bytes = Buffer.concat(chunks), url = new URL(req.url, origin)
      const entry = { method: req.method, url: req.url, headers: req.headers, bytes }
      requests.push(entry)
      const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code: status, data })) }
      if (url.pathname.startsWith('/api/v3/')) {
        if (req.headers.authorization !== 'Bearer mock-key') throw Error('模拟 API 必须携带测试 Key')
        if (url.pathname === '/api/v3/models') return json(structuredClone(modelRows))
        if (url.pathname === '/api/v3/media/uploads') {
          const input = JSON.parse(bytes.toString()), id = String(++nextUpload)
          uploads.set(id, { input })
          return json({ upload: { url: origin + '/signed/upload/' + id + '?signature=a%2Fb&expires=123', headers: { 'Content-Type': input.content_type, 'X-Upload-Ticket': 'ticket-' + id } }, download_url: origin + '/media/' + id })
        }
        if (url.pathname.startsWith('/api/v3/predictions/')) {
          const id = url.pathname.split('/')[4], task = tasks.get(id)
          if (!task) return json(null, 404)
          await state.onPrediction?.(id)
          return json({ id, status: task.status || (state.complete ? 'completed' : 'processing'), outputs: task.kind === 'video' ? [origin + '/result/video.mp4'] : [origin + '/result/image.png'], error: task.error })
        }
        if (req.method === 'POST' && url.pathname.startsWith('/api/v3/mock/')) {
          if (state.submissionStatus !== 200) { res.writeHead(state.submissionStatus, { 'Content-Type': 'text/plain' }); return res.end('upstream rejected') }
          entry.body = JSON.parse(bytes.toString())
          const id = 'task-' + ++nextTask
          tasks.set(id, { kind: url.pathname.includes('video') ? 'video' : 'image' })
          if (state.delaySubmission) await new Promise(resolve => { state.releaseSubmit = resolve })
          return json({ id })
        }
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/signed/upload/')) {
        if (req.headers.authorization) throw Error('PUT 泄露了 API Key')
        const id = url.pathname.split('/').at(-1), upload = uploads.get(id)
        if (!upload || req.headers['x-upload-ticket'] !== 'ticket-' + id || req.url !== '/signed/upload/' + id + '?signature=a%2Fb&expires=123') throw Error('上传凭证或签名 URL 被修改')
        upload.bytes = bytes; res.writeHead(200); return res.end()
      }
      if (url.pathname.startsWith('/result/')) {
        if (req.headers.authorization) throw Error('结果下载泄露了 API Key')
        const video = url.pathname.endsWith('.mp4'), content = video ? mp4 : png
        res.writeHead(200, { 'Content-Type': video ? 'video/mp4' : 'image/png', 'Content-Length': content.length }); return res.end(content)
      }
      res.writeHead(404); res.end()
    } catch (error) { errors.push(error); res.writeHead(500); res.end('mock failure') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  return { server, origin, png, mp4, requests, uploads, tasks, state, errors, config: { baseUrl: origin, apiKey: 'mock-key' },
    async close() { state.releaseSubmit?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
