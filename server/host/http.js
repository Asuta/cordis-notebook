import { Service } from 'cordis'
import { createServer } from 'node:http'

export const fail = (status, message) => Object.assign(new Error(message), { status })
export async function body(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) throw fail(413, '请求不能超过 2 MB'); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { throw fail(400, 'JSON 格式错误') }
}
export class Http extends Service {
  constructor(ctx, { port }) {
    super(ctx, 'http'); this.routes = []; this.clients = new Set()
    this.server = createServer(async (req, res) => {
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
      try {
        const host = req.headers.host || ''
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) throw fail(403, '只允许本机访问')
        if (req.headers.origin && req.headers.origin !== `http://${host}`) throw fail(403, '不允许跨站访问')
        if (!['GET', 'HEAD'].includes(req.method) && req.headers['content-type'] !== 'application/json') throw fail(415, '需要 JSON 请求')
        const pathname = new URL(req.url, `http://${host}`).pathname
        const route = this.routes.find(route => route.method === req.method && route.pattern.test(pathname))
        if (!route && !this.fallback) throw fail(404, '功能未启用或路径不存在')
        const request = { req, res, pathname, match: route ? pathname.match(route.pattern) : null }
        const result = await (route ? route.handler(request) : this.fallback(request))
        if (!res.headersSent) send(200, result ?? { ok: true })
      } catch (error) { if (!error.status) console.error(error); if (!res.headersSent) send(error.status || 500, { error: error.message, ...(typeof error.code === 'string' ? { code: error.code } : {}) }); else res.end() }
    })
    this.ready = new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve) })
    ctx.effect(() => async () => {
      for (const client of this.clients) client.end()
      this.server.closeIdleConnections()
      await new Promise(resolve => this.server.close(resolve))
    })
  }
  body(req) { return body(req) }
  route(ctx, method, pattern, handler) {
    const entry = { method, pattern, handler }; this.routes.push(entry)
    ctx.effect(() => () => { this.routes = this.routes.filter(item => item !== entry) })
  }
  broadcast() { for (const client of this.clients) client.write('event: plugins\ndata: changed\n\n') }
}
