import { createServer } from 'vite'
import { ModuleRunner, createNodeImportMeta } from 'vite/module-runner'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost } from '../server/server.js'
import { discoverApplications, defaultApplicationsDir } from '../server/application-discovery.js'
import { discoverBuiltins, inside } from '../server/plugin-discovery.js'
import { reconcilePlugins } from '../server/host/plugin-reload.js'
import { pluginSources } from './vite-build.js'
import { developmentRPC } from './development-rpc.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const applicationsDir = process.env.APPLICATIONS_DIR || defaultApplicationsDir
const sourceEntries = []
// The Node runner has no HTTP listener and no browser module permissions.
const vite = await createServer({ configFile: false, root, publicDir: false, appType: 'custom',
  cacheDir: resolve(process.env.CORDIS_VITE_CACHE_DIR || resolve(root, 'node_modules/.vite/cordis'), 'backend'),
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  ssr: { external: ['cordis'], optimizeDeps: { noDiscovery: true, include: [] } },
  plugins: [pluginSources(sourceEntries)],
})
const environment = vite.environments.ssr
let plans = new Map(), app, prepared, closing = false
const sources = () => [...environment.moduleGraph.idToModuleMap.values()].map(mod => mod.file).filter(Boolean)
const key = entry => entry.sourceRoot
const signature = entry => JSON.stringify(entry.package)
const dispose = async entries => { for (const entry of entries) await entry.closeSource?.() }
function refreshSources(next) { sourceEntries.splice(0, sourceEntries.length, ...[...next.values()].flat()) }
async function readPlan(changes = []) {
  const catalog = await discoverApplications(applicationsDir), next = new Map(), fresh = [], targets = {}
  try {
    for (const application of catalog) {
      if (application.error) throw Error(application.error)
      const old = new Map((plans.get(application.pluginsDir) || []).map(entry => [key(entry), entry]))
      const candidates = await discoverBuiltins(application.pluginsDir, { mode: 'development', loadServer: async (folder, pkg) => {
        const entry = candidates.find(item => item.sourceRoot === folder)
        return entry.loadSource()
      } })
      const affected = new Set()
      const entries = candidates.map(entry => {
        const previous = old.get(key(entry))
        const edited = changes.some(file => inside(entry.sourceRoot, resolve(file)) && resolve(file) !== resolve(entry.sourceRoot, 'package.json'))
        const failed = app?.applications.current?.app.id === application.id && app.manager.records.get(entry.manifest.id)?.state === 'failed'
        if (previous && signature(entry) === signature(previous) && !edited && !failed && !previous.sourceFailed) return previous
        affected.add(entry.manifest.id); fresh.push(entry)
        if (entry.serverEntry) {
          let runner, loaded
          entry.closeSource = async () => { await runner?.close(); runner = undefined }
          entry.loadSource = () => loaded ||= (async () => {
            // Cordis owns reloads; a direct invoke transport needs no per-plugin HMR listeners.
            runner = new ModuleRunner({ transport: { invoke: payload => environment.hot.handleInvoke(payload) },
              hmr: false, sourcemapInterceptor: false, createImportMeta: createNodeImportMeta })
            const task = entry.package.cordis.build.find(task => task.output === entry.serverEntry.entry)
            const module = await runner.import(resolve(entry.sourceRoot, task.input))
            if (process.connected) process.send({ type: 'cordis-sources', files: sources() })
            const plugin = module[entry.serverEntry.export]
            if (typeof plugin !== 'function' && typeof plugin?.apply !== 'function') throw Error(`${entry.manifest.id} 后端导出不是插件入口`)
            if (plugin.inject && JSON.stringify([...plugin.inject].sort()) !== JSON.stringify([...entry.manifest.requires.server].sort())) throw Error(`${entry.manifest.id} 后端 inject 与清单不一致`)
            return plugin
          })().catch(error => {
            // An application that failed to open has no current manager record.
            // Keep its failed import visible to dependency-install retries as well.
            entry.sourceFailed = true
            throw error
          })
        }
        return entry
      })
      for (const entry of old.values()) if (!entries.some(item => item.manifest.id === entry.manifest.id)) affected.add(entry.manifest.id)
      if (affected.size) targets[application.id] = [...affected]
      next.set(application.pluginsDir, entries)
    }
    refreshSources(next)
    return { catalog, plans: next, fresh, targets }
  } catch (error) { await dispose(fresh); refreshSources(plans); throw error }
}
async function discard() { if (prepared) { await dispose(prepared.fresh); prepared = undefined }; refreshSources(plans) }
async function prepare({ changes }) {
  await discard()
  environment.moduleGraph.invalidateAll()
  const plan = await readPlan(changes)
  try {
    const current = app.applications.current
    const noop = !Object.keys(plan.targets).length && !plan.fresh.length
      && JSON.stringify(plan.catalog) === JSON.stringify(app.applications.applications)
      && plans.size === plan.plans.size && [...plans].every(([directory, entries]) => {
        const next = plan.plans.get(directory)
        return next?.length === entries.length && entries.every((entry, index) => entry === next[index])
      })
    // Evaluate candidate modules before disposing any running fiber. Plugins own effects in apply.
    for (const entry of plan.plans.get(current?.app.pluginsDir) || []) {
      const old = current.manager.records.get(entry.manifest.id)
      if (plan.fresh.includes(entry) && entry.loadSource && (old?.enabled ?? entry.defaultEnabled)) await entry.loadSource()
    }
    prepared = { ...plan, session: app.applications.session, revision: current?.manager.revision }
    return { targets: plan.targets, noop, pid: process.pid, sources: sources() }
  } catch (error) { await dispose(plan.fresh); refreshSources(plans); throw error }
}
async function commit() {
  const applications = app.applications
  const run = applications.queue.then(async () => {
    if (!prepared || prepared.session !== applications.session || prepared.revision !== applications.current?.manager.revision) throw Error('应用或插件状态已变化，请重新保存源码重试')
    const plan = prepared, current = applications.current
    if (current && !plan.plans.has(current.app.pluginsDir)) throw Error('请先切换应用，再删除当前应用目录')
    applications.phase = 'reloading'; applications.notify()
    try {
      await Promise.allSettled([...applications.inflight])
      if (current) {
        const entries = plan.plans.get(current.app.pluginsDir)
        await reconcilePlugins(current.manager, entries, plan.targets[current.app.id] || [])
        current.entries = entries; current.app = plan.catalog.find(item => item.id === current.app.id)
      }
      const retained = new Set([...plan.plans.values()].flat())
      await dispose([...plans.values()].flat().filter(entry => !retained.has(entry)))
      plans = plan.plans; applications.applications = plan.catalog; prepared = undefined
      return { targets: plan.targets, pid: process.pid, sources: sources() }
    } finally { applications.phase = 'idle'; applications.notify() }
  })
  applications.queue = run.catch(() => {})
  return run
}
const rpc = developmentRPC(process, { prepare, commit, discard, identity: () => ({ pid: process.pid }) })
try {
  const initial = await readPlan(); plans = initial.plans
  app = await createHost({ port: 0, dataDir: process.env.DATA_DIR, applicationsDir, initialApplication: process.env.APP,
    discoveryMode: 'development', discoverPlugins: async directory => plans.get(directory) || [] })
  process.send({ type: 'cordis-ready', port: app.server.address().port, pid: process.pid })
} catch (error) { rpc.close(); await dispose([...plans.values()].flat()); await vite.close(); throw error }
async function close() {
  if (closing) return
  closing = true; rpc.close()
  try { await app.close(); await discard(); await dispose([...plans.values()].flat()) } finally { await vite.close(); process.exit(0) }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, close)
process.on('message', message => { if (message?.type === 'workbench-shutdown') void close() })
process.once('disconnect', close)
