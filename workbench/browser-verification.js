import { fork } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeSnapshot } from './persistence.js'
import { usageError, validateBrowserInput } from './browser-contract.js'

/** A turn owns a sequence of isolated attempts; completed evidence is immutable. */
export class BrowserVerification {
  constructor({ root, appId, dataDir, signal, onChange = () => {}, workerFile = new URL('./browser-worker.js', import.meta.url) }) {
    Object.assign(this, { root, appId, dataDir, signal, onChange, workerFile })
    this.pending = new Map(); this.queue = Promise.resolve(); this.writes = Promise.resolve(); this.closed = false
    this.previousAttempts = []
    this.report = { id: randomUUID(), appId, status: 'not-run', steps: [], checks: [], errors: [], screenshots: [] }
    this.abort = () => { void this.close('stopped').catch(() => {}) }
    signal?.addEventListener('abort', this.abort, { once: true })
  }
  summary() { return { ...this.report, ...(this.previousAttempts.length ? { previousAttempts: this.previousAttempts } : {}),
    reportTool: 'browser_report', reportUrl: this.directory ? `/api/browser-artifacts/${this.report.id}/report.json` : undefined } }
  progress() {
    return { id: this.report.id, status: this.report.status, stepCount: this.report.steps.length,
      attempt: this.previousAttempts.length + 1, previousAttempts: this.previousAttempts.map(({ id, status, reportUrl }) => ({ id, status, reportUrl })),
      passedChecks: this.report.checks.filter(check => check.passed).length,
      failedChecks: this.report.checks.filter(check => !check.passed).length,
      usageErrors: this.report.steps.filter(step => step.errorKind === 'usage').length,
      operationErrors: this.report.steps.filter(step => step.errorKind === 'operation').length,
      infrastructureErrors: this.report.steps.filter(step => step.errorKind === 'infrastructure').length,
      pageErrors: this.report.errors.length, reportTool: 'browser_report',
      recentFailures: this.report.steps.filter(step => step.error).slice(-3).map(({ name, error, errorKind, diagnostics }) => ({ name, error: error.slice(0, 800), errorKind,
        ...(diagnostics ? { target: diagnostics.target, matchCount: diagnostics.matchCount } : {}) })),
      reportUrl: this.summary().reportUrl }
  }
  async save() {
    this.onChange(this.summary())
    if (!this.directory) return
    const snapshot = JSON.stringify(this.summary(), null, 2)
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
      message.error ? task.reject(Object.assign(Error(message.error), { kind: message.errorKind || 'infrastructure', diagnostics: message.diagnostics })) : task.resolve(message.result)
    })
    const reject = message => { for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(Error(message)) }; this.pending.clear() }
    child.on('error', error => reject(error.message))
    child.once('exit', () => { reject('浏览器验收进程已退出。' + logs); this.child = null })
  }
  rpc(method, input, timeout = method === 'open' ? 60000 : 20000) {
    if (!this.child?.connected || this.closed) return Promise.reject(Error('浏览器验收已停止'))
    return new Promise((resolve, reject) => {
      const id = randomUUID(), timer = setTimeout(() => {
        this.pending.delete(id); reject(Error('浏览器操作超时，实例已关闭'))
        void this.close('failed').catch(() => {})
      }, timeout)
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
  async perform(name, args, context = {}) {
    if (name === 'browser_report') { validateBrowserInput(name, args); return this.summary() }
    if (this.signal?.aborted) throw Error('浏览器验收已停止')
    if (this.closed && name !== 'browser_retest') throw Error('浏览器验收已停止；修复后用 browser_retest 开启独立复测')
    try { validateBrowserInput(name, args) }
    catch (error) {
      if (this.closed) throw error
      this.report.steps.push({ name, input: args, startedAt: Date.now(), endedAt: Date.now(), error: error.message, errorKind: 'usage' })
      await this.save(); throw error
    }
    if (name === 'browser_retest') return this.retest(args)
    if (name === 'browser_batch') return this.batch(args)
    if (name === 'browser_finish') {
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
      const failed = this.report.steps.some(step => step.error && step.errorKind !== 'usage') || this.report.errors.length || this.report.checks.some(check => !check.passed)
      this.report.gaps = []
      if (!this.report.checks.some(check => check.passed)) this.report.gaps.push('尚无成功断言')
      if (!this.report.screenshots.length) this.report.gaps.push('尚无验收截图')
      await this.close(failed || args.result === 'failed' ? 'failed'
        : this.report.gaps.length || args.result === 'incomplete' ? 'incomplete' : 'passed')
      return this.summary()
    }
    const step = { name, input: args, startedAt: Date.now(), ...context.metadata }; this.report.steps.push(step)
    const previousErrors = new Set(this.report.errors), checkCount = this.report.checks.length
    try {
      if (name === 'browser_action' && !this.child) {
        if (this.report.startedAt) throw Error('浏览器验收进程已退出')
        throw usageError('请先 browser_open')
      }
      await this.start()
      const result = await this.rpc(name === 'browser_open' ? 'open' : 'action', name === 'browser_open'
        ? { ...args, root: this.root, appId: this.appId, directory: this.directory } : args, context.timeout)
      if (this.closed) throw Error('浏览器验收已停止')
      this.report.errors = result.errors || []; this.report.checks = result.checks || []
      if (result.image) {
        const name = `${this.report.screenshots.length + 1}.jpg`
        await writeFile(join(this.directory, name), Buffer.from(result.image.data, 'base64'))
        const screenshot = { url: `/api/browser-artifacts/${this.report.id}/${name}`, at: Date.now() }
        this.report.screenshots.push(screenshot); result.screenshot = screenshot
      }
      step.endedAt = Date.now(); await this.save()
      return { ...result, errors: this.report.errors.filter(error => !previousErrors.has(error)),
        checks: this.report.checks.slice(checkCount), report: this.progress() }
    } catch (error) {
      step.error = error.message; step.errorKind = error.kind || 'infrastructure'; step.endedAt = Date.now()
      if (error.diagnostics) step.diagnostics = error.diagnostics
      if (!this.closed && step.errorKind !== 'usage') this.report.status = 'failed'
      await this.save()
      if (name === 'browser_open') await this.close('failed')
      if (error.diagnostics) error.message += '\n定位诊断：' + JSON.stringify(error.diagnostics)
      const { recentFailures, ...progress } = this.progress()
      error.message += '\n当前验收状态：' + JSON.stringify(progress) + '。完整步骤可直接调用 browser_report({}) 读取。'
      throw error
    }
  }
  async batch({ steps }) {
    const batchId = randomUUID(), results = [], deadline = Date.now() + 60000
    for (const [index, input] of steps.entries()) {
      let failure
      try {
        const remaining = deadline - Date.now()
        if (remaining <= 0) throw Error('批量操作达到 60 秒时限')
        const result = await this.perform('browser_action', input, { timeout: Math.min(20000, remaining), metadata: { batchId, batchIndex: index } })
        results.push(result)
        if (result.errors?.length) {
          failure = { error: '页面出现错误，批量操作已停止', errorKind: 'page', errors: result.errors }
          const step = this.report.steps.at(-1)
          step.error = failure.error; step.errorKind = 'page'; this.report.status = 'failed'
        }
      } catch (error) {
        failure = { error: error.message, errorKind: error.kind || 'infrastructure', ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) }
        if (!this.report.steps.some(step => step.batchId === batchId && step.batchIndex === index)) {
          this.report.steps.push({ name: 'browser_action', input, batchId, batchIndex: index, startedAt: Date.now(), endedAt: Date.now(), ...failure })
          this.report.status = 'failed'
        }
      }
      if (failure) {
        // Capture the stopped page without performing any remaining requested step.
        let snapshot = failure.diagnostics?.snapshot
        if (!snapshot && !this.closed && this.child) {
          try {
            const scene = await this.rpc('action', { action: 'snapshot' }, 10000)
            this.report.errors = scene.errors || this.report.errors; this.report.checks = scene.checks || this.report.checks
            snapshot = scene.snapshot
          } catch (error) { failure.snapshotError = error.message }
        }
        const step = this.report.steps.find(step => step.batchId === batchId && step.batchIndex === index)
        if (snapshot) { failure.snapshot = snapshot; step.diagnostics = { ...step.diagnostics, snapshot } }
        await this.save()
        return this.batchResult(results, { ok: false, batchId, total: steps.length, completed: index, stoppedAt: index + 1, failure })
      }
    }
    return this.batchResult(results, { ok: true, batchId, total: steps.length, completed: steps.length })
  }
  batchResult(results, status) {
    const image = results.findLast(result => result.image)?.image
    return { ...status, results: results.map(({ image, report, ...result }) => result), ...(image ? { image } : {}), report: this.progress() }
  }
  async retest({ reason, width, height }) {
    if (!this.report.startedAt || ['passed', 'stopped'].includes(this.report.status)) throw usageError('只有已开始但失败或未完成的验收可复测；已停止的任务不能复测')
    if (this.previousAttempts.length >= 4) throw usageError('本轮已达到 4 次复测上限；先检查失败原因')
    if (!this.closed) await this.perform('browser_finish', { result: 'incomplete', summary: this.report.summary || '开启独立复测前结束本次验收' })
    if (this.closing) await this.closing
    await this.writes
    this.signal?.throwIfAborted()
    const previous = this.summary()
    delete previous.previousAttempts
    this.previousAttempts.push(structuredClone(previous))
    this.report = { id: randomUUID(), appId: this.appId, status: 'not-run', attempt: this.previousAttempts.length + 1,
      previousAttemptId: previous.id, retryReason: reason, steps: [], checks: [], errors: [], screenshots: [] }
    this.closed = false; this.closing = null; this.child = null; this.directory = undefined
    this.signal?.addEventListener('abort', this.abort, { once: true })
    return this.perform('browser_open', { ...(width ? { width } : {}), ...(height ? { height } : {}) })
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
