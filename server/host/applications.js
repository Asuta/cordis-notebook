import { Context, Service } from 'cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, cp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Plugins } from './plugins.js'
import { fail } from './http.js'
import { discoverBuiltins } from '../plugin-discovery.js'

export class Applications {
  constructor(http, { applications, dataDir, standalone = false, file, discoveryMode = 'runtime' }) {
    Object.assign(this, { http, applications, dataDir, standalone, file, discoveryMode })
    this.current = null; this.session = randomUUID(); this.phase = 'idle'; this.error = ''
    this.queue = Promise.resolve(); this.inflight = new Set(); this.closed = false
  }
  describe() {
    return { session: this.session, current: this.current ? this.publicApp(this.current.app) : null,
      phase: this.phase, error: this.error,
      applications: this.applications.map(app => this.publicApp(app)),
    }
  }
  publicApp(app) {
    return { id: app.id, name: app.name, description: app.description || '', error: app.error || '',
      icon: app.icon ? `/applications/${app.id}/icon` : null,
      legacyBrowserStorage: !!app.legacyBrowserStorage }
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
    const directory = join(this.dataDir, 'apps', app.id)
    if (await stat(directory).catch(e => { if (e.code !== 'ENOENT') throw e })) return directory
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
    await writeFile(file + '.tmp', JSON.stringify({ active: id }, null, 2)); await rename(file + '.tmp', file)
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
    catch (error) { if (this.standalone) throw error; this.error = error.message }
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
    const entries = app ? await discoverBuiltins(app.pluginsDir, { mode: this.discoveryMode }) : []
    const dataDir = app ? await this.applicationData(app) : null
    const previous = this.current
    this.phase = 'switching'; this.error = ''; this.notify()
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
        throw error
      }
      return { ...this.describe(), phase: 'idle' }
    } catch (error) { this.error = '打开应用失败：' + error.message; throw fail(error.status || 500, this.error) }
    finally { this.phase = 'idle'; this.notify() }
  }
  async close() {
    this.closed = true; await this.queue
    this.phase = 'stopping'; await Promise.allSettled([...this.inflight])
    await this.current?.close(); this.current = null
  }
}
