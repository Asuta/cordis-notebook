import { fork } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Runs the application either as the Vite development service or the built runtime. */
export class ApplicationProcess {
  constructor({ root, dataDir, port, commands, mode = 'runtime', env = {} }) {
    if (!['development', 'runtime'].includes(mode)) throw Error('未知应用运行模式：' + mode)
    Object.assign(this, { root, dataDir, port, commands, mode, env })
    this.logs = []; this.child = null; this.busy = false
    this.events = []; this.sequence = 0; this.pending = false; this.reloads = 0
    this.session = null; this.blocked = null; this.saving = null
  }
  log(text) { this.logs.push({ at: new Date().toISOString(), text: String(text).slice(-8000) }); if (this.logs.length > 100) this.logs.shift() }
  receive(message) {
    if (message?.type !== 'cordis-dev' || !message.event) return
    const event = message.event
    if (event.type === 'busy') { this.pending = true; return }
    if (event.type === 'idle') { this.pending = false; return }
    if (event.type === 'blocked') this.blocked = event
    if (event.type === 'save-progress') this.saving = event
    if (event.type === 'save-result') this.saving = event.status === 'failed' ? event : null
    if (event.type === 'unblocked' || event.type === 'ready') this.blocked = null
    if (['unblocked', 'ready', 'noop'].includes(event.type)) this.saving = null
    // A reload replaces the bound page; the workbench rebinds the running task.
    if (event.type === 'reload') this.reloads++
    this.events.push({ ...event, seq: ++this.sequence, at: new Date().toISOString() })
    if (this.events.length > 50) this.events.shift()
  }
  /** Wait until a recent source edit has been noticed and processed by Vite. */
  async settle({ delay = 500, timeout = 30000 } = {}) {
    if (this.mode !== 'development' || !this.child) return
    await sleep(delay)
    const end = Date.now() + timeout
    while (this.pending && this.child && Date.now() < end) await sleep(100)
  }
  async status() {
    const elapsed = round => round && { ...round, clients: round.clients?.map(client => ({ ...client, elapsedMs: round.startedAt ? Date.now() - round.startedAt : client.elapsedMs })) }
    const development = this.mode === 'development' ? { pending: this.pending, blocked: elapsed(this.blocked), saving: elapsed(this.saving), events: this.events.slice(-20) } : undefined
    try {
      if (this.mode === 'development') {
        const response = await fetch(`http://127.0.0.1:${this.port}/__cordis/identity`, { signal: AbortSignal.timeout(1500) })
        const identity = response.ok ? await response.json().catch(() => null) : null
        if (!this.child || !this.session || identity?.session !== this.session || identity?.pid !== this.child.pid || identity?.mode !== 'development') {
          return { online: false, mode: 'external', requestedMode: this.mode, managed: false,
            error: `端口 ${this.port} 被其他服务占用，无法启用工作台热更新。请停止原服务或修改 WORKBENCH_APP_PORT。`, logs: this.logs.slice(-30) }
        }
      }
      const response = await fetch(`http://127.0.0.1:${this.port}/api/applications`, { signal: AbortSignal.timeout(1500) })
      if (!response.ok) throw Error('应用响应异常')
      return { online: true, mode: this.mode, managed: !!this.child, state: await response.json(), logs: this.logs.slice(-30), ...(development ? { development } : {}) }
    } catch { return { online: false, mode: this.mode, managed: !!this.child, logs: this.logs.slice(-30), ...(development ? { development } : {}) } }
  }
  async start() {
    const current = await this.status()
    if (current.mode === 'external') throw Error(current.error)
    if (current.online) return current
    if (this.child) throw Error('应用进程尚未就绪，请稍后重试')
    const env = { ...process.env, PORT: String(this.port), DATA_DIR: this.dataDir }
    delete env.PLUGINS_DIR; delete env.APPLICATIONS_DIR; delete env.APP; delete env.DEEPSEEK_API_KEY
    Object.assign(env, this.env)
    this.session = randomUUID()
    env.CORDIS_DEV_SESSION = this.session
    const entry = this.mode === 'development' ? 'scripts/dev.js' : 'server/server.js'
    const child = fork(join(this.root, entry), [], {
      cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child; this.pending = false; this.blocked = null; this.saving = null
    child.stdout.on('data', chunk => this.log(chunk)); child.stderr.on('data', chunk => this.log(chunk))
    child.on('message', message => this.receive(message))
    child.on('error', error => this.log(error.message))
    child.on('exit', (code, signal) => { if (this.child === child) { this.child = null; this.pending = false; this.blocked = null; this.saving = null; this.session = null }; this.log(`应用进程退出：${code ?? signal}`) })
    // The development service compiles every backend before it listens.
    for (let i = 0; i < 150; i++) {
      await new Promise(resolve => setTimeout(resolve, 200))
      const status = await this.status(); if (status.online) return status
      if (!this.child) break
    }
    throw Error('应用启动失败；请查看工作台日志')
  }
  async stop() {
    const child = this.child
    if (!child) { if ((await this.status()).online) throw Error('当前服务不是本工作台启动的，不能代替它重启'); return }
    const ended = once(child, 'exit')
    if (child.connected) child.send({ type: 'workbench-shutdown' }); else child.kill()
    // Development shutdown waits for a queued update, including a page save.
    const timer = setTimeout(() => child.kill(), this.mode === 'development' ? 20000 : 5000)
    try { await ended } finally { clearTimeout(timer) }
  }
  async restart() {
    if (this.busy) throw Error('应用正在构建或重启')
    this.busy = true
    try { await this.stop(); return await this.start() } finally { this.busy = false }
  }
  async build(appId, owner, args = {}) {
    if (this.busy) throw Error('应用正在构建或重启')
    this.busy = true
    let started = false
    try {
      return await this.commands.start(owner, { command: `node scripts/build.js ${appId}`, workdir: this.root, yield_time_ms: args.yield_time_ms },
        { file: process.execPath, args: [join(this.root, 'scripts/build.js'), appId], onStart: () => { started = true }, onExit: () => { this.busy = false } })
    } catch (error) { if (!started) this.busy = false; throw error }
  }
  async test(appId, owner, { plugins, yield_time_ms } = {}) {
    if (!Array.isArray(plugins) || !plugins.length || plugins.some(id => !/^[a-z][a-z0-9-]{1,49}$/.test(id))) throw Error('请提供有效插件 ID 数组')
    if (this.busy) throw Error('应用正在构建或验证')
    this.busy = true
    let started = false
    const args = [join(this.root, 'scripts/test-plugin.js'), '--app', appId, ...plugins.flatMap(id => ['--plugin', id])]
    try {
      return await this.commands.start(owner, { command: `pnpm test:plugin --app ${appId} ${plugins.map(id => '--plugin ' + id).join(' ')}`, workdir: this.root, yield_time_ms },
        { file: process.execPath, args, onStart: () => { started = true }, onExit: () => { this.busy = false } })
    } catch (error) { if (!started) this.busy = false; throw error }
  }
}
