import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../client.js'
import { templateProject } from '../demo.js'

export const deferred = () => Promise.withResolvers()
export const settle = () => new Promise(resolve => setImmediate(resolve))

export function owner() {
  const cleanups = [], hooks = new Map()
  let disposed = false
  return {
    hooks,
    effect(callback) { const cleanup = callback(); cleanups.push(cleanup); return cleanup },
    on(name, callback) { hooks.set(name, callback); cleanups.push(() => hooks.delete(name)) },
    async dispose() {
      if (disposed) return
      disposed = true
      for (const cleanup of cleanups.reverse()) await cleanup?.()
    },
  }
}

// Only the transport and owner lifecycle are faked; the narrative service is real.
export async function setup(t, { template = 'hybrid', draft, preferred } = {}) {
  const window = new Window({ url: 'http://localhost/' })
  const previous = new Map(['window', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true, writable: true })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ctx = owner(), tools = new Map(), requests = [], toasts = [], control = {}
  const records = new Map([
    ['first', templateProject(template, '第一个故事', 'first')],
    ['second', templateProject('galgame', '第二个故事', 'second')],
  ])
  if (preferred) window.localStorage.setItem('current-project', preferred)
  if (draft) {
    const value = draft(structuredClone(records.get('first')))
    window.localStorage.setItem('draft:first', typeof value === 'string' ? value : JSON.stringify(value))
  }
  let engine
  const sdk = {
    storage: { local: window.localStorage, session: window.sessionStorage },
    toast: message => toasts.push(message),
    provide(name, service) { assert.equal(name, 'narrative'); engine = service },
    agent: { register(definition, callback) { tools.set(definition.name, callback) } },
    listen(target, event, callback) {
      target.addEventListener(event, callback)
      ctx.effect(() => () => target.removeEventListener(event, callback))
    },
    async request(path, method = 'GET', body) {
      const request = { path, method, body: structuredClone(body) }
      requests.push(request)
      await control.before?.(request)
      if (path === '/api/narrative/projects' && method === 'GET') {
        return [...records.values()].map(({ id, title, revision }) => ({ id, title, revision }))
      }
      if (path === '/api/narrative/projects' && method === 'POST') {
        const value = templateProject(body.template, body.title, 'created-' + records.size)
        records.set(value.id, value); return structuredClone(value)
      }
      if (path === '/api/narrative/import' && method === 'POST') {
        const value = { ...structuredClone(body), id: 'imported-' + records.size, revision: 0 }
        records.set(value.id, value); return structuredClone(value)
      }
      const id = decodeURIComponent(path.split('/').at(-1)), current = records.get(id)
      assert.ok(current, '未预期的请求：' + path)
      if (method === 'PUT') {
        assert.equal(body.id, current.id)
        assert.equal(body.revision, current.revision, '保存必须携带最新服务器版本')
        records.set(id, { ...structuredClone(body), revision: current.revision + 1 })
      } else assert.equal(method, 'GET')
      return structuredClone(records.get(id))
    },
  }
  t.after(async () => {
    await ctx.dispose()
    await window.happyDOM.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  await client(ctx, sdk)
  return { engine, ctx, sdk, window, records, requests, toasts, tools, control, puts: () => requests.filter(request => request.method === 'PUT') }
}
