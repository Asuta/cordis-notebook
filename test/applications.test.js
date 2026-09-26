import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Window } from 'happy-dom'
import { createApp, createHost } from '../server/server.js'
import { discoverApplications } from '../server/application-discovery.js'
import { applicationStorage } from '../client/host/application-storage.js'
import { exportApplication } from '../scripts/export-application.js'

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-applications-'))
  t.after(() => rm(dir, { recursive: true, force: true })); return dir
}
const request = (app, path, method = 'GET', data, session = app.applications.session) => fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
  method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': session }, body: data === undefined ? undefined : JSON.stringify(data),
})

test('应用独立插件目录、配置和数据，旧笔记复制迁移，切换与重启均恢复', async t => {
  const dir = await temporary(t)
  const legacy = await createApp({ port: 0, dataDir: dir })
  const note = await legacy.ctx.notes.create()
  await legacy.ctx.notes.update(note.id, { title: '原有笔记' })
  await legacy.manager.toggle('search', false)
  await legacy.close()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==', 'base64')
  const asset = createHash('sha256').update(png).digest('hex') + '.png'
  await mkdir(join(dir, 'note-assets'), { recursive: true }); await writeFile(join(dir, 'note-assets', asset), png)
  const original = await readFile(join(dir, 'notes.json'), 'utf8')
  let app = await createHost({ port: 0, dataDir: dir })
  try {
    assert.equal(app.applications.current.app.id, 'notebook')
    assert.equal(app.ctx.notes.list()[0].title, '原有笔记')
    assert.equal(app.manager.records.get('search').enabled, false)
    assert.equal(await readFile(join(dir, 'apps/notebook/notes.json'), 'utf8'), original)
    assert.deepEqual(Buffer.from(await (await request(app, '/api/note-assets/' + asset)).arrayBuffer()), png)
    assert.equal((await request(app, '/api/notes', 'POST', {}, '')).status, 409)
    await app.ctx.notes.update(note.id, { title: '迁移后更新' })
    const oldCtx = app.ctx, oldSession = app.applications.session
    const switched = await request(app, '/api/applications/switch', 'POST', { id: 'drawing', session: oldSession })
    assert.equal(switched.status, 200); assert.equal((await switched.json()).phase, 'idle')
    assert.equal(oldCtx.get('notes'), undefined)
    assert.equal(app.ctx.get('notes'), undefined)
    assert.deepEqual([...app.manager.records.keys()], ['storage', 'canvas'])
    assert.equal((await request(app, '/api/notes')).status, 404)
    assert.equal((await request(app, '/api/plugins/storage/toggle', 'POST', { enabled: false }, oldSession)).status, 409)
    assert.equal((await request(app, '/builtin/canvas/client.js?appSession=' + oldSession, 'GET', undefined, '')).status, 409)
    assert.equal(app.manager.records.get('storage').enabled, true)
    const drawing = { title: '独立画作', strokes: [{ color: '#7260ad', width: 6, points: [[0.1, 0.2], [0.7, 0.8]] }], revision: 0 }
    assert.equal((await request(app, '/api/drawing', 'POST', drawing)).status, 200)
    assert.equal((await request(app, '/api/drawing', 'POST', drawing)).status, 409)
    const config = await app.manager.settings.begin('canvas', { brushSize: 18 }, 0)
    await app.manager.settings.finish(config.pendingConfig.token, true)
    await app.applications.switch('notebook', app.applications.session)
    assert.equal(app.ctx.notes.list()[0].title, '迁移后更新')
    assert.equal(app.manager.records.get('search').enabled, false)
    assert.equal(app.ctx.get('drawingStorage'), undefined)
    await app.applications.switch('drawing', app.applications.session)
    await app.close(); app = await createHost({ port: 0, dataDir: dir })
    assert.equal(app.applications.current.app.id, 'drawing')
    assert.equal(app.ctx.drawingStorage.read().title, '独立画作')
    assert.equal(app.manager.settings.describe(app.manager.records.get('canvas')).config.brushSize, 18)
    assert.equal(await readFile(join(dir, 'notes.json'), 'utf8'), original)
    assert.deepEqual(await readFile(join(dir, 'note-assets', asset)), png)
  } finally { await app.close() }
})

test('切换等待旧请求结束，并拒绝切换期间请求和过期切换', async t => {
  const app = await createHost({ port: 0, dataDir: await temporary(t) })
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), start = new Promise(resolve => { entered = resolve })
  try {
    app.ctx.http.route(app.ctx, 'POST', /^\/api\/slow$/, async () => { entered(); await gate; return { ok: true } })
    const session = app.applications.session
    const slow = request(app, '/api/slow', 'POST', {})
    await start
    const switching = app.applications.switch('drawing', session)
    while (app.applications.phase !== 'switching') await new Promise(resolve => setImmediate(resolve))
    assert.equal(app.applications.current.app.id, 'notebook')
    assert.equal((await request(app, '/api/notes', 'POST', {})).status, 409)
    release(); assert.equal((await slow).status, 200); await switching
    await assert.rejects(app.applications.switch('notebook', session), /状态已变化/)
    assert.equal(app.applications.current.app.id, 'drawing')
  } finally { release(); await app.close() }
})

test('未完成的配置确认阻止切换，关闭应用后重启仍保持关闭', async t => {
  const dir = await temporary(t); let app = await createHost({ port: 0, dataDir: dir })
  try {
    const pending = await app.manager.settings.begin('stats', { includeWhitespace: true }, 0)
    await assert.rejects(app.applications.switch('drawing', app.applications.session), /未完成的配置/)
    assert.equal(app.applications.current.app.id, 'notebook')
    await app.manager.settings.finish(pending.pendingConfig.token, false, '取消测试设置')
    await app.applications.switch(null, app.applications.session)
    assert.equal(app.manager, undefined)
    assert.equal((await request(app, '/api/notes')).status, 404)
    assert.deepEqual((await (await request(app, '/api/plugins')).json()).plugins, [])
    await app.close(); app = await createHost({ port: 0, dataDir: dir })
    assert.equal(app.applications.current, null)
    assert.equal((await request(app, '/')).status, 200)
  } finally { await app.close() }
})

test('应用目录扫描不读取插件，坏插件预检不停止当前应用，激活失败恢复上一应用', async t => {
  const root = await temporary(t), applicationsDir = join(root, 'applications')
  await mkdir(applicationsDir)
  async function define(id, server, valid = true) {
    const folder = join(applicationsDir, id); await mkdir(join(folder, 'plugins/sample/dist'), { recursive: true })
    await writeFile(join(folder, 'package.json'), JSON.stringify({ cordisApp: { id, name: id, default: id === 'good' } }))
    await writeFile(join(folder, 'plugins/sample/package.json'), valid ? JSON.stringify({ name: `@${id}/sample`, version: '1.0.0', type: 'module', cordis: {
      schemaVersion: 1, id: 'sample', name: 'sample', defaultEnabled: true, server: { entry: 'server.js', export: 'default' }, requires: { server: [], client: [] }, provides: { server: [], client: [] }, public: [],
    } }) : '{broken')
    await writeFile(join(folder, 'plugins/sample/dist/server.js'), server)
  }
  await define('good', 'export default ()=>{}')
  await define('broken', 'throw Error("不应执行")', false)
  await define('crash', 'export default ()=>{throw Error("模拟激活失败")}')
  assert.equal((await discoverApplications(applicationsDir)).length, 3)
  const app = await createHost({ port: 0, dataDir: join(root, 'data'), applicationsDir })
  try {
    const session = app.applications.session
    await assert.rejects(app.applications.switch('broken', session), /清单无效/)
    assert.equal(app.applications.session, session)
    assert.equal(app.applications.current.app.id, 'good')
    await assert.rejects(app.applications.switch('crash', session), /模拟激活失败/)
    assert.equal(app.applications.current.app.id, 'good')
    assert.equal(app.manager.records.get('sample').state, 'enabled')
    assert.equal(app.applications.phase, 'idle')
    assert.notEqual(app.applications.session, session)
  } finally { await app.close() }
  const exported = await exportApplication('good', join(root, 'release'), applicationsDir)
  const isolated = await createHost({ port: 0, dataDir: join(root, 'export-data'), applicationsDir: exported })
  try {
    assert.equal(isolated.applications.current.app.id, 'good')
    assert.equal(isolated.manager.records.get('sample').state, 'enabled')
    assert.equal(isolated.applications.describe().applications.length, 1)
    await assert.rejects(readFile(join(exported, 'good/plugins/sample/server.js')), { code: 'ENOENT' })
  } finally { await isolated.close() }
})

test('浏览器存储按应用与插件区分，清理只影响自己的空间', async () => {
  const window = new Window(), raw = window.localStorage
  try {
    raw.setItem('old-draft', '原始草稿')
    const a = applicationStorage(raw, 'notebook', 'editor'), b = applicationStorage(raw, 'drawing', 'editor'), c = applicationStorage(raw, 'notebook', 'layout')
    a.setItem('draft', '笔记'); b.setItem('draft', '画作'); c.setItem('draft', '布局')
    assert.equal(a.getItem('draft'), '笔记'); assert.equal(b.getItem('draft'), '画作')
    assert.equal(a.length, 1); assert.equal(a.key(0), 'draft'); assert.equal(a.key(1), null)
    a.clear(); assert.equal(a.getItem('draft'), null)
    assert.equal(b.getItem('draft'), '画作'); assert.equal(c.getItem('draft'), '布局'); assert.equal(raw.getItem('old-draft'), '原始草稿')
  } finally { await window.happyDOM.close() }
})

test('单目录开发入口不读取全局应用选择，空应用目录仍可进入恢复界面', async t => {
  const root = await temporary(t)
  await writeFile(join(root, 'applications-state.json'), JSON.stringify({ active: 'drawing' }))
  const standalone = await createApp({ port: 0, dataDir: root })
  try { assert.equal(standalone.applications.current.app.id, 'standalone'); assert.ok(standalone.ctx.notes) }
  finally { await standalone.close() }
  const empty = join(root, 'empty'); await mkdir(empty)
  const host = await createHost({ port: 0, dataDir: join(root, 'empty-data'), applicationsDir: empty })
  try {
    assert.equal(host.applications.current, null)
    assert.equal((await request(host, '/')).status, 200)
    assert.deepEqual(host.applications.describe().applications, [])
    assert.equal((await request(host, '/api/applications/switch', 'POST', { session: host.applications.session })).status, 400)
  } finally { await host.close() }
})
