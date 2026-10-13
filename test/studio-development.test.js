import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, cp, symlink, readdir, writeFile, appendFile, rm } from 'node:fs/promises'
import { resolve, join, basename, sep } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { startDevelopment } from '../scripts/dev.js'

test('八插件从源码启动，视图和 Pixel 更新不重启宿主，原画板与任务历史保留', { timeout: 45000 }, async t => {
  const workspace = resolve('.'), directory = await mkdtemp(join(workspace, 'studio-dev-test-'))
  const apps = join(directory, 'applications'), target = join(apps, 'studio'), dataDir = join(directory, 'data'), events = []
  let dev, calls = 0
  const upstream = createServer(async req => { for await (const chunk of req) {} calls++ })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await dev?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); assert.ok(directory.startsWith(workspace + sep)); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  await cp(resolve('applications/studio'), target, { recursive: true, filter: source => !['dist', 'node_modules'].includes(basename(source)) })
  for (const id of await readdir(join(target, 'plugins'))) {
    const modules = resolve('applications/studio/plugins', id, 'node_modules')
    try { await symlink(modules, join(target, 'plugins', id, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const legacy = join(dataDir, 'apps/studio/plugin-data/canvas')
  await mkdir(legacy, { recursive: true })
  // A local-only endpoint and credential prevent any paid external request.
  await writeFile(join(legacy, 'pixel-private.json'), JSON.stringify({ apiKey: 'local-test', model: 'mock', baseUrl: `http://127.0.0.1:${upstream.address().port}` }))
  dev = await startDevelopment({ port: 0, applicationsDir: apps, dataDir, cacheDir: join(directory, 'cache'), initialApplication: 'studio', dependencyFiles: [], onEvent: event => events.push(event) })
  const base = `http://127.0.0.1:${dev.vite.httpServer.address().port}`, pid = dev.backendPid
  const json = async path => { const response = await fetch(base + path); assert.equal(response.ok, true, await response.clone().text()); return response.json() }
  let before = await json('/api/studio')
  const catalog = await json('/api/plugins')
  assert.equal(catalog.plugins.length, 8)
  assert.ok(catalog.plugins.every(plugin => plugin.state === 'enabled'), JSON.stringify(catalog.plugins.map(p => ({ id: p.id, state: p.state, error: p.error }))))
  const sources = (await json('/__cordis/dev')).plugins.studio
  for (const entry of Object.values(sources)) if (entry.client) assert.equal((await fetch(base + entry.client)).status, 200)
  const eventually = async predicate => { const deadline = Date.now() + 15000; while (!predicate()) { if (Date.now() > deadline) assert.fail('插件更新超时：' + JSON.stringify(events)); await new Promise(r => setTimeout(r, 40)) } }
  const post = async (path, input) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': catalog.application.session }, body: JSON.stringify(input) })
    assert.equal(response.ok, true, await response.clone().text()); return response.json()
  }
  const edited = await post('/api/studio/edit', { boardId: before.boards[0].id, revision: 0, operations: [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '本机模拟请求' } }] })
  await post('/api/studio/generate', { boardId: edited.board.id, nodeId: 'g', revision: edited.board.revision, requestId: randomUUID() })
  await eventually(() => calls === 1)
  before = await json('/api/studio')
  for (const [id, file] of [['canvas-ui', 'client.js'], ['image-provider-pixel', 'pixel.js']]) {
    const after = events.length
    await appendFile(join(target, 'plugins', id, file), '\n// isolated hot-update verification\n')
    await eventually(() => events.slice(after).some(event => event.type === 'plugins' && event.targets?.studio?.includes(id)))
    assert.equal(dev.backendPid, pid)
    const current = await json('/api/studio')
    assert.deepEqual(current.boards, before.boards)
    if (id === 'canvas-ui') assert.deepEqual(current.jobs, before.jobs, '仅更新视图不能中断后台任务')
    else {
      assert.equal(current.jobs[0].id, before.jobs[0].id)
      assert.equal(current.jobs[0].status, 'interrupted')
      assert.match(current.jobs[0].error, /图片服务已停用或更新/)
    }
    assert.equal(current.providers[0].hasKey, true)
  }
  assert.equal(calls, 1, '恢复图片服务不能自动重发请求')
})
