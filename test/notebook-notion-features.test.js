import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { blockNoteDocument as blocks } from '../applications/notebook/plugins/format-blocknote/document.js'
import { applyOperations } from '../applications/notebook/plugins/blocknote-agent-tools/operations.js'
import { normalizeProperties } from '../applications/notebook/plugins/note-formats/properties.js'
import { queryRows } from '../applications/notebook/plugins/database-editor/query.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-notion-'))
  const app = await createApp({ port: 0, dataDir: dir, file: join(dir, 'notes.json') })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const url = 'http://127.0.0.1:' + app.server.address().port
  const request = async (path, data, method = 'POST') => {
    const res = await fetch(url + path, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    return { status: res.status, body: await res.json() }
  }
  return { app, url, request }
}

test('应用只注册五种现有格式，旧块页面的格式、编辑器和工具已移除', async t => {
  const { app } = await fixture(t)
  assert.deepEqual(app.ctx.noteFormats.list().map(format => format.type).sort(), ['blocknote', 'database', 'freeform', 'markdown', 'plain'])
  for (const id of ['format-block', 'block-editor', 'block-agent-tools']) assert.equal(app.manager.records.has(id), false)
  await assert.rejects(app.ctx.notes.create({ type: 'block' }), { status: 409 })
  assert.deepEqual(app.ctx.notes.list(), [])
})

test('新增块和行内公式通过 Agent 原子操作、搜索正文、格式校验；恶意属性拒绝', () => {
  const doc = { version: 1, blocks: [blocks.create('paragraph', '原文', 'p')] }
  const result = applyOperations(blocks, doc, [
    { op: 'insert', block: { id: 'callout', type: 'callout', text: '注意事项', props: { tone: 'warning' } } },
    { op: 'insert', block: { id: 'formula', type: 'equation', props: { expression: 'E=mc^2' } } },
    { op: 'insert', block: { id: 'toc', type: 'tableOfContents' } },
    { op: 'update', blockId: 'p', patch: { content: [{ type: 'math', props: { expression: 'x+y' } }] } },
  ])
  assert.match(blocks.text(result.document), /注意事项/); assert.match(blocks.text(result.document), /E=mc\^2/); assert.match(blocks.text(result.document), /x\+y/)
  assert.throws(() => applyOperations(blocks, doc, [{ op: 'insert', block: { type: 'callout', props: { tone: 'bad' } } }]))
  assert.throws(() => applyOperations(blocks, doc, [{ op: 'insert', block: { type: 'equation', props: { expression: 'x'.repeat(4097) } } }]))
  assert.throws(() => applyOperations(blocks, doc, [{ op: 'insert', block: { type: 'tableOfContents', text: '不能接受正文' } }]))
  assert.equal(doc.blocks.length, 1)
})

test('本地附件上传、范围播放、下载隔离、备份独立恢复和损坏校验', async t => {
  const source = await fixture(t), target = await fixture(t)
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2 * 1024 * 1024, 65)])
  const upload = await source.request('/api/note-files', { data: bytes.toString('base64'), extension: 'pdf' })
  assert.equal(upload.status, 200); const src = upload.body.src
  assert.deepEqual(Buffer.from(await (await fetch(source.url + src)).arrayBuffer()), bytes)
  const range = await fetch(source.url + src, { headers: { Range: 'bytes=0-7' } })
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 0-7/' + bytes.length)
  assert.equal(await range.text(), '%PDF-1.7')
  assert.equal((await fetch(source.url + src, { method: 'HEAD' })).headers.get('content-length'), String(bytes.length))
  assert.equal((await fetch(source.url + src, { headers: { Range: 'bytes=999999999-' } })).status, 416)
  assert.equal((await source.request('/api/note-files', { data: Buffer.from('<script>bad()</script>').toString('base64'), extension: 'pdf' })).status, 400)
  const generic = await source.request('/api/note-files', { data: Buffer.from('<html>附件</html>').toString('base64'), extension: 'bin' })
  const genericResponse = await fetch(source.url + generic.body.src)
  assert.equal(genericResponse.headers.get('content-type'), 'application/octet-stream')
  assert.equal(genericResponse.headers.get('content-disposition'), 'attachment')
  await source.app.ctx.notes.create({ type: 'blocknote', fields: { document: { version: 1, blocks: [blocks.create('file', src, 'file')] } } })
  const backup = (await source.request('/api/notebook-backup')).body
  assert.equal(backup.assets.length, 1)
  assert.equal((await target.request('/api/notebook-restore', backup)).status, 200)
  assert.deepEqual(Buffer.from(await (await fetch(target.url + src)).arrayBuffer()), bytes)
  const corrupted = structuredClone(backup); corrupted.assets[0].data = Buffer.from('%PDF-1.7\n坏附件').toString('base64')
  assert.equal((await target.request('/api/notebook-restore', corrupted)).status, 400)
  assert.equal(target.app.ctx.notes.list().length, 1)
})

test('数据库记录是真实页面，属性部分更新、并发冲突、历史回滚和完整备份都保留关系', async t => {
  const f = await fixture(t), notes = f.app.ctx.notes
  const db = await notes.create({ type: 'database', fields: { title: '项目任务' } })
  const row = await notes.create({ type: 'blocknote', fields: { title: '需求整理', parentId: db.id, properties: { tags: ['项目', '本周'], date: '2026-10-14' } } })
  assert.equal(row.properties.status, 'todo')
  const updated = await notes.update(row.id, { properties: { status: 'doing' } }, row.revision)
  assert.deepEqual(updated.properties.tags, ['项目', '本周'])
  await assert.rejects(notes.update(row.id, { properties: { status: 'done' } }, row.revision), { code: 'NOTE_REVISION_CONFLICT' })
  const [history] = notes.history(row.id)
  const restored = await notes.restoreVersion(row.id, history.id, updated.revision)
  assert.equal(restored.properties.status, 'todo'); assert.equal(restored.parentId, db.id)
  assert.equal(queryRows(notes.list(), db.id, { tag: '本周', from: '2026-10-13', to: '2026-10-15' }).length, 1)
  assert.equal(queryRows(notes.list(), db.id, { status: 'done' }).length, 0)
  const backup = (await f.request('/api/notebook-backup')).body
  const target = await fixture(t)
  assert.equal((await target.request('/api/notebook-restore', backup)).status, 200)
  const copyDB = target.app.ctx.notes.list().find(note => note.type === 'database'), copyRow = target.app.ctx.notes.list().find(note => note.title === '需求整理')
  assert.notEqual(copyDB.id, db.id); assert.equal(copyRow.parentId, copyDB.id); assert.deepEqual(copyRow.properties, restored.properties)
  await notes.remove(row.id, restored.revision)
  assert.equal(queryRows(notes.list(), db.id).length, 0)
  await notes.restoreTrash(notes.trash()[0].id)
  assert.equal(queryRows(notes.list(), db.id).length, 1)
  const plain = await notes.create()
  const withProps = await notes.update(plain.id, { properties: { status: 'done' } }, 0)
  await notes.restoreVersion(plain.id, notes.history(plain.id)[0].id, withProps.revision)
  assert.equal(notes.list().find(note => note.id === plain.id).properties, undefined)
})

test('状态、日期和标签校验；筛选组合与日期排序不改变源数据', () => {
  assert.deepEqual(normalizeProperties({ tags: ['工作', ' 工作 '] }).tags, ['工作'])
  for (const value of [{ date: '2026-02-30' }, { date: 'yesterday' }, { status: 'unknown' }, { tags: [''] }, { tags: ['x'.repeat(41)] }, { extra: true }]) assert.throws(() => normalizeProperties(value))
  const notes = [
    { id: 'a', title: '阿尔法', parentId: 'db', properties: { status: 'doing', tags: ['项目'], date: '2026-10-14' }, updatedAt: '2026-10-14' },
    { id: 'b', title: '贝塔', parentId: 'db', properties: { status: 'done', tags: ['项目'], date: null }, updatedAt: '2026-10-15' },
    { id: 'c', title: '丙', parentId: 'other', updatedAt: '2026-10-16' },
  ]
  assert.deepEqual(queryRows(notes, 'db', { query: '项目', status: 'doing', from: '2026-10-14' }).map(row => row.id), ['a'])
  assert.deepEqual(queryRows(notes, 'db', { sort: 'date' }).map(row => row.id), ['a', 'b'])
  assert.deepEqual(notes.map(row => row.id), ['a', 'b', 'c'])
})

test('恢复 API 强制校验 revision；恢复并未消耗历史，回收站不能重复恢复', async t => {
  const f = await fixture(t), note = await f.app.ctx.notes.create({ fields: { content: '原内容' } })
  await f.app.ctx.notes.update(note.id, { content: '新内容' }, 0)
  const [version] = (await f.request('/api/note-history/' + note.id)).body
  assert.equal((await f.request('/api/note-history/' + note.id + '/restore', { versionId: version.id })).status, 409)
  assert.equal((await f.request('/api/note-history/' + note.id + '/restore', { versionId: version.id, revision: 1 })).status, 200)
  await f.app.ctx.notes.remove(note.id, 2)
  const [deleted] = (await f.request('/api/note-trash')).body
  assert.equal((await f.request('/api/note-trash/' + deleted.id + '/restore', {})).status, 200)
  assert.equal((await f.request('/api/note-trash/' + deleted.id + '/restore', {})).status, 404)
})
