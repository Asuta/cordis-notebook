import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { Notes } from '../applications/notebook/plugins/notes/server.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'
import { createApp } from '../server/server.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture(t) {
  const root = new Context(), backups = new Map(), errors = []
  t.after(() => root.fiber.dispose())
  await root.plugin(ctx => { Object.assign(new Service(ctx, 'storage'), { read: async () => [], write: async () => {} }) })
  await root.plugin(noteFormats); const serverFormat = root.plugin(formatPlain); await serverFormat
  const notes = new Notes(root); await notes.load()
  const first = await notes.create()
  await notes.update(first.id, { title: '原笔记', content: '原正文' })
  const api = { request: async (path, method, data) => {
    if (!method || method === 'GET') return notes.list()
    if (method === 'POST') return notes.create(data)
    if (method === 'PATCH') { const { revision, ...fields } = data; return notes.update(path.slice(1), fields, revision) }
    throw Error('未实现的测试接口')
  } }
  async function page(key) {
    let model
    const pageRoot = new Context()
    t.after(() => pageRoot.fiber.dispose())
    await pageRoot.plugin(noteFormats); await pageRoot.plugin(formatPlain)
    await pageRoot.plugin(ctx => { Object.assign(new Service(ctx, 'notesApi'), api) })
    const fiber = pageRoot.plugin({ inject: ['noteFormats', 'notesApi'], async apply(ctx) {
      model = await createNotebook(ctx, {
        provide(name, value) { const service = new Service(ctx, name); Object.defineProperties(service, Object.getOwnPropertyDescriptors(value)); return service },
        toast: text => errors.push(text),
      }, { storage: { getItem: () => backups.get(key), setItem: (_, value) => backups.set(key, value), removeItem: () => backups.delete(key) }, draftKey: key, autosaveMs: 60000 })
    } })
    await fiber
    return { model, fiber, root: pageRoot }
  }
  return { root, notes, first, api, page, backups, errors, serverFormat }
}

test('HTTP 强制服务端版本，旧页面及并发写入不能静默覆盖正文，旧文件可升级', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-revision-')), file = join(dir, 'notes.json')
  let app
  t.after(async () => { await app?.close(); await rm(dir, { recursive: true, force: true }) })
  await writeFile(file, JSON.stringify([{ id: 'old', title: '旧标题', content: '旧正文', pinned: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }]))
  app = await createApp({ port: 0, file })
  const request = body => fetch(`http://127.0.0.1:${app.server.address().port}/api/notes/old`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(app.ctx.notes.list()[0].revision, 0)
  const results = await Promise.all([request({ revision: 0, content: 'A 新正文' }), request({ revision: 0, title: 'B 标题', content: '旧正文' })])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal((await results.find(r => r.status === 409).json()).code, 'NOTE_REVISION_CONFLICT')
  const saved = app.ctx.notes.list()[0]
  assert.equal((await request({ content: '没有版本的旧页面' })).status, 409)
  assert.deepEqual(app.ctx.notes.list()[0], saved)
  await app.close(); app = await createApp({ port: 0, file })
  assert.deepEqual(app.ctx.notes.list()[0], saved)
})

test('两个页面发生冲突时保留草稿，另存副本保留双方内容', async t => {
  const f = await fixture(t), a = await f.page('a'), b = await f.page('b')
  a.model.edit({ content: 'A 的正文' }); await a.model.flush()
  b.model.edit({ title: 'B 的标题' })
  await assert.rejects(b.model.flush(), { status: 409, code: 'NOTE_REVISION_CONFLICT' })
  assert.equal(b.model.conflict, true)
  assert.equal(f.notes.list()[0].content, 'A 的正文')
  assert.ok(f.backups.has('b'))
  await b.model.saveCopy()
  assert.equal(b.model.conflict, false)
  assert.equal(f.notes.list().length, 2)
  assert.equal(f.notes.list().find(n => n.id === f.first.id).content, 'A 的正文')
  assert.equal(b.model.current().content, '原正文')
  assert.match(b.model.current().title, /B 的标题.*副本/)
  await b.model.choose(f.first.id)
  assert.equal(b.model.current().content, 'A 的正文')
})

test('服务端格式暂时不可用时保留草稿，格式恢复后可以重试保存', async t => {
  const f = await fixture(t), { model } = await f.page('a')
  model.edit({ content: '插件恢复后保存的正文' })
  const revision = model.current().revision
  await f.serverFormat.dispose()
  await assert.rejects(model.flush(), error => error.status === 409 && error.code === undefined)
  assert.equal(model.conflict, false)
  assert.equal(model.dirty, true)
  assert.match(model.status, /点击重试/)
  assert.equal(JSON.parse(f.backups.get('a')).content, '插件恢复后保存的正文')
  assert.equal(f.notes.list()[0].revision, revision)
  assert.equal(f.notes.list()[0].content, '原正文')
  await f.root.plugin(formatPlain)
  await model.flush()
  assert.equal(model.conflict, false)
  assert.equal(model.dirty, false)
  assert.equal(f.backups.has('a'), false)
  assert.equal(f.notes.list()[0].revision, revision + 1)
  assert.equal(f.notes.list()[0].content, '插件恢复后保存的正文')
})

test('旧草稿恢复不采用服务端新版本号，冲突仍可恢复为副本', async t => {
  const f = await fixture(t), a = await f.page('a')
  a.model.edit({ content: '本地旧草稿' }); await a.fiber.dispose()
  await f.notes.update(f.first.id, { content: '其他页的新版本' })
  const restored = await f.page('a')
  assert.equal(restored.model.current().content, '本地旧草稿')
  assert.equal(restored.model.conflict, true)
  await assert.rejects(restored.model.flush(), { status: 409 })
  assert.equal(f.notes.list()[0].content, '其他页的新版本')
})

test('保存期间继续输入继承成功写入的 revision，不制造自身冲突', async t => {
  const f = await fixture(t)
  const request = f.api.request, revisions = []
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  f.api.request = async (path, method, data) => {
    if (method === 'PATCH') { revisions.push(data.revision); if (revisions.length === 1) { entered(); await gate } }
    return request(path, method, data)
  }
  const { model } = await f.page('a')
  model.edit({ content: '第一版' }); const save = model.flush(); await started
  model.edit({ content: '第二版' }); release(); await save
  assert.deepEqual(revisions, [1, 2])
  assert.equal(model.current().revision, 3)
  assert.equal(model.dirty, false)
  assert.equal(f.notes.list()[0].content, '第二版')
})

test('缓存只读快照且保存状态通知不更新列表订阅，实际编辑仍更新', async t => {
  const f = await fixture(t), { model, root } = await f.page('a')
  const before = model.current(), list = model.visible()
  assert.equal(model.current(), before)
  assert.equal(model.visible()[0], list[0])
  let calls = 0
  model.observe(root, () => { calls++ }, { reasons: ['edit', 'selection', 'filters'] })
  model.notify(); await new Promise(r => setImmediate(r)); assert.equal(calls, 1)
  model.edit({ content: '新正文' }); await new Promise(r => setImmediate(r))
  assert.equal(calls, 2)
  assert.notEqual(model.current(), before)
  assert.equal(before.content, '原正文')
  assert.equal(model.visible()[0].content, '新正文')
})
