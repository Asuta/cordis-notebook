import { fork } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeSnapshot } from './persistence.js'

/** One lazily created, isolated verification instance per turn. */
export class BrowserVerification {
  constructor({ root, appId, dataDir, signal, onChange = () => {}, workerFile = new URL('./browser-worker.js', import.meta.url) }) {
    Object.assign(this, { root, appId, dataDir, signal, onChange, workerFile })
    this.pending = new Map(); this.queue = Promise.resolve(); this.writes = Promise.resolve(); this.closed = false
    this.report = { id: randomUUID(), appId, status: 'not-run', steps: [], checks: [], errors: [], screenshots: [] }
    this.abort = () => { void this.close('stopped').catch(() => {}) }
    signal?.addEventListener('abort', this.abort, { once: true })
  }
  summary() { return { ...this.report, reportUrl: this.directory ? `/api/browser-artifacts/${this.report.id}/report.json` : undefined } }
  async save() {
    this.onChange(this.summary())
    if (!this.directory) return
    const snapshot = JSON.stringify(this.report, null, 2)
    this.writes = this.writes.catch(() => {}).then(() => writeSnapshot(join(this.directory, 'report.json'), snapshot))
    await this.writes
  }
  async start() {
    if (this.child) return
    this.directory = join(this.dataDir, 'browser', this.report.id)
    await mkdir(this.directory, { recursive: true })
    if (this.closed || this.signal?.aborted) throw Error('浏览器验收已停止')
    this.report.startedAt = Date.now(); this.report.status = 'running'; await this.save()
    if (this.closed || this.signal?.aborted) throw Error('浏览器验收已停止')
    const env = { ...process.env }; delete env.DEEPSEEK_API_KEY; delete env.PLUGINS_DIR; delete env.CORDIS_DEV
    const child = fork(this.workerFile, [], { cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    this.child = child; this.exited = new Promise(resolve => child.once('exit', resolve))
    let logs = ''
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-4000) })
    child.on('message', message => {
      const task = this.pending.get(message.id)
      if (!task) return
      this.pending.delete(message.id); clearTimeout(task.timer)
      if (message.errors) this.report.errors = message.errors
      if (message.checks) this.report.checks = message.checks
      message.error ? task.reject(Error(message.error)) : task.resolve(message.result)
    })
    const reject = message => { for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(Error(message)) }; this.pending.clear() }
    child.on('error', error => reject(error.message))
    child.once('exit', () => { reject('浏览器验收进程已退出。' + logs); this.child = null })
  }
  rpc(method, input) {
    if (!this.child?.connected || this.closed) return Promise.reject(Error('浏览器验收已停止'))
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => {
        this.pending.delete(id); reject(Error('浏览器操作超时，实例已关闭'))
        void this.close('failed').catch(() => {})
      }, method === 'open' ? 60000 : 20000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.send({ type: 'call', id, method, input }, error => {
        if (!error || !this.pending.delete(id)) return
        clearTimeout(timer); reject(error)
      })
    })
  }
  run(name, args = {}) {
    const task = this.queue.then(() => this.perform(name, args))
    this.queue = task.catch(() => {})
    return task
  }
  async perform(name, args) {
    if (this.closed || this.signal?.aborted) throw Error('浏览器验收已停止')
    if (name === 'browser_finish') {
      if (!['passed', 'failed'].includes(args.result) || typeof args.summary !== 'string' || !args.summary.trim()) throw Error('请提供验收结果与实际检查范围')
      this.report.summary = args.summary.slice(0, 2000)
      if (this.report.startedAt) {
        try {
          const result = await this.rpc('finish')
          if (this.closed) throw Error('浏览器验收已停止')
          this.report.errors = result.errors; this.report.checks = result.checks
        } catch (error) {
          if (this.closed) throw error
          this.report.errors.push(`无法收集最终验收状态：${error.message}`)
        }
      }
      const failed = this.report.steps.some(step => step.error) || this.report.errors.length || this.report.checks.some(check => !check.passed)
      const complete = this.report.checks.length > 0 && this.report.screenshots.length > 0
      if (!complete) this.report.errors.push('验收缺少成功断言或截图，不能判定通过')
      await this.close(args.result === 'passed' && !failed && complete ? 'passed' : 'failed')
      return this.summary()
    }
    if (!['browser_open', 'browser_action'].includes(name)) throw Error('未知浏览器工具')
    if (name === 'browser_action' && !this.child) throw Error('请先 browser_open')
    const step = { name, input: args, startedAt: Date.now() }; this.report.steps.push(step)
    try {
      await this.start()
      const result = await this.rpc(name === 'browser_open' ? 'open' : 'action', name === 'browser_open'
        ? { ...args, root: this.root, appId: this.appId, directory: this.directory } : args)
      if (this.closed) throw Error('浏览器验收已停止')
      this.report.errors = result.errors || []; this.report.checks = result.checks || []
      if (result.image) {
        const name = `${this.report.screenshots.length + 1}.jpg`
        await writeFile(join(this.directory, name), Buffer.from(result.image.data, 'base64'))
        const screenshot = { url: `/api/browser-artifacts/${this.report.id}/${name}`, at: Date.now() }
        this.report.screenshots.push(screenshot); result.screenshot = screenshot
      }
      step.endedAt = Date.now(); await this.save()
      return { ...result, report: this.summary() }
    } catch (error) {
      step.error = error.message; step.endedAt = Date.now()
      if (!this.closed) this.report.status = 'failed'
      await this.save()
      if (name === 'browser_open') await this.close('failed')
      throw error
    }
  }
  async close(status = 'incomplete') {
    if (this.closing) return this.closing
    this.closed = true; this.signal?.removeEventListener('abort', this.abort)
    this.closing = (async () => {
      const child = this.child
      if (child) {
        if (child.connected) child.send({ type: 'close' }, () => {})
        const timer = setTimeout(() => child.kill(), 5000)
        try { await this.exited } finally { clearTimeout(timer) }
      }
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(Error('浏览器验收已停止')) }; this.pending.clear()
      this.report.status = status === 'incomplete' && this.report.status === 'failed' ? 'failed' : status
      this.report.endedAt = Date.now(); await this.save()
      return this.summary()
    })()
    return this.closing
  }
}
