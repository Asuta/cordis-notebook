import { createServer, normalizePath } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { build } from 'esbuild'
import { fork } from 'node:child_process'
import { readFile, realpath, mkdir } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { discoverApplications, defaultApplicationsDir } from '../server/application-discovery.js'
import { inside, discoverBuiltins } from '../server/plugin-discovery.js'
import { pluginSources } from './vite-build.js'
import { createDevelopmentSaveGuard } from './development-save-guard.js'
import { developmentRPC } from './development-rpc.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const viteEnvironment = fileURLToPath(new URL('../client/env.mjs', import.meta.resolve('vite')))
const urlFor = file => '/@fs/' + normalizePath(file)
const fileKey = file => normalizePath(resolve(file)).toLowerCase()

/** Files used only by verification or documentation must not replace a live plugin. */
export function isNonRuntimePluginFile(file) {
  const normalized = normalizePath(file), name = normalized.slice(normalized.lastIndexOf('/') + 1)
  return normalized.split('/').includes('test')
    || normalized.split('/').includes('__tests__')
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(name)
    || /\.types?\.ts$/.test(name)
    || /\.d\.ts$/.test(name)
    || /\.(?:md|mdx)$/i.test(name)
    || /^(?:README|CHANGELOG)(?:\.|$)/i.test(name)
    || /^agent\.md$/i.test(name)
}

// Validate the native host import graph without executing it or writing build output.
export async function preflightHost(entry = resolve(root, 'scripts/development-backend.js')) {
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', packages: 'external', write: false, logLevel: 'silent' })
}

/** Vite owns the public port. Backend restarts never disconnect its HMR channel. */
export async function startDevelopment({ port = Number(process.env.PORT || 3210), dataDir = process.env.DATA_DIR || resolve(root, 'data'), applicationsDir = process.env.APPLICATIONS_DIR || defaultApplicationsDir, initialApplication = process.env.APP,
  cacheDir = process.env.CORDIS_VITE_CACHE_DIR || resolve(root, 'node_modules/.vite/cordis'), onEvent = () => {},
  session = process.env.CORDIS_DEV_SESSION || randomUUID(), saveTimeout = 15000,
  dependencyFiles = [resolve(root, 'pnpm-lock.yaml'), resolve(root, 'node_modules/.modules.yaml')] } = {}) {
  await mkdir(dataDir, { recursive: true })
  const entries = [], allowed = new Set(), backendSources = new Set()
  let catalog, plugins, backend, backendPort, backendProxy, backendRPC, version = Date.now(), closing = false, timer, queue = Promise.resolve(), working = 0
  const pendingPlugins = new Set()
  let reloadToken = randomUUID()
  const dependencyKeys = new Set(dependencyFiles.map(fileKey)), dependencyListeners = []
  const applicationRoot = resolve(applicationsDir)
  const hostRoots = ['client', 'public', 'server', 'shared', 'scripts'].map(directory => resolve(root, directory))
  const relevantRootKeys = [applicationRoot, ...hostRoots].map(fileKey)
  const rootKey = fileKey(root), dataRootKey = fileKey(dataDir), cacheRootKey = fileKey(cacheDir)
  const isRelevantDevelopmentFile = file => {
    const key = fileKey(file)
    return dependencyKeys.has(key) || relevantRootKeys.some(directory => key.startsWith(directory + '/'))
  }
  const isRelevantWatchPath = file => {
    const key = fileKey(file)
    return key === rootKey || dependencyKeys.has(key) || relevantRootKeys.some(directory =>
      key === directory || key.startsWith(directory + '/') || directory.startsWith(key + '/'))
  }
  const isIgnoredWatchPath = file => {
    const key = fileKey(file), local = normalizePath(relative(root, file))
    return key === dataRootKey
      || key.startsWith(dataRootKey + '/')
      || key === cacheRootKey
      || key.startsWith(cacheRootKey + '/')
      || /(?:^|\/)(?:dist|data|work|\.workbench)(?:\/|$)/.test(local)
      || /(?:^|\/)\.scaffold-[^/]+(?:\/|$)/.test(local)
      || !isRelevantWatchPath(file)
  }
  // Development events let a supervising process (the Agent workbench) observe
  // updates, errors and page reloads without parsing console output.
  const emit = event => { try { onEvent(event) } catch {} }
  const register = file => allowed.add(fileKey(file))
  async function discoverPlan() {
    const nextCatalog = await discoverApplications(applicationsDir), nextEntries = [], nextPlugins = {}, nextBackend = new Set()
    for (const app of nextCatalog) {
      if (app.error) throw Error(`${app.id}: ${app.error}`)
      const found = await discoverBuiltins(app.pluginsDir, { mode: 'development' })
      nextEntries.push(...found.map(entry => ({ ...entry, applicationId: app.id }))); nextPlugins[app.id] = {}
      for (const entry of found) {
        const source = output => entry.package.cordis.build.find(task => task.output === output)
        if (entry.serverEntry) nextBackend.add(fileKey(resolve(entry.sourceRoot, source(entry.serverEntry.entry).input)))
        const client = entry.manifest.client && resolve(entry.sourceRoot, source(entry.manifest.client).input)
        const styles = Object.fromEntries(entry.manifest.styles.map(name => [name, urlFor(resolve(entry.sourceRoot, source(name).input)) + '?direct']))
        const assets = Object.fromEntries(entry.clientAssets.map(name => [name, resolve(entry.sourceRoot, source(name).input)]))
        nextPlugins[app.id][entry.manifest.id] = { client: client && urlFor(client), styles, assets }
      }
    }
    return { catalog: nextCatalog, entries: nextEntries, plugins: nextPlugins, sources: nextBackend }
  }
  function refreshBrowserPermissions() {
    allowed.clear()
    register(resolve(root, 'client/host/runtime.js')); register(resolve(root, 'public/style.css'))
    // Vite's client imports this runtime before the application's module graph exists.
    register(viteEnvironment)
    for (const app of Object.values(plugins)) for (const plugin of Object.values(app)) Object.values(plugin.assets).forEach(register)
    const graph = vite?.environments.client.moduleGraph
    if (!graph) return
    const seeds = [...graph.idToModuleMap.values()].filter(mod => mod.file && allowed.has(fileKey(mod.file))), seen = new Set()
    const visit = mod => {
      if (seen.has(mod)) return
      seen.add(mod); if (mod.file) register(mod.file)
      mod.importedModules.forEach(visit)
    }
    seeds.forEach(visit)
  }
  function applyPlan(plan) {
    catalog = plan.catalog; plugins = plan.plugins; entries.splice(0, entries.length, ...plan.entries)
    backendSources.clear(); plan.sources.forEach(file => backendSources.add(file))
    refreshBrowserPermissions()
  }
  let vite, saveGuard
  const initial = await discoverPlan(); applyPlan(initial)
  async function launch() {
    const child = fork(resolve(root, 'scripts/development-backend.js'), [], { cwd: root, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, PORT: '0', DATA_DIR: resolve(dataDir), APPLICATIONS_DIR: resolve(applicationsDir), CORDIS_DEV: '1', CORDIS_VITE_CACHE_DIR: cacheDir, ...(initialApplication ? { APP: initialApplication } : {}) } })
    backend = child
    backendRPC = developmentRPC(child)
    child.on('message', message => { if (message?.type === 'cordis-sources') message.files.forEach(file => backendSources.add(fileKey(file))) })
    await new Promise((accept, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(Error('开发后端启动超时')) }, 30000)
      const finish = error => { clearTimeout(timeout); child.off('exit', exit); child.off('error', finish); child.off('message', ready); error ? reject(error) : accept() }
      const exit = code => finish(Error('开发后端退出：' + code))
      const ready = message => { if (message?.type === 'cordis-ready') { backendPort = message.port; finish() } }
      child.on('message', ready); child.once('error', finish); child.once('exit', exit)
    })
  }
  async function stopBackend() {
    backendRPC?.close()
    const child = backend; backend = null
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    await new Promise(resolve => {
      const timeout = setTimeout(() => child.kill(), 10000)
      child.once('exit', () => { clearTimeout(timeout); resolve() })
      if (child.connected) child.send({ type: 'workbench-shutdown' }); else child.kill()
    })
  }
  await launch()
  const report = error => {
    if (error.code === 'DEVELOPMENT_SAVE_PENDING' || closing) return
    if (/Cannot find|Failed to (?:load|resolve)|ERR_MODULE_NOT_FOUND/.test(error.message)) error.message += '\n若依赖尚未安装，请运行 pnpm install；安装结束后开发服务会自动重试。'
    console.error(error)
    vite?.ws.send({ type: 'error', err: { message: error.message, stack: error.stack || '', plugin: 'cordis-development' } })
  }
  async function reloadBackend() {
    const plan = await discoverPlan()
    await preflightHost()
    const previous = { catalog, plugins, entries: [...entries], sources: new Set(backendSources) }
    await saveGuard.run(async () => {
      applyPlan(plan)
      // Remove old module permissions and rebuild them from the current import graph.
      vite.environments.client.moduleGraph.invalidateAll()
      await stopBackend()
      try { await launch() }
      catch (error) {
        applyPlan(previous)
        await launch().catch(recovery => { error.message += '\n后端尚未恢复，请修正源码：' + recovery.message })
        throw error
      }
      vite.ws.send('cordis:restart', {})
    }, () => schedule(resolve(root, 'server/server.js')))
    pendingPlugins.clear()
  }
  async function reloadPlugins(files) {
    files.forEach(file => pendingPlugins.add(file))
    const plan = await discoverPlan()
    const previous = { catalog, plugins, entries: [...entries], sources: new Set(backendSources) }
    try {
      // Make new entry points resolvable for preflight, but publish browser mappings only at commit.
      entries.splice(0, entries.length, ...plan.entries)
      const prepared = await backendRPC.call('prepare', { changes: [...pendingPlugins] })
      if (prepared.noop) {
        await backendRPC.call('discard')
        applyPlan(plan); prepared.sources.forEach(file => backendSources.add(fileKey(file)))
        pendingPlugins.clear(); saveGuard.unchanged()
        // A restored manifest can match the live plan after an earlier validation error.
        // Clear its browser overlay without entering the save or plugin reload queues.
        vite.ws.send('cordis:unchanged', {})
        emit({ type: 'noop', message: '应用清单和插件加载计划没有变化，本次扫描无需页面保存或插件重载。' })
        return
      }
      const nextVersion = Math.max(Date.now(), version + 1)
      invalidatePluginModules(nextVersion)
      for (const entry of plan.entries) if (entry.manifest.client && prepared.targets[entry.applicationId]?.includes(entry.manifest.id)) {
        await preflight(plan.plugins[entry.applicationId][entry.manifest.id].client)
      }
      await saveGuard.run(async () => {
        applyPlan(plan); version = nextVersion
        const result = await backendRPC.call('commit')
        result.sources.forEach(file => backendSources.add(fileKey(file)))
        pendingPlugins.clear()
        vite.ws.send('cordis:catalog', { version, targets: result.targets })
      }, () => schedule([...pendingPlugins][0]))
    } catch (error) {
      applyPlan(previous)
      await backendRPC.call('discard').catch(() => {})
      throw error
    }
  }
  async function preflight(url) {
    const graph = vite.environments.client.moduleGraph, checked = new Set(), pending = [url]
    while (pending.length) {
      const item = pending.pop()
      if (checked.has(item)) continue
      checked.add(item)
      await vite.transformRequest(item)
      const mod = await graph.getModuleByUrl(item)
      for (const child of mod?.importedModules || []) if (child.file && !child.file.includes('/node_modules/') && !child.file.endsWith('.css')) pending.push(child.url)
    }
  }
  const ownModule = mod => mod.file && entries.some(entry => inside(entry.sourceRoot, resolve(mod.file))) && !mod.file.includes('/node_modules/')
  function invalidatePluginModules(timestamp) {
    const graph = vite.environments.client.moduleGraph
    // Version relative imports too: changing only the entry URL retains cached children.
    for (const mod of [...graph.idToModuleMap.values()].filter(ownModule)) graph.invalidateModule(mod, new Set(), timestamp, true)
  }
  async function update(file) {
    if (closing) return
    if (isNonRuntimePluginFile(file)) return
    const key = fileKey(file), local = normalizePath(relative(root, file))
    if (local.startsWith('scripts/') || key === fileKey(resolve(root, 'pnpm-lock.yaml'))) {
      console.log('构建工具或依赖已修改，请重新运行 pnpm dev。'); return
    }
    // A newly created import may have been missing during the last compilation.
    // Rebuild its owning application plan so frontend and backend can recover.
    if (!allowed.has(key) && entries.some(entry => inside(entry.sourceRoot, resolve(file)))) {
      await reloadPlugins([file]); return
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
    invalidatePluginModules(version)
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
    if (Object.keys(targets).length) vite.ws.send('cordis:plugins', { version, targets })
  }
  const schedule = file => {
    if (closing || !isRelevantDevelopmentFile(file)) return
    if (isNonRuntimePluginFile(file)) return
    changes.add(file)
    if (!timer && working++ === 0) emit({ type: 'busy' })
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const batch = [...changes]; changes.clear()
      queue = queue.then(async () => {
        const local = file => normalizePath(relative(root, file))
        if (batch.some(file => ['server/', 'shared/'].some(prefix => local(file).startsWith(prefix)))) await reloadBackend()
        else {
          const manifest = batch.some(file => file.endsWith('package.json') && inside(resolve(applicationsDir), resolve(file)))
          const backendFiles = batch.filter(file => !isNonRuntimePluginFile(file) && (backendSources.has(fileKey(file)) || /\.[cm]?[jt]sx?$/.test(file) && !allowed.has(fileKey(file)) && entries.some(entry => entry.serverEntry && inside(entry.sourceRoot, resolve(file)))))
          const dependency = batch.some(file => dependencyKeys.has(fileKey(file)))
          if (manifest || backendFiles.length || pendingPlugins.size || dependency) {
            await reloadPlugins(batch)
            if (batch.some(file => local(file).startsWith('client/') || local(file) === 'public/index.html')) vite.ws.send('cordis:restart', {})
          } else for (const file of batch) await update(file)
        }
      }).catch(report).finally(() => { if (--working === 0) emit({ type: 'idle' }) })
    }, 120)
  }
  const changes = new Set()
  try {
    vite = await createServer({
      configFile: false, root, publicDir: false, appType: 'custom', cacheDir,
      // Vite treats entries as glob patterns. Windows backslashes prevent the
      // initial crawl, causing late optimizer reloads while plugins are mounting.
      optimizeDeps: {
        entries: entries.filter(e => e.manifest.client).map(e => normalizePath(resolve(e.sourceRoot, e.package.cordis.build.find(t => t.output === e.manifest.client).input))),
        // Match pluginSources' classic JSX transform. The scanner otherwise
        // invents react/jsx-runtime imports and violates the ui service boundary.
        rolldownOptions: { transform: { jsx: { runtime: 'classic' } } },
      },
      server: { host: '127.0.0.1', port, strictPort: true, cors: false,
        watch: { ignored: isIgnoredWatchPath },
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
            else if (event === 'cordis:catalog') emit({ type: 'plugins', targets: (data ?? payload.data)?.targets || {} })
            else if (event === 'cordis:restart') { reloadToken = randomUUID(); emit({ type: 'reload', reloadToken }) }
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
                res.end(JSON.stringify({ mode: 'development', session, pid: process.pid, backendPid: backend?.pid })); return
              }
              if (pathname === '/__cordis/dev') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ version, plugins })); return }
              if (pathname === '/') {
                const html = (await readFile(resolve(root, 'public/index.html'), 'utf8')).replace('src="/runtime.js"', `src="${urlFor(resolve(root, 'client/host/runtime.js'))}"`).replace('href="/style.css"', `href="${urlFor(resolve(root, 'public/style.css'))}"`)
                res.setHeader('Content-Type', 'text/html'); res.setHeader('Cache-Control', 'no-store')
                res.end(await server.transformIndexHtml('/', html.replace('</head>', `<meta name="cordis-reload-token" content="${reloadToken}"></head>`))); return
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
          if (this.environment.name !== 'client' || !isRelevantDevelopmentFile(context.file) || isNonRuntimePluginFile(context.file)) return []
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
    vite.watcher.add([resolve(root, 'public/index.html'), resolve(root, 'pnpm-lock.yaml'), resolve(root, 'node_modules/.modules.yaml')])
    const backendChange = file => isRelevantDevelopmentFile(file) && !isNonRuntimePluginFile(file) && (backendSources.has(fileKey(file)) || inside(applicationRoot, resolve(file)) && (!allowed.has(fileKey(file)) || file.endsWith('package.json')) || ['server/', 'shared/', 'scripts/'].some(prefix => normalizePath(relative(root, file)).startsWith(prefix)) || ['public/index.html', 'pnpm-lock.yaml', 'node_modules/.modules.yaml'].includes(normalizePath(relative(root, file))))
    vite.watcher.on('change', file => { if (backendChange(file)) schedule(file) })
    vite.watcher.on('add', file => { if (backendChange(file)) schedule(file) })
    vite.watcher.on('unlink', file => { if (isRelevantDevelopmentFile(file) && !isNonRuntimePluginFile(file) && (allowed.has(fileKey(file)) || backendSources.has(fileKey(file)) || file.endsWith('package.json'))) schedule(file) })
    await vite.listen()
    await vite.cordisWatcherReady
    // Vite intentionally ignores node_modules. pnpm's completion stamp is watched separately.
    for (const file of dependencyFiles) {
      const listener = (next, old) => { if (next.mtimeMs !== old.mtimeMs && next.mtimeMs) schedule(file) }
      watchFile(file, { interval: 500, persistent: false }, listener); dependencyListeners.push([file, listener])
    }
    console.log(`Cordis Vite: http://127.0.0.1:${vite.httpServer.address().port}`)
    emit({ type: 'ready' })
    return { vite, get backendPort() { return backendPort }, get backendPid() { return backend?.pid }, async close() {
      closing = true; clearTimeout(timer); dependencyListeners.forEach(([file, listener]) => unwatchFile(file, listener)); saveGuard.close()
      // Closing IPC also releases an outstanding prepare/commit before draining the queue.
      await stopBackend(); await queue; await vite.close()
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
