import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import plugin from '../server.js'

export const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export function context() {
  const cleanups = []
  return {
    effect(fn) { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) },
    on() {},
    async dispose() { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() },
  }
}
export async function listen(t, handler) {
  const server = createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch(error => { if (!res.destroyed) { res.statusCode = 500; res.end('fixture error: ' + error.message) } })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return { server, url: 'http://127.0.0.1:' + server.address().port }
}
export async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw Object.assign(Error('invalid JSON'), { status: 400 }) }
}
export async function provider(t, handler) {
  const calls = []
  const service = await listen(t, async (req, res) => {
    const body = await readBody(req)
    calls.push({ method: req.method, url: req.url, headers: req.headers, body })
    res.setHeader('Content-Type', 'application/json')
    await handler(req, res, body)
  })
  return { ...service, calls, settings: { baseUrl: service.url + '/v1', model: 'user-chosen-test-model', protocol: 'chat', apiKey: 'test-private-key' } }
}
export async function temporaryDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), 'narrative-ai-dialogue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}
export async function pluginServer(t) {
  const dataDir = await temporaryDirectory(t)
  const ctx = context(), routes = []
  ctx.http = {
    body: readBody,
    route(owner, method, pattern, handler) {
      const route = { method, pattern, handler }
      routes.push(route)
      owner.effect(() => () => routes.splice(routes.indexOf(route), 1))
    },
  }
  await plugin(ctx, {}, { dataDir })
  const service = await listen(t, async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const route = routes.find(item => item.method === req.method && item.pattern.test(pathname))
    try {
      if (!route) throw Object.assign(Error('not found'), { status: 404 })
      const value = await route.handler({ req, res, pathname, match: pathname.match(route.pattern) })
      if (!res.destroyed) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)) }
    } catch (error) {
      if (!res.destroyed) { res.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })) }
    }
  })
  t.after(() => ctx.dispose())
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(service.url + '/api/narrative/ai/' + path, {
      method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': 'test-session' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, value: await response.json() }
  }
  return { ...service, ctx, dataDir, request }
}
