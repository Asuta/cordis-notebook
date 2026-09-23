import { Context } from 'cordis'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, extname, sep } from 'node:path'
import { Http, body, fail } from './http.js'
import { Plugins } from './plugins.js'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
export async function createApp({ port = 3210, file = resolve(rootDir, 'data/notes.json'), dataDir = dirname(file) } = {}) {
  const ctx = new Context()
  try {
    await ctx.plugin(Http, { port }); await ctx.http.ready
    await ctx.plugin(Plugins, { file, dataDir }); const manager = ctx.plugins
    const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
    route('GET', /^\/api\/plugins$/, () => manager.serialize())
    route('POST', /^\/api\/plugins\/install$/, async ({ req }) => { const input = await body(req); return manager.install(input.package, input.trust) })
    route('POST', /^\/api\/plugins\/([a-z0-9-]+)\/toggle$/, async ({ req, match }) => manager.toggle(match[1], (await body(req)).enabled))
    route('DELETE', /^\/api\/plugins\/([a-z0-9-]+)$/, ({ match }) => manager.uninstall(match[1]))
    route('POST', /^\/api\/plugins\/([a-z0-9-]+)\/clear-data$/, async ({ req, match }) => manager.clearData(match[1], (await body(req)).confirmation))
    route('POST', /^\/api\/plugins\/([a-z0-9-]+)\/rpc$/, async ({ req, match }) => {
      const record = manager.records.get(match[1]); if (record?.state !== 'enabled' || !record.remote) throw fail(409, '插件后端未运行')
      const { method, args } = await body(req); if (typeof method !== 'string') throw fail(400, '方法名无效'); return record.remote.call(method, args)
    })
    route('GET', /^\/api\/events$/, ({ req, res }) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: plugins\ndata: connected\n\n')
      ctx.http.clients.add(res); const timer = setInterval(() => res.write(': keepalive\n\n'), 20000)
      req.on('close', () => { ctx.http.clients.delete(res); clearInterval(timer) })
    })
    const serve = async (res, path) => {
      const content = await readFile(path).catch(() => { throw fail(404, '资源不存在') })
      res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[extname(path)] || 'text/plain') + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(content)
    }
    route('GET', /^\/$/, ({ res }) => serve(res, resolve(rootDir, 'public/index.html')))
    route('GET', /^\/(runtime\.js|style\.css)$/, ({ res, match }) => serve(res, resolve(rootDir, 'public', match[1])))
    route('GET', /^\/builtin\/([a-z-]+\.(?:js|css))$/, ({ res, match }) => serve(res, resolve(rootDir, 'client/plugins', match[1])))
    route('GET', /^\/plugins\/([a-z0-9-]+)\/([a-zA-Z0-9_./-]+)$/, ({ res, match }) => {
      const record = manager.records.get(match[1]); if (!record || record.state !== 'enabled' || !record.root) throw fail(404, '插件没有启用')
      if (match[2].split('/').some(part => part === '..' || part.startsWith('.'))) throw fail(400, '路径无效')
      const target = resolve(record.root, match[2]); if (!target.startsWith(record.root + sep)) throw fail(400, '路径无效')
      return serve(res, target)
    })
    await manager.init()
    return { ctx, server: ctx.http.server, manager, async close() { await manager.close(); await ctx.fiber.dispose() } }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApp({ port: Number(process.env.PORT || 3210) })
  console.log(`Cordis Notebook: http://127.0.0.1:${app.server.address().port}`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0) })
}
