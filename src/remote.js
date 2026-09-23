import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { killTree } from './process-utils.js'

export class Remote {
  constructor({ entry, dataDir, host, onCrash, log }) {
    this.calls = new Map(); this.children = new Set(); this.sequence = 0; this.stopping = false
    this.child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], { cwd: dataDir, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [] })
    this.child.stdout.on('data', chunk => log(chunk.toString())); this.child.stderr.on('data', chunk => log(chunk.toString()))
    this.exited = new Promise(resolve => this.child.once('exit', resolve))
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('插件启动超过 10 秒')), 10000)
      this.child.once('error', error => { clearTimeout(timer); reject(error) })
      this.child.on('message', async message => {
        if (message.type === 'ready') { clearTimeout(timer); resolve() }
        if (message.type === 'failed') { clearTimeout(timer); reject(new Error(message.error)) }
        if (message.type === 'child' && Number.isInteger(message.pid)) this.children.add(message.pid)
        if (message.type === 'child-exit') this.children.delete(message.pid)
        if (message.type === 'result') {
          const item = this.calls.get(message.id); if (!item) return
          this.calls.delete(message.id); clearTimeout(item.timer)
          message.error ? item.reject(new Error(message.error)) : item.resolve(message.result)
        }
        if (message.type === 'host') {
          try { const result = await host(message.method, message.args); if (this.child.connected) this.child.send({ type: 'host-result', id: message.id, result }) }
          catch (error) { if (this.child.connected) this.child.send({ type: 'host-result', id: message.id, error: error.message }) }
        }
      })
      this.child.once('exit', (code, signal) => {
        clearTimeout(timer); reject(new Error(`插件退出：${code ?? signal}`))
        for (const item of this.calls.values()) { clearTimeout(item.timer); item.reject(new Error('插件已退出')) }; this.calls.clear()
        const children = [...this.children]; this.children.clear(); Promise.all(children.map(killTree)).catch(() => {})
        if (!this.stopping) onCrash(`插件进程意外退出：${code ?? signal}`)
      })
    })
    this.child.send({ type: 'init', entry, dataDir })
  }
  call(method, args) {
    if (this.stopping || !this.child.connected) throw new Error('插件没有运行')
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error('插件调用超过 20 秒')) }, 20000)
      this.calls.set(id, { resolve, reject, timer }); this.child.send({ type: 'call', id, method, args })
    })
  }
  async stop() {
    this.stopping = true
    if (this.child.connected) this.child.send({ type: 'stop' })
    let timer
    await Promise.race([this.exited, new Promise(resolve => { timer = setTimeout(resolve, 2000) })]); clearTimeout(timer)
    if (this.child.exitCode === null && this.child.signalCode === null) await killTree(this.child.pid)
    await Promise.all([...this.children].map(killTree)); this.children.clear()
    for (const item of this.calls.values()) { clearTimeout(item.timer); item.reject(new Error('插件已停用')) }; this.calls.clear()
  }
}
