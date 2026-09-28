import { Context } from 'cordis'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, extname } from 'node:path'
import { Http, body, fail } from './host/http.js'
import { Applications } from './host/applications.js'
import { discoverApplications, defaultApplicationsDir } from './application-discovery.js'
import { defaultPluginsDir, containedFile } from './plugin-discovery.js'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
// Single-directory adapter for plugin development and existing isolated tests.
export function createApp({ port = 3210, file, dataDir = file ? dirname(file) : resolve(rootDir, 'data'), pluginsDir = defaultPluginsDir } = {}) {
  return createHost({ port, dataDir, file, standalone: { id: 'standalone', name: '插件应用', pluginsDir, default: true } })
}
export async function createHost({ port = 3210, dataDir = resolve(rootDir, 'data'), applicationsDir = defaultApplicationsDir, initialApplication, standalone, file } = {}) {
  const catalog = standalone ? [standalone] : await discoverApplications(applicationsDir)
  const ctx = new Context(); let applications
  try {
    await ctx.plugin(Http, { port }); await ctx.http.ready
    applications = new Applications(ctx.http, { applications: catalog, dataDir, standalone: !!standalone, file })
    const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
    const manage = handler => request => applications.withCurrent(request, runtime => handler(runtime.manager, request))
    route('GET', /^\/api\/applications$/, () => applications.describe())
    route('POST', /^\/api\/applications\/switch$/, async ({ req }) => { const input = await body(req); return applications.switch(input.id, input.session) })
    route('GET', /^\/api\/plugins$/, () => applications.snapshot())
    route('POST', /^\/api\/plugins\/([a-z0-9-]+)\/config$/, manage(async (manager, { req, match }) => { const input = await body(req); return manager.settings.begin(match[1], input.config, input.expectedRevision) }))
    route('POST', /^\/api\/plugins\/config\/confirm$/, manage(async (manager, { req }) => { const input = await body(req); return manager.settings.finish(input.token, input.success, input.error) }))
    route('POST', /^\/api\/plugins\/([a-z0-9-]+)\/toggle$/, manage(async (manager, { req, match }) => manager.toggle(match[1], (await body(req)).enabled)))
    route('POST', /^\/api\/plugins\/exclusive\/confirm$/, manage(async (manager, { req }) => { const input = await body(req); return manager.finishExclusive(input.token, input.success, input.error) }))
    route('GET', /^\/api\/events$/, ({ req, res }) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }); res.write('event: plugins\ndata: connected\n\n')
      const clients = ctx.http.clients
      clients.add(res); const timer = setInterval(() => res.write(': keepalive\n\n'), 20000)
      req.on('close', () => { clients.delete(res); clearInterval(timer) })
    })
    ctx.http.fallback = request => applications.dispatch(request)
    const serve = async (res, path) => {
      const content = await readFile(path).catch(() => { throw fail(404, '资源不存在') })
      res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }[extname(path)] || 'application/octet-stream'), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }); res.end(content)
    }
    route('GET', /^\/applications\/([a-z][a-z0-9-]+)\/icon$/, async ({ res, match }) => {
      const app = catalog.find(app => app.id === match[1])
      if (!app?.icon || app.error) throw fail(404, '应用图标不存在')
      return serve(res, await containedFile(app.root, app.icon))
    })
    route('GET', /^\/$/, ({ res }) => serve(res, resolve(rootDir, 'public/index.html')))
    route('GET', /^\/(runtime\.js|style\.css)$/, ({ res, match }) => serve(res, resolve(rootDir, 'public', match[1])))
    // Only explicitly public helpers/assets are served, never plugin server sources.
    route('GET', /^\/builtin\/([a-z][a-z0-9-]*)\/([a-zA-Z0-9_./-]+)$/, async ({ req, res, pathname, match }) => {
      applications.checkSession(req, pathname)
      const record = applications.current?.manager.records.get(match[1])
      if (!record || !record.clientAssets.includes(match[2])) throw fail(404, '资源不存在')
      const path = await containedFile(record.assetRoot, match[2]).catch(() => { throw fail(404, '资源不存在') })
      return serve(res, path)
    })
    await applications.init(initialApplication)
    return { applications, get ctx() { return applications.current?.ctx || ctx }, server: ctx.http.server, get manager() { return applications.current?.manager }, async close() { try { await applications.close() } finally { await ctx.fiber.dispose() } } }
  } catch (error) { await applications?.close(); await ctx.fiber.dispose(); throw error }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.env.PLUGINS_DIR
    ? await createApp({ port: Number(process.env.PORT || 3210), pluginsDir: process.env.PLUGINS_DIR, dataDir: process.env.DATA_DIR })
    : await createHost({ port: Number(process.env.PORT || 3210), applicationsDir: process.env.APPLICATIONS_DIR || defaultApplicationsDir, dataDir: process.env.DATA_DIR, initialApplication: process.env.APP })
  console.log(`Cordis Applications: http://127.0.0.1:${app.server.address().port}`)
  let closing = false
  const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0) }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, shutdown)
  process.on('message', message => { if (message?.type === 'workbench-shutdown') void shutdown() })
  if (process.connected) process.once('disconnect', shutdown)
}
