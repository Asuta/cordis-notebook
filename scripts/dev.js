import { createServer, normalizePath } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { fork } from 'node:child_process'
import { readFile, realpath, mkdir, writeFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { discoverApplications, defaultApplicationsDir } from '../server/application-discovery.js'
import { inside } from '../server/plugin-discovery.js'
import { buildPlugins } from './plugin-builder.js'
import { pluginSources } from './vite-build.js'
import { createDevelopmentSaveGuard } from './development-save-guard.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const urlFor = file => '/@fs/' + normalizePath(file)
const fileKey = file => normalizePath(resolve(file)).toLowerCase()

/** Vite owns the public port. Backend restarts never disconnect its HMR channel. */
export async function startDevelopment({ port = Number(process.env.PORT || 3210), dataDir = process.env.DATA_DIR || resolve(root, 'data'), applicationsDir = process.env.APPLICATIONS_DIR || defaultApplicationsDir, initialApplication = process.env.APP,
  cacheDir = process.env.CORDIS_VITE_CACHE_DIR || resolve(root, 'node_modules/.vite/cordis'), onEvent = () => {},
  session = process.env.CORDIS_DEV_SESSION || randomUUID(), saveTimeout = 15000 } = {}) {
  await mkdir(dataDir, { recursive: true })
  const entries = [], allowed = new Set(), backendSources = new Set()
  let catalog, plugins, backend, backendPort, backendProxy, version = Date.now(), closing = false, timer, queue = Promise.resolve(), working = 0, backendReloadPending = false
  // Development events let a supervising process (the Agent workbench) observe
  // updates, errors and page reloads without parsing console output.
  const emit = event => { try { onEvent(event) } catch {} }
  const register = file => allowed.add(fileKey(file))
  async function compile() {
    const nextCatalog = await discoverApplications(applicationsDir), nextEntries = [], nextPlugins = {}, nextBackend = new Set(), outputs = []
    const host = await build({ entryPoints: [resolve(root, 'server/server.js')], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, metafile: true, logLevel: 'silent' })
    Object.keys(host.metafile.inputs).forEach(file => nextBackend.add(fileKey(file)))
    for (const app of nextCatalog) {
      if (app.error) throw Error(`${app.id}: ${app.error}`)
      // Validate and compile all backends before stopping a live process.
      const found = await buildPlugins(app.pluginsDir, { backendOnly: true, stagedOutputs: outputs, onDependencies: files => files.forEach(file => nextBackend.add(fileKey(file))) })
      nextEntries.push(...found.map(entry => ({ ...entry, applicationId: app.id }))); nextPlugins[app.id] = {}
      for (const entry of found) {
        const source = output => entry.package.cordis.build.find(task => task.output === output)
        const client = entry.manifest.client && resolve(entry.sourceRoot, source(entry.manifest.client).input)
        const styles = Object.fromEntries(entry.manifest.styles.map(name => [name, urlFor(resolve(entry.sourceRoot, source(name).input)) + '?direct']))
        const assets = Object.fromEntries(entry.clientAssets.map(name => [name, resolve(entry.sourceRoot, source(name).input)]))
        nextPlugins[app.id][entry.manifest.id] = { client: client && urlFor(client), styles, assets }
      }
    }
    return { catalog: nextCatalog, entries: nextEntries, plugins: nextPlugins, sources: nextBackend, outputs }
  }
  function applyPlan(plan) {
    catalog = plan.catalog; plugins = plan.plugins; entries.splice(0, entries.length, ...plan.entries)
    backendSources.clear(); plan.sources.forEach(file => backendSources.add(file))
    allowed.clear()
    register(resolve(root, 'client/host/runtime.js')); register(resolve(root, 'public/style.css'))
    for (const app of Object.values(plugins)) for (const plugin of Object.values(app)) Object.values(plugin.assets).forEach(register)
  }
  async function publish(plan) {
    const previous = await Promise.all(plan.outputs.map(async file => ({ path: file.path, contents: await readFile(file.path).catch(() => null) })))
    const restore = async () => { for (const file of previous) file.contents === null ? await rm(file.path, { force: true }) : await writeFile(file.path, file.contents) }
    try { for (const file of plan.outputs) await writeFile(file.path, file.contents) }
    catch (error) { await restore(); throw error }
    return restore
  }
  const initial = await compile(); await publish(initial); applyPlan(initial)
  async function launch() {
    const child = fork(resolve(root, 'server/server.js'), [], { cwd: root, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, PORT: '0', DATA_DIR: resolve(dataDir), APPLICATIONS_DIR: resolve(applicationsDir), CORDIS_DEV: '1', ...(initialApplication ? { APP: initialApplication } : {}) } })
    backend = child
    await new Promise((accept, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('开发后端启动超时')) }, 30000)
      const finish = error => { clearTimeout(timeout); child.off('exit', exit); child.off('error', finish); child.off('message', ready); error ? reject(error) : accept() }
      const exit = code => finish(Error('开发后端退出：' + code))
      const ready = message => { if (message?.type === 'cordis-ready') { backendPort = message.port; finish() } }
      child.on('message', ready); child.once('error', finish); child.once('exit', exit)
    })
  }
  async function stopBackend() {
    const child = backend; backend = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise(resolve => {
      const timeout = setTimeout(() => child.kill(), 10000)
      child.once('exit', () => { clearTimeout(timeout); resolve() })
      if (child.connected) child.send({ type: 'workbench-shutdown' }); else child.kill()
    })
  }
  await launch()
  let vite, saveGuard
  const report = error => {
    if (error.code === 'DEVELOPMENT_SAVE_PENDING' || closing) return
    console.error(error)
    vite?.ws.send({ type: 'error', err: { message: error.message, stack: error.stack || '', plugin: 'cordis-development' } })
  }
  async function reloadBackend() {
    backendReloadPending = true
    const plan = await compile()
    const previous = { catalog, plugins, entries: [...entries], sources: new Set(backendSources) }
    let restore
    await saveGuard.run(async () => {
      restore = await publish(plan)
      applyPlan(plan)
      // Remove old module permissions and rebuild them from the current import graph.
      vite.environments.client.moduleGraph.invalidateAll()
      await stopBackend()
      try { await launch() }
      catch (error) {
        await restore(); applyPlan(previous)
        await launch().catch(recovery => { error.message += '\n后端尚未恢复，请修正源码：' + recovery.message })
        throw error
      }
      vite.ws.send('cordis:restart', {})
    }, () => schedule(resolve(root, 'server/server.js')))
    backendReloadPending = false
  }
  async function update(file) {
    if (closing) return
    const key = fileKey(file), local = normalizePath(relative(root, file))
    if (backendSources.has(key) || local.startsWith('server/') || file.endsWith('package.json') || local.startsWith('shared/')) {
      await reloadBackend(); return
    }
    if (local.startsWith('scripts/') || key === fileKey(resolve(root, 'pnpm-lock.yaml'))) {
      console.log('构建工具或依赖已修改，请重新运行 pnpm dev。'); return
    }
    // A newly created import may have been missing during the last compilation.
    // Rebuild its owning application plan so frontend and backend can recover.
    if (!allowed.has(key) && entries.some(entry => inside(entry.sourceRoot, resolve(file)))) {
      await reloadBackend(); return
    }
    if (!allowed.has(key) && local !== 'public/index.html') return
    if (local.startsWith('client/') || file.endsWith('.html')) {
      await saveGuard.run(async () => vite.ws.send('cordis:restart', {}), () => schedule(file))
      return
    }
    version = Math.max(Date.now(), version + 1)
    const graph = vite.environments.client.moduleGraph
    const affected = new Set(), visit = mod => {
      if (affected.has(mod)) return
      affected.add(mod); mod.importers.forEach(visit)
    }
    for (const mod of graph.getModulesByFile(normalizePath(file)) || []) visit(mod)
    const targets = {}
    for (const entry of entries.filter(entry => entry.manifest.client && [...affected].some(mod =>
      mod.file && fileKey(mod.file) === fileKey(resolve(entry.sourceRoot, entry.package.cordis.build.find(task => task.output === entry.manifest.client).input))
    ))) (targets[entry.applicationId] ||= []).push(entry.manifest.id)
    // Give every plugin source a new graph timestamp. React/dependencies retain one instance.
    const ownModule = mod => mod.file && entries.some(entry => inside(entry.sourceRoot, resolve(mod.file))) && !mod.file.includes('/node_modules/')
    const modules = [...graph.idToModuleMap.values()].filter(ownModule)
    for (const mod of modules) graph.invalidateModule(mod, new Set(), version, true)
    // Compilation errors leave active Cordis fibers in place.
    const pending = entries.filter(entry => targets[entry.applicationId]?.includes(entry.manifest.id)).flatMap(entry =>
      [...graph.getModulesByFile(normalizePath(resolve(entry.sourceRoot, entry.package.cordis.build.find(task => task.output === entry.manifest.client).input))) || []])
    const checked = new Set()
    for (const mod of pending) {
      if (checked.has(mod) || mod.file.endsWith('.css')) continue
      checked.add(mod)
      await vite.transformRequest(mod.url)
      // Import analysis can discover new relative modules after an entry edit.
      // Preflight those as well before releasing any active plugin.
      for (const imported of mod.importedModules) if (ownModule(imported) && !checked.has(imported)) pending.push(imported)
    }
    vite.ws.send('cordis:plugins', { version, targets })
  }
  const schedule = file => {
    if (closing) return
    changes.add(file)
    if (!timer && working++ === 0) emit({ type: 'busy' })
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const batch = [...changes]; changes.clear()
      queue = queue.then(async () => {
        const restart = batch.find(file => backendSources.has(fileKey(file)) || ['server/', 'shared/'].some(prefix => normalizePath(relative(root, file)).startsWith(prefix)) || file.endsWith('package.json'))
        if (restart || backendReloadPending) await reloadBackend()
        else for (const file of batch) await update(file)
      }).catch(report).finally(() => { if (--working === 0) emit({ type: 'idle' }) })
    }, 120)
  }
  const changes = new Set()
  try {
    vite = await createServer({
      configFile: false, root, publicDir: false, appType: 'custom', cacheDir,
      optimizeDeps: { entries: entries.filter(e => e.manifest.client).map(e => resolve(e.sourceRoot, e.package.cordis.build.find(t => t.output === e.manifest.client).input)) },
      server: { host: '127.0.0.1', port, strictPort: true, cors: false,
        watch: { ignored: ['**/dist/**', '**/data/**', '**/work/**', '**/.workbench/**', normalizePath(resolve(dataDir)) + '/**'] },
        fs: { strict: true, allow: [root, applicationsDir], deny: ['**/.env*', '**/.git/**', '**/data/**', '**/*.pem', '**/*.key'] },
        proxy: { '^/(api/|builtin/|applications/[^/]+/icon$)': { target: `http://127.0.0.1:${backendPort}`, changeOrigin: true,
          configure(proxy) {
            backendProxy = proxy
            proxy.on('proxyReq', request => { if (request.getHeader('origin')) request.setHeader('origin', `http://127.0.0.1:${backendPort}`) })
            proxy.on('error', error => console.error('后端连接失败：', error.message))
          },
          bypass(req, res, options) { backendProxy.options.target = options.target = `http://127.0.0.1:${backendPort}` },
        } },
      },
      plugins: [pluginSources(entries, { register }), tailwindcss(), {
        name: 'cordis-development',
        configureServer(server) {
          // Vite also requests full reloads for HTML and dependency optimization.
          // Route those through the same save guard instead of bypassing editors.
          const send = server.ws.send.bind(server.ws)
          const observe = (payload, data) => {
            const event = typeof payload === 'string' ? payload : payload?.type === 'custom' ? payload.event : payload?.type
            if (event === 'error') emit({ type: 'error', message: String(payload.err?.message || '开发服务错误').slice(0, 4000) })
            else if (event === 'update') emit({ type: 'css', paths: (payload.updates || []).map(update => update.path) })
            else if (event === 'cordis:plugins') emit({ type: 'plugins', targets: (data ?? payload.data)?.targets || {} })
            else if (event === 'cordis:restart') emit({ type: 'reload' })
          }
          server.ws.send = (payload, ...args) => {
            if (payload?.type === 'full-reload') { schedule(resolve(root, 'public/index.html')); return }
            observe(payload, args[0])
            return send(payload, ...args)
          }
          server.cordisWatcherReady = new Promise(resolve => server.watcher.once('ready', resolve))
          saveGuard = createDevelopmentSaveGuard(server.ws, { timeout: saveTimeout, emit })
          server.middlewares.use(async (req, res, next) => {
            try {
              const host = req.headers.host || ''
              if (!/^(127[.]0[.]0[.]1|localhost)(:[0-9]+)?$/.test(host) || req.headers.origin && req.headers.origin !== `http://${host}`) { res.writeHead(403); res.end('只允许本机同源访问'); return }
              const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
              if (pathname === '/__cordis/identity') {
                res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
                res.end(JSON.stringify({ mode: 'development', session, pid: process.pid })); return
              }
              if (pathname === '/__cordis/dev') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version, plugins })); return }
              if (pathname === '/') {
                const html = (await readFile(resolve(root, 'public/index.html'), 'utf8')).replace('src="/runtime.js"', `src="${urlFor(resolve(root, 'client/host/runtime.js'))}"`).replace('href="/style.css"', `href="${urlFor(resolve(root, 'public/style.css'))}"`)
                res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/', html)); return
              }
              if (pathname.startsWith('/builtin/')) {
                const parts = pathname.split('/'), asset = parts.slice(3).join('/')
                const state = await fetch(`http://127.0.0.1:${backendPort}/api/applications`).then(r => r.json())
                const file = plugins[state.current?.id]?.[parts[2]]?.assets[asset]
                if (file) {
                  const query = new URL(req.url, 'http://localhost').searchParams
                  if (query.get('appSession') && query.get('appSession') !== state.session) { res.writeHead(409); res.end('应用已切换'); return }
                  res.writeHead(302, { Location: urlFor(file) + (file.endsWith('.css') ? '?direct' : '') }); res.end(); return
                }
              }
              if (['/api/', '/builtin/'].some(prefix => pathname.startsWith(prefix)) || /^[/]applications[/][^/]+[/]icon$/.test(pathname)) return next()
              if (pathname.startsWith('/@vite/') || pathname.startsWith('/node_modules/.vite/')) return next()
              const file = pathname.startsWith('/@fs/') ? pathname.slice(5) : resolve(root, '.' + pathname)
              const actual = await realpath(file).catch(() => null)
              if (!actual || !allowed.has(fileKey(actual))) { res.writeHead(404); res.end('未声明的浏览器资源'); return }
              next()
            } catch (error) { next(error) }
          })
        },
        hotUpdate(context) {
          if (this.environment.name !== 'client') return []
          if (context.file.endsWith('.css')) {
            const updates = context.modules.map(mod => ({ type: 'css-update', path: mod.url, acceptedPath: mod.url, timestamp: context.timestamp }))
            if (updates.length) context.server.ws.send({ type: 'update', updates })
            return []
          }
          schedule(context.file); return []
        },
      }],
    })
    // Files outside the frontend module graph still need backend/manifest watching.
    vite.watcher.add([resolve(root, 'server'), resolve(root, 'shared'), resolve(root, 'scripts'), resolve(applicationsDir)])
    vite.watcher.add([resolve(root, 'public/index.html'), resolve(root, 'pnpm-lock.yaml')])
    const backendChange = file => backendSources.has(fileKey(file)) || file.endsWith('package.json') || ['server/', 'shared/', 'scripts/'].some(prefix => normalizePath(relative(root, file)).startsWith(prefix)) || ['public/index.html', 'pnpm-lock.yaml'].includes(normalizePath(relative(root, file)))
    vite.watcher.on('change', file => { if (backendChange(file)) schedule(file) })
    vite.watcher.on('add', file => { if (file.endsWith('package.json')) schedule(file) })
    vite.watcher.on('unlink', file => { if (allowed.has(fileKey(file)) || backendSources.has(fileKey(file)) || file.endsWith('package.json')) schedule(file) })
    await vite.listen()
    await vite.cordisWatcherReady
    console.log(`Cordis Vite: http://127.0.0.1:${vite.httpServer.address().port}`)
    emit({ type: 'ready' })
    return { vite, get backendPort() { return backendPort }, async close() {
      closing = true; clearTimeout(timer); saveGuard.close(); await queue; await vite.close(); await stopBackend()
    } }
  } catch (error) { saveGuard?.close(); await vite?.close(); await stopBackend(); throw error }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const onEvent = event => { if (process.connected) process.send({ type: 'cordis-dev', event }) }
  const dev = await startDevelopment({ onEvent })
  let closing = false
  const close = async () => { if (closing) return; closing = true; await dev.close(); process.exit(0) }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close)
  process.on('message', message => { if (message?.type === 'workbench-shutdown') void close() })
  if (process.connected) process.once('disconnect', close)
}
