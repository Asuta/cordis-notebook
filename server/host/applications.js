import { Context, Service } from 'cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, cp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Plugins } from './plugins.js'
import { fail } from './http.js'
import { discoverBuiltins } from '../plugin-discovery.js'
import { writeSnapshot } from '../../shared/persistence.js'
import { ensureApplicationDataIdentity, migrateDataDirectory, readApplicationDataDirectory, removeApplicationDataDirectory, validateAttachedApplicationDataDirectory, writeApplicationDataDirectory } from './data-location.js'

export class Applications {
  constructor(http, { applications, dataDir, standalone = false, file, discoveryMode = 'runtime', discoverPlugins = discoverBuiltins, locationRoot }) {
    Object.assign(this, { http, applications, dataDir, standalone, file, discoveryMode, discoverPlugins, locationRoot })
    this.current = null; this.session = randomUUID(); this.phase = 'idle'; this.error = ''; this.recovery = null
    this.queue = Promise.resolve(); this.inflight = new Set(); this.closed = false
  }
  describe() {
    return { session: this.session, current: this.current ? this.publicApp(this.current.app) : null,
      phase: this.phase, error: this.error, recovery: this.recovery ? structuredClone(this.recovery) : null,
      applications: this.applications.map(app => this.publicApp(app)),
    }
  }
  publicApp(app) {
    return { id: app.id, name: app.name, description: app.description || '', error: app.error || '',
      icon: app.icon ? `/applications/${app.id}/icon` : null,
      legacyBrowserStorage: !!app.legacyBrowserStorage, manageData: !!app.manageData }
  }
  snapshot() {
    return { ...(this.current?.manager.serialize() || { plugins: [], revision: 0 }), application: this.describe() }
  }
  notify() {
    for (const client of this.http.clients) client.write(`event: applications\ndata: ${JSON.stringify(this.describe())}\n\n`)
    this.http.broadcast()
  }
  checkSession(req, pathname, required = false) {
    const token = req.headers['x-application-session'] || new URL(req.url, 'http://localhost').searchParams.get('appSession')
    if (token && token !== this.session || required && !this.standalone && !token) throw fail(409, '应用已切换，请重新载入页面')
    if (this.phase !== 'idle') throw fail(409, '应用正在切换，请稍后重试')
  }
  withCurrent(request, handler) {
    this.checkSession(request.req, request.pathname, !['GET', 'HEAD'].includes(request.req.method))
    const runtime = this.current
    if (!runtime) throw fail(404, '当前没有打开应用')
    const task = Promise.resolve().then(() => handler(runtime))
    this.inflight.add(task)
    return task.finally(() => this.inflight.delete(task))
  }
  dispatch(request) {
    return this.withCurrent(request, runtime => {
      const route = runtime.routes.find(r => r.method === request.req.method && r.pattern.test(request.pathname))
      if (!route) throw fail(404, '功能未启用或路径不存在')
      return route.handler({ ...request, match: request.pathname.match(route.pattern) })
    })
  }
  async applicationData(app) {
    if (this.standalone) { await mkdir(this.dataDir, { recursive: true }); return this.dataDir }
    const configured = this.locationRoot ? await readApplicationDataDirectory(this.locationRoot, app.id) : null
    if (configured) {
      const recovery = { appId: app.id, appName: app.name, configuredPath: configured, defaultPath: join(this.dataDir, 'apps', app.id) }
      let info
      try { info = await stat(configured) }
      catch (error) {
        if (error.code !== 'ENOENT') Object.assign(error, { recovery })
        if (error.code === 'ENOENT') throw Object.assign(Error(`应用数据目录不存在或不是文件夹：${configured}`), { status: 500, recovery })
        throw error
      }
      if (!info.isDirectory()) throw Object.assign(Error(`应用数据目录不存在或不是文件夹：${configured}`), { status: 500, recovery })
      try { await ensureApplicationDataIdentity(configured, app.id) }
      catch (error) { Object.assign(error, { recovery }); throw error }
      return configured
    }
    const directory = join(this.dataDir, 'apps', app.id)
    if (await stat(directory).catch(e => { if (e.code !== 'ENOENT') throw e })) {
      await ensureApplicationDataIdentity(directory, app.id)
      return directory
    }
    await mkdir(join(this.dataDir, 'apps'), { recursive: true })
    // Copy-once migration, then atomic publication. Never overwrite or delete old user data.
    const staging = join(this.dataDir, 'apps', '.' + app.id + '-' + randomUUID())
    await mkdir(staging)
    for (const name of app.legacyData || []) {
      if (['apps', 'applications-state.json'].includes(name)) throw Error('旧数据目录不能包含宿主应用状态')
      const source = join(this.dataDir, name)
      if (await stat(source).catch(e => { if (e.code !== 'ENOENT') throw e })) await cp(source, join(staging, name), { recursive: true, errorOnExist: true, force: false })
    }
    await rename(staging, directory)
    await ensureApplicationDataIdentity(directory, app.id)
    return directory
  }
  async openRuntime(app, entries, dataDir) {
    const ctx = new Context(), routes = []
    try {
      await ctx.plugin(owner => {
        Object.assign(new Service(owner, 'http'), {
          body: req => this.http.body(req), broadcast: () => this.http.broadcast(),
          route(owner, method, pattern, handler) {
            const route = { method, pattern, handler }; routes.push(route)
            owner.effect(() => () => { const index = routes.indexOf(route); if (index >= 0) routes.splice(index, 1) })
          },
        })
      })
      await ctx.plugin(Plugins, { dataDir, file: this.standalone ? this.file : undefined, builtinPlugins: entries })
      const manager = ctx.plugins
      await manager.init()
      if (!this.standalone) {
        const failures = manager.serialize().plugins.filter(p => p.enabled && p.state === 'failed')
        if (failures.length) throw Error(failures.map(p => `${p.name}：${p.error}`).join('；'))
      }
      return { app, ctx, manager, routes, dataDir, entries, async close() { try { await manager.close() } finally { await ctx.fiber.dispose() } } }
    } catch (error) { await ctx.fiber.dispose(); throw error }
  }
  async persist(id) {
    if (this.standalone) return
    const file = join(this.dataDir, 'applications-state.json')
    await writeSnapshot(file, JSON.stringify({ active: id }, null, 2))
  }
  async init(initialId) {
    await mkdir(this.dataDir, { recursive: true })
    if (this.standalone) { await this.switch(this.applications[0].id, this.session); return }
    let saved
    try { saved = JSON.parse(await readFile(join(this.dataDir, 'applications-state.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') { this.error = '应用选择读取失败：' + error.message; return } }
    const id = initialId ?? (saved ? saved.active : this.applications.find(app => app.default && !app.error)?.id ?? null)
    if (!id) return
    try { await this.switch(id, this.session) }
    catch (error) { if (this.standalone) throw error; this.error = error.message; this.recovery = error.recovery || null }
  }
  switch(id, expectedSession) {
    const run = this.queue.then(() => this.change(id, expectedSession))
    this.queue = run.catch(() => {}); return run
  }
  async change(id, expectedSession) {
    if (this.closed || expectedSession !== this.session) throw fail(409, '应用状态已变化，请重新载入')
    if (id !== null && typeof id !== 'string') throw fail(400, 'id 必须是应用 ID 或 null')
    if (id === this.current?.app.id) return this.describe()
    const app = id === null ? null : this.applications.find(app => app.id === id)
    if (id !== null && !app) throw fail(404, '应用不存在')
    if (app?.error) throw fail(400, app.error)
    // Validate inactive metadata/artifacts before disturbing the running application.
    const entries = app ? await this.discoverPlugins(app.pluginsDir, { mode: this.discoveryMode }) : []
    const dataDir = app ? await this.applicationData(app) : null
    const previous = this.current
    this.phase = 'switching'; this.error = ''; this.recovery = null; this.notify()
    try {
      await Promise.allSettled([...this.inflight])
      if (previous?.manager.settings.pending || previous?.manager.pendingSwitch) throw fail(409, '当前应用还有未完成的配置或插件切换，请完成后重试')
      this.current = null; this.session = randomUUID()
      try {
        await previous?.close()
        if (app) this.current = await this.openRuntime(app, entries, dataDir)
        await this.persist(id)
      } catch (error) {
        await this.current?.close(); this.current = null
        if (previous) {
          try { this.current = await this.openRuntime(previous.app, previous.entries, previous.dataDir) }
          catch (restore) { error.message += `；恢复上一应用失败：${restore.message}` }
        }
        this.recovery = error.recovery || null
        throw error
      }
      return { ...this.describe(), phase: 'idle' }
    } catch (error) { this.error = '打开应用失败：' + error.message; throw fail(error.status || 500, this.error) }
    finally { this.phase = 'idle'; this.notify() }
  }
  relocateDataDirectory(target, mode, expectedSession) {
    const run = this.queue.then(() => this.changeDataDirectory(target, mode, expectedSession))
    this.queue = run.catch(() => {}); return run
  }
  recoverDataDirectory(appId, expectedSession) {
    const run = this.queue.then(() => this.recoverDataDirectoryNow(appId, expectedSession))
    this.queue = run.catch(() => {}); return run
  }
  async recoverDataDirectoryNow(appId, expectedSession) {
    if (this.closed || expectedSession !== this.session) throw fail(409, '页面状态已变化，请重新载入')
    if (this.standalone) throw fail(400, '单插件开发模式不支持切换数据目录')
    if (this.phase !== 'idle') throw fail(409, '应用正在切换，请稍后重试')
    const app = this.applications.find(app => app.id === appId)
    if (!app) throw fail(404, '应用不存在')
    if (!app.manageData) throw fail(400, '当前应用不支持单独设置数据目录')
    const configured = this.locationRoot ? await readApplicationDataDirectory(this.locationRoot, app.id) : null
    if (!configured) throw fail(400, '当前应用没有可恢复的自定义数据目录')
    await removeApplicationDataDirectory(this.locationRoot, app.id)
    this.error = ''; this.recovery = null
    return this.change(app.id, this.session)
  }
  dataDirectoryInfo() {
    const current = this.current
    if (!current) throw fail(404, '当前没有打开应用')
    if (!current.app.manageData) throw fail(400, '当前应用不支持单独设置数据目录')
    return {
      app: { id: current.app.id, name: current.app.name }, path: current.dataDir,
      defaultPath: join(this.dataDir, 'apps', current.app.id), standalone: this.standalone,
    }
  }
  async changeDataDirectory(target, mode, expectedSession) {
    if (this.closed || expectedSession !== this.session) throw fail(409, '页面状态已变化，请重新载入')
    if (this.standalone) throw fail(400, '单插件开发模式不支持切换数据目录')
    if (!['migrate', 'attach'].includes(mode) || typeof target !== 'string') throw fail(400, '数据目录操作无效')
    if (this.phase !== 'idle') throw fail(409, '应用正在切换，请稍后重试')
    const previous = this.current
    if (!previous) throw fail(404, '当前没有打开应用')
    if (!previous.app.manageData) throw fail(400, '当前应用不支持单独设置数据目录')
    this.phase = 'switching'; this.error = ''; this.notify()
    const previousDataDir = previous.dataDir, previousSession = this.session
    let current = null, result
    try {
      await Promise.allSettled([...this.inflight])
      if (previous?.manager.settings.pending || previous?.manager.pendingSwitch) throw fail(409, '当前应用还有未完成的配置或插件切换，请完成后重试')
      this.current = null; this.session = randomUUID()
      await previous.close()
      const checked = mode === 'migrate' ? await migrateDataDirectory(previousDataDir, target) : await validateAttachedApplicationDataDirectory(target, previousDataDir, previous.app.id)
      await ensureApplicationDataIdentity(checked.path, previous.app.id)
      current = await this.openRuntime(previous.app, previous.entries, checked.path)
      await writeApplicationDataDirectory(this.locationRoot, previous.app.id, checked.path)
      this.current = current
      result = { ...this.describe(), app: { id: previous.app.id, name: previous.app.name }, path: checked.path, defaultPath: join(this.dataDir, 'apps', previous.app.id), files: checked.files }
    } catch (error) {
      await current?.close().catch(() => {})
      this.current = null
      try { this.current = await this.openRuntime(previous.app, previous.entries, previousDataDir) }
      catch (restore) { error.message += `；恢复原数据目录失败：${restore.message}` }
      this.session = previousSession
      throw fail(error.status || 500, '切换应用数据目录失败：' + error.message)
    } finally {
      this.phase = 'idle'; this.notify()
    }
    return result
  }
  async close() {
    this.closed = true; await this.queue
    this.phase = 'stopping'; await Promise.allSettled([...this.inflight])
    await this.current?.close(); this.current = null
  }
}
