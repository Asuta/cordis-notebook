import { fork } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { release } from 'node:os'
import { describeExit, diagnosticReportArgs } from '../shared/diagnostics.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const defaultDiagnosticBytes = 4 * 1024 * 1024
const defaultDiagnosticPendingBytes = 1024 * 1024
const maxDiagnosticChunkBytes = 256 * 1024

function truncateDiagnostic(value, maxBytes) {
  const bytes = Buffer.from(value)
  if (bytes.length <= maxBytes) return value
  const suffix = Buffer.from('\n[输出已截断]\n')
  let content = bytes.subarray(0, Math.max(0, maxBytes - suffix.length))
  while (content.length && (content[content.length - 1] & 0xc0) === 0x80) content = content.subarray(0, -1)
  if (content.length && content[content.length - 1] >= 0xc0) content = content.subarray(0, -1)
  return Buffer.concat([content, suffix]).toString('utf8')
}

/** Runs the application either as the Vite development service or the built runtime. */
export class ApplicationProcess {
  constructor({ root, dataDir, diagnosticDir, port, commands, mode = 'runtime', env = {}, diagnosticMaxBytes = defaultDiagnosticBytes, diagnosticBackups = 3, diagnosticMaxPendingBytes = defaultDiagnosticPendingBytes }) {
    if (!['development', 'runtime'].includes(mode)) throw Error('未知应用运行模式：' + mode)
    Object.assign(this, { root, dataDir, port, commands, mode, env })
    this.logs = []; this.child = null; this.busy = false
    this.events = []; this.sequence = 0; this.pending = false; this.reloads = 0
    this.session = null; this.blocked = null; this.saving = null; this.reloadToken = undefined
    this.diagnosticDirectory = diagnosticDir || (dataDir ? join(dataDir, 'diagnostics') : null)
    this.diagnosticFile = null; this.diagnosticStream = null; this.lastDiagnostic = null
    this.diagnosticMaxBytes = Math.max(1024, Number(diagnosticMaxBytes) || defaultDiagnosticBytes)
    this.diagnosticBackups = Math.max(0, Math.min(10, Math.floor(Number(diagnosticBackups) || 0)))
    this.diagnosticMaxPendingBytes = Math.max(maxDiagnosticChunkBytes + 4096, Number(diagnosticMaxPendingBytes) || defaultDiagnosticPendingBytes)
    this.diagnosticBytes = 0; this.diagnosticQueue = Promise.resolve(); this.diagnosticQueuedBytes = 0
    this.diagnosticDroppedBytes = 0; this.diagnosticDroppedChunks = 0; this.diagnosticClosing = false
  }
  writeDiagnostic(channel, text) {
    if (!this.diagnosticStream || this.diagnosticClosing) return this.diagnosticQueue
    const at = new Date().toISOString()
    const value = String(text).replace(/\r/g, '')
    const payload = truncateDiagnostic(value.split('\n').filter(Boolean).map(line => `${at} [${channel}] ${line}\n`).join(''), maxDiagnosticChunkBytes)
    if (!payload) return this.diagnosticQueue
    const marker = this.diagnosticDroppedChunks
      ? `[诊断日志写入队列达到上限，已丢弃 ${this.diagnosticDroppedChunks} 段、${this.diagnosticDroppedBytes} 字节]\n`
      : ''
    const queued = marker + payload, queuedBytes = Buffer.byteLength(queued)
    if (this.diagnosticQueuedBytes + queuedBytes > this.diagnosticMaxPendingBytes) {
      const droppedBytes = Buffer.byteLength(payload)
      this.diagnosticDroppedChunks++; this.diagnosticDroppedBytes += droppedBytes
      return this.diagnosticQueue
    }
    this.diagnosticDroppedChunks = 0; this.diagnosticDroppedBytes = 0
    this.diagnosticQueuedBytes += queuedBytes
    const task = this.diagnosticQueue.then(() => this.writeDiagnosticChunk(queued))
    this.diagnosticQueue = task.catch(error => this.reportDiagnosticError(error)).finally(() => {
      this.diagnosticQueuedBytes = Math.max(0, this.diagnosticQueuedBytes - queuedBytes)
    })
    return this.diagnosticQueue
  }
  reportDiagnosticError(error) {
    this.logs.push({ at: new Date().toISOString(), text: `诊断日志写入失败：${error.message}` })
    this.diagnosticStream = null; this.diagnosticBytes = 0
  }
  async writeDiagnosticChunk(payload) {
    if (!this.diagnosticStream) return
    const bytes = Buffer.from(payload)
    let offset = 0
    while (offset < bytes.length && this.diagnosticStream) {
      if (this.diagnosticBytes >= this.diagnosticMaxBytes) await this.rotateDiagnostic()
      const stream = this.diagnosticStream
      if (!stream) return
      const size = Math.min(bytes.length - offset, this.diagnosticMaxBytes - this.diagnosticBytes)
      if (size <= 0) { await this.rotateDiagnostic(); continue }
      const chunk = bytes.subarray(offset, offset + size)
      await new Promise((resolve, reject) => stream.write(chunk, error => error ? reject(error) : resolve()))
      this.diagnosticBytes += size; offset += size
    }
  }
  async openDiagnosticStream(file, flags) {
    const stream = createWriteStream(file, { flags })
    stream.on('error', error => this.reportDiagnosticError(error))
    await new Promise((resolve, reject) => {
      stream.once('open', resolve)
      stream.once('error', reject)
    })
    this.diagnosticStream = stream
  }
  async endDiagnosticStream() {
    const stream = this.diagnosticStream
    this.diagnosticStream = null
    if (stream && !stream.destroyed) await new Promise(resolve => stream.end(resolve))
  }
  async rotateDiagnostic() {
    const file = this.diagnosticFile
    if (!file) return
    await this.endDiagnosticStream()
    if (this.diagnosticBackups === 0) await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
    else {
      await unlink(`${file}.${this.diagnosticBackups}`).catch(error => { if (error.code !== 'ENOENT') throw error })
      for (let index = this.diagnosticBackups - 1; index >= 1; index--) {
        await rename(`${file}.${index}`, `${file}.${index + 1}`).catch(error => { if (error.code !== 'ENOENT') throw error })
      }
      await rename(file, `${file}.1`).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    this.diagnosticBytes = 0
    await this.openDiagnosticStream(file, 'w')
  }
  flushDiagnostic() {
    return this.diagnosticQueue
  }
  log(text) {
    const value = String(text)
    this.logs.push({ at: new Date().toISOString(), text: value.slice(-8000) }); if (this.logs.length > 100) this.logs.shift()
    this.writeDiagnostic('output', value)
  }
  async openDiagnostic(session) {
    if (!this.diagnosticDirectory) return
    try {
      await mkdir(this.diagnosticDirectory, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      this.diagnosticFile = join(this.diagnosticDirectory, `application-${stamp}-${session.slice(0, 8)}.log`)
      this.diagnosticBytes = await stat(this.diagnosticFile).then(info => info.size, error => { if (error.code === 'ENOENT') return 0; throw error })
      await this.openDiagnosticStream(this.diagnosticFile, 'a')
      this.writeDiagnostic('session', JSON.stringify({ event: 'application-start', mode: this.mode, port: this.port, node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, osRelease: release(), execArgv: process.execArgv }))
      try {
        const files = (await readdir(this.diagnosticDirectory)).filter(name => /^application-.*\.log(?:\.\d+)?$/.test(name)).sort().reverse()
        await Promise.all(files.slice(30).map(name => unlink(join(this.diagnosticDirectory, name)).catch(() => {})))
      } catch {}
    } catch (error) {
      this.logs.push({ at: new Date().toISOString(), text: `诊断日志初始化失败：${error.message}` })
      await this.endDiagnosticStream().catch(() => {})
    }
  }
  async closeDiagnostic() {
    this.diagnosticClosing = true
    await this.diagnosticQueue.catch(() => {})
    await this.endDiagnosticStream().catch(() => {})
    this.diagnosticClosing = false
  }
  receive(message) {
    if (message?.type === 'cordis-diagnostic') {
      this.lastDiagnostic = { ...message, receivedAt: new Date().toISOString() }
      this.writeDiagnostic('heartbeat', JSON.stringify(this.lastDiagnostic))
      return
    }
    if (message?.type !== 'cordis-dev' || !message.event) return
    const event = message.event
    this.writeDiagnostic('event', JSON.stringify(event))
    if (event.type === 'busy') { this.pending = true; return }
    if (event.type === 'idle') { this.pending = false; return }
    if (event.type === 'blocked') this.blocked = event
    if (event.type === 'save-progress') this.saving = event
    if (event.type === 'save-result') this.saving = event.status === 'failed' ? event : null
    if (event.type === 'unblocked' || event.type === 'ready') this.blocked = null
    if (['unblocked', 'ready', 'noop'].includes(event.type)) this.saving = null
    // A reload replaces the bound page; the workbench rebinds the running task.
    if (event.type === 'reload') { this.reloads++; this.reloadToken = event.reloadToken }
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
    if (this.diagnosticDirectory) env.CORDIS_DIAGNOSTICS_DIR = this.diagnosticDirectory
    await this.openDiagnostic(this.session)
    const entry = this.mode === 'development' ? 'scripts/dev.js' : 'server/server.js'
    const execArgv = diagnosticReportArgs(this.diagnosticDirectory)
    const child = fork(join(this.root, entry), [], {
      cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      execArgv,
    })
    this.child = child; this.pending = false; this.blocked = null; this.saving = null
    const startedAt = Date.now()
    this.writeDiagnostic('session', JSON.stringify({ event: 'child-spawned', pid: child.pid, execArgv, diagnosticFile: this.diagnosticFile }))
    child.stdout.on('data', chunk => this.log(chunk)); child.stderr.on('data', chunk => this.log(chunk))
    child.on('message', message => this.receive(message))
    child.on('error', error => this.log(error.message))
    child.on('exit', (code, signal) => {
      if (this.child === child) { this.child = null; this.pending = false; this.blocked = null; this.saving = null; this.session = null }
      this.log(`应用进程退出：${describeExit(code, signal)}`)
      this.log(JSON.stringify({ event: 'application-exit', code, signal, uptimeMs: Date.now() - startedAt, lastDiagnostic: this.lastDiagnostic, diagnosticFile: this.diagnosticFile, recentEvents: this.events.slice(-20) }))
      void this.closeDiagnostic()
    })
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
