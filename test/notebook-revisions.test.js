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
import { treeRows } from '../applications/notebook/plugins/note-list/tree.js'

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
    if (method === 'DELETE') return notes.remove(path.slice(1), data.revision)
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

test('页面层级在本地预检，非法移动不污染草稿；删除父页同步提升子页的新版本', async t => {
  const f = await fixture(t), { model } = await f.page('hierarchy')
  const parent = model.current(), child = await model.create('plain', { title: '子页', parentId: parent.id })
  assert.equal(child.parentId, parent.id)
  await model.choose(parent.id)
  assert.throws(() => model.edit({ parentId: child.id }), /自身|子页面/)
  assert.equal(model.dirty, false)
  assert.equal(model.current().parentId, undefined)
  await model.remove()
  assert.equal(model.current().id, child.id)
  assert.equal(model.current().parentId, null)
  assert.equal(model.current().revision, 1)
  model.edit({ content: '父页删除后仍可保存' }); await model.flush()
  assert.equal(f.notes.list()[0].content, '父页删除后仍可保存')
})

test('另一页面删除父页后，旧子页草稿仍能另存为顶层副本', async t => {
  const f = await fixture(t), { model } = await f.page('orphan-parent')
  const child = await model.create('plain', { parentId: f.first.id, title: '子页' })
  model.edit({ content: '不能丢失的草稿' })
  await f.notes.remove(f.first.id)
  await assert.rejects(model.flush(), { status: 409 })
  await model.saveCopy()
  assert.equal(model.current().content, '不能丢失的草稿')
  assert.equal(model.current().parentId, null)
  assert.notEqual(model.current().id, child.id)
  assert.equal(f.notes.list().length, 2)
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

test('循环层级草稿保留正文与恢复入口，再次编辑刷新不会丢失冲突状态', async t => {
  const f = await fixture(t), parent = await f.notes.create({ fields: { title: 'B' } }), firstPage = await f.page('cycle')
  await firstPage.model.choose(f.first.id)
  firstPage.model.edit({ parentId: parent.id, content: '需要抢救的正文' })
  const originalDraft = f.backups.get('cycle')
  await firstPage.fiber.dispose()
  await f.notes.update(parent.id, { parentId: f.first.id })
  const saved = f.notes.list(), recovered = await f.page('cycle')
  assert.equal(recovered.model.current().content, '需要抢救的正文')
  assert.equal(recovered.model.current().parentId, null)
  assert.equal(recovered.model.conflict, true)
  assert.match(recovered.model.conflictMessage, /父页面关系.*另存/)
  assert.equal(treeRows(recovered.model.visible()).length, 2)
  assert.equal(f.backups.get('cycle'), originalDraft)
  await assert.rejects(recovered.model.flush(), { status: 409 })
  assert.deepEqual(f.notes.list(), saved)
  recovered.model.edit({ content: '恢复后继续完善的正文' })
  await recovered.fiber.dispose()
  const reopened = await f.page('cycle')
  assert.equal(reopened.model.conflict, true)
  assert.equal(reopened.model.current().content, '恢复后继续完善的正文')
  await assert.rejects(reopened.model.flush(), { status: 409 })
  const request = reopened.root.notesApi.request
  reopened.root.notesApi.request = (path, method, data) => method === 'POST' ? Promise.reject(Error('磁盘故障')) : request(path, method, data)
  await assert.rejects(reopened.model.saveCopy(), /磁盘故障/)
  assert.ok(f.backups.has('cycle'))
  assert.equal(reopened.model.conflict, true)
  reopened.root.notesApi.request = request
  await reopened.model.saveCopy()
  const copy = reopened.model.current()
  assert.notEqual(copy.id, f.first.id)
  assert.equal(copy.content, '恢复后继续完善的正文')
  assert.equal(copy.parentId, null)
  assert.equal(copy.__hierarchyConflict, undefined)
  assert.equal(reopened.model.conflict, false)
  assert.equal(f.backups.has('cycle'), false)
  assert.deepEqual(f.notes.list().filter(note => note.id !== copy.id), saved)
})

for (const kind of ['missing-parent', 'too-deep']) test('恢复草稿前校验整个树并允许另存副本：' + kind, async t => {
  const f = await fixture(t), root = await f.notes.create()
  let target = root
  if (kind === 'too-deep') for (let i = 0; i < 11; i++) target = await f.notes.create({ fields: { parentId: target.id } })
  const page = await f.page(kind)
  await page.model.choose(f.first.id)
  page.model.edit({ parentId: target.id, content: '完整正文' })
  await page.fiber.dispose()
  if (kind === 'missing-parent') await f.notes.remove(root.id)
  else { const higher = await f.notes.create(); await f.notes.update(root.id, { parentId: higher.id }) }
  const before = f.notes.list(), restored = await f.page(kind)
  assert.equal(restored.model.conflict, true)
  assert.equal(restored.model.current().parentId, null)
  assert.equal(treeRows(restored.model.visible()).length, before.length)
  await assert.rejects(restored.model.flush(), { status: 409 })
  await restored.model.saveCopy()
  assert.equal(restored.model.current().content, '完整正文')
  assert.equal(restored.model.current().parentId, null)
  assert.deepEqual(f.notes.list().filter(note => note.id !== restored.model.current().id), before)
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
