import { Context } from 'cordis'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { killTree } from './process-utils.js'

const root = new Context(), handlers = new Map(), children = new Set(), pending = new Map()
let sequence = 0, closing = false
const send = message => { if (process.connected) process.send(message) }
async function stop() {
  if (closing) return; closing = true
  await root.fiber.dispose()
  await Promise.all([...children].map(child => killTree(child.pid)))
}
process.on('disconnect', () => { stop().finally(() => process.exit()) })
process.on('message', async message => {
  try {
    if (message.type === 'init') {
      const sdk = {
        dataDir: message.dataDir,
        handle(name, handler) { if (handlers.has(name)) throw new Error('RPC 方法重复'); handlers.set(name, handler); return () => handlers.delete(name) },
        host(method, args) { const id = ++sequence; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('宿主调用超时')) }, 10000); pending.set(id, { resolve, reject, timer }); send({ type: 'host', id, method, args }) }) },
        spawn(command, args = [], options = {}) {
          const child = spawn(command, args, { ...options, windowsHide: true, detached: process.platform !== 'win32', stdio: options.stdio || 'pipe' })
          children.add(child); send({ type: 'child', pid: child.pid })
          child.once('exit', () => { children.delete(child); send({ type: 'child-exit', pid: child.pid }) })
          child.once('error', () => children.delete(child))
          return child
        },
        async exec(command, args = [], options = {}) {
          return new Promise((resolve, reject) => {
            const child = sdk.spawn(command, args, options); let stdout = '', stderr = '', size = 0
            const timer = setTimeout(() => { killTree(child.pid); reject(new Error('命令执行超时')) }, Math.min(options.timeout || 15000, 60000))
            const append = target => chunk => { size += chunk.length; if (size > 1024 * 1024) { killTree(child.pid); reject(new Error('命令输出超过 1 MB')) } else if (target === 'out') stdout += chunk; else stderr += chunk }
            child.stdout?.on('data', append('out')); child.stderr?.on('data', append('err'))
            child.once('error', error => { clearTimeout(timer); reject(error) })
            child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
          })
        },
      }
      const module = await import(pathToFileURL(message.entry).href)
      await root.plugin(async ctx => {
        const cleanup = await module.default(ctx, sdk)
        if (typeof cleanup === 'function') ctx.effect(() => cleanup)
        ctx.effect(() => async () => { handlers.clear(); await Promise.all([...children].map(child => killTree(child.pid))) })
      })
      send({ type: 'ready' })
    } else if (message.type === 'call') {
      if (closing) throw new Error('插件正在停止')
      const handler = handlers.get(message.method)
      if (!handler) throw new Error('插件方法不存在')
      send({ type: 'result', id: message.id, result: await handler(message.args) })
    } else if (message.type === 'host-result') {
      const item = pending.get(message.id); if (!item) return; pending.delete(message.id); clearTimeout(item.timer)
      message.error ? item.reject(new Error(message.error)) : item.resolve(message.result)
    } else if (message.type === 'stop') { await stop(); send({ type: 'stopped' }); process.exit() }
  } catch (error) { send({ type: message.type === 'init' ? 'failed' : 'result', id: message.id, error: error.message }) }
})
