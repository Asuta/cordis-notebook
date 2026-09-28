import { spawn, fork } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'

export class ApplicationProcess {
  constructor({ root, dataDir, port }) { Object.assign(this, { root, dataDir, port }); this.logs = []; this.child = null; this.busy = false }
  log(text) { this.logs.push({ at: new Date().toISOString(), text: String(text).slice(-8000) }); if (this.logs.length > 100) this.logs.shift() }
  async status() {
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/api/applications`, { signal: AbortSignal.timeout(1500) })
      if (!response.ok) throw Error('应用响应异常')
      return { online: true, managed: !!this.child, state: await response.json(), logs: this.logs.slice(-30) }
    } catch { return { online: false, managed: !!this.child, logs: this.logs.slice(-30) } }
  }
  async start() {
    if ((await this.status()).online) return this.status()
    if (this.child) throw Error('应用进程尚未就绪，请稍后重试')
    const env = { ...process.env, PORT: String(this.port), DATA_DIR: this.dataDir }
    delete env.PLUGINS_DIR; delete env.APPLICATIONS_DIR; delete env.APP; delete env.DEEPSEEK_API_KEY
    const child = fork(join(this.root, 'server/server.js'), [], {
      cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    child.stdout.on('data', chunk => this.log(chunk)); child.stderr.on('data', chunk => this.log(chunk))
    child.on('error', error => this.log(error.message))
    child.on('exit', (code, signal) => { if (this.child === child) this.child = null; this.log(`应用进程退出：${code ?? signal}`) })
    for (let i = 0; i < 60; i++) {
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
    const timer = setTimeout(() => child.kill(), 5000)
    try { await ended } finally { clearTimeout(timer) }
  }
  async restart() {
    if (this.busy) throw Error('应用正在构建或重启')
    this.busy = true
    try { await this.stop(); return await this.start() } finally { this.busy = false }
  }
  async build(appId) {
    if (this.busy) throw Error('应用正在构建或重启')
    this.busy = true
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [join(this.root, 'scripts/build.js'), appId], { cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        const timer = setTimeout(() => child.kill(), 120000)
        const append = chunk => { output = (output + chunk).slice(-20000); this.log(chunk) }
        child.stdout.on('data', append); child.stderr.on('data', append)
        child.on('error', error => { clearTimeout(timer); reject(error) })
        child.on('exit', code => { clearTimeout(timer); resolve({ success: code === 0, code, output }) })
      })
    } finally { this.busy = false }
  }
}
