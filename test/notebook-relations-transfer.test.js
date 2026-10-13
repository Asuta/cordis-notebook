import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { blockNoteDocument as blocks } from '../applications/notebook/plugins/format-blocknote/document.js'
import { treeRows } from '../applications/notebook/plugins/note-list/tree.js'
import { pageRelations, allowedParents } from '../applications/notebook/plugins/note-relations/relations.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-transfer-')), app = await createApp({ port: 0, dataDir: dir, file: join(dir, 'notes.json') })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const request = async (path, body) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  return { app, request }
}

test('父子页面拒绝循环、缺失父页和超过深度的子树移动，删除只提升直接子页且产生新版本', async t => {
  const { app } = await fixture(t), notes = app.ctx.notes
  const root = await notes.create({ fields: { title: '根页面' } })
  const child = await notes.create({ type: 'markdown', fields: { title: '子页面', parentId: root.id } })
  const grandchild = await notes.create({ type: 'blocknote', fields: { parentId: child.id } })
  const before = notes.list()
  await assert.rejects(notes.update(root.id, { parentId: grandchild.id }), /自身|子页面/)
  await assert.rejects(notes.create({ fields: { parentId: 'missing' } }), /不存在/)
  assert.deepEqual(notes.list(), before)
  let last = grandchild
  for (let i = 0; i < 10; i++) last = await notes.create({ fields: { parentId: last.id } })
  await assert.rejects(notes.create({ fields: { parentId: last.id } }), /12/)
  const outside = await notes.create()
  await assert.rejects(notes.update(root.id, { parentId: outside.id }), /12/)
  const removed = await notes.remove(child.id, 0)
  assert.equal(removed.reparented.length, 1)
  assert.equal(removed.reparented[0].id, grandchild.id)
  assert.equal(removed.reparented[0].parentId, root.id)
  assert.equal(removed.reparented[0].revision, 1)
  await assert.rejects(notes.update(grandchild.id, { title: '旧页修改' }, 0), { status: 409 })
})

test('完整备份在独立数据目录恢复图片、混合格式层级和页面引用；重复恢复不覆盖原件', async t => {
  const source = await fixture(t), target = await fixture(t), notes = source.app.ctx.notes
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg=='
  const { src } = await source.app.ctx.noteAssets.write(png)
  const parent = await notes.create({ type: 'plain', fields: { title: '父页', content: '保留原文' } })
  const paragraph = blocks.create('paragraph', '', 'text')
  paragraph.content = [{ type: 'pageLink', props: { noteId: parent.id, title: '父页' } }]
  await notes.create({ type: 'blocknote', fields: { title: '子页', parentId: parent.id, document: { version: 1, blocks: [paragraph, blocks.create('image', src, 'image')] } } })
  await notes.create({ type: 'markdown', fields: { title: '引用式图片', markdown: `![图片][image]\n\n[image]: ${src}\n\n\`![假图片](/api/note-assets/missing.png)\`` } })
  const before = notes.list(), exported = await source.request('/api/notebook-backup')
  assert.equal(exported.status, 200)
  assert.equal(exported.data.assets.length, 1)
  assert.equal(exported.data.assets[0].src, src)
  const restored = await target.request('/api/notebook-restore', exported.data)
  assert.equal(restored.status, 200, JSON.stringify(restored.data))
  assert.equal(restored.data.restored, 3)
  const importedParent = restored.data.notes.find(note => note.title === '父页'), importedChild = restored.data.notes.find(note => note.title === '子页')
  assert.notEqual(importedParent.id, parent.id)
  assert.equal(importedChild.parentId, importedParent.id)
  assert.deepEqual(target.app.ctx.noteFormats.references(importedChild), [importedParent.id])
  assert.equal((await target.app.ctx.noteAssets.read(src)).data, png)
  assert.deepEqual(notes.list(), before)
  assert.equal((await target.request('/api/notebook-restore', exported.data)).status, 200)
  assert.equal(new Set(target.app.ctx.notes.list().map(note => note.id)).size, 6)
})

test('无效备份整体拒绝，不部分导入；旧单页 JSON 脱离父页，缺失图片明确失败', async t => {
  const { app, request } = await fixture(t), note = await app.ctx.notes.create({ fields: { title: '保留' } })
  const backup = { format: 'cordis-notebook-backup', version: 1, notes: [note], assets: [] }
  for (const notes of [[note, note], [note, { ...note, id: 'unknown', type: 'not-installed' }], [{ ...note, parentId: 'missing' }], [{ ...note, parentId: note.id }]]) {
    assert.notEqual((await request('/api/notebook-restore', { ...backup, notes })).status, 200)
    assert.deepEqual(app.ctx.notes.list(), [note])
  }
  const image = blocks.create('image', '/api/note-assets/' + '0'.repeat(64) + '.png', 'image')
  const imageNote = { ...note, type: 'blocknote', document: { version: 1, blocks: [image] } }
  assert.equal((await request('/api/notebook-restore', { ...backup, notes: [imageNote] })).status, 400)
  assert.equal((await request('/api/notebook-restore', { ...backup, assets: [{ src: image.props.url, data: 'invalid' }] })).status, 400)
  assert.deepEqual(app.ctx.notes.list(), [note])
  const legacy = await request('/api/notebook-restore', { format: 'cordis-note', version: 1, note: { ...note, parentId: 'not-exported' } })
  assert.equal(legacy.status, 200)
  assert.equal(legacy.data.notes[0].parentId, null)
  assert.notEqual(legacy.data.notes[0].id, note.id)
})

test('磁盘图片损坏时备份及恢复明确失败，不返回不可用的成功备份', async t => {
  const { app, request } = await fixture(t)
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg=='
  const { src } = await app.ctx.noteAssets.write(png)
  await app.ctx.notes.create({ type: 'blocknote', fields: { document: { version: 1, blocks: [blocks.create('image', src, 'image')] } } })
  const backup = (await request('/api/notebook-backup')).data
  await writeFile(join(app.ctx.noteAssets.directory, src.split('/').at(-1)), 'corrupt')
  assert.equal((await request('/api/notebook-backup')).status, 400)
  assert.equal((await request('/api/notebook-restore', backup)).status, 409)
  assert.equal(app.ctx.notes.list().length, 1)
})

test('原生引用校验、重映射和反向引用按稳定 ID 工作；树筛选不隐藏结果', () => {
  const block = blocks.create('paragraph', '', 'paragraph')
  block.content = [{ type: 'pageLink', props: { noteId: 'parent', title: '旧名字' } }]
  const doc = blocks.normalize({ version: 1, blocks: [block] })
  assert.deepEqual(blocks.references(doc), ['parent'])
  assert.deepEqual(blocks.references(blocks.remapReferences(doc, { parent: 'copy' })), ['copy'])
  assert.equal(blocks.text(doc), '旧名字')
  assert.throws(() => blocks.normalize({ version: 1, blocks: [{ ...block, content: [{ type: 'pageLink', props: { noteId: '../invalid', title: 'x' } }] }] }))
  const notes = [{ id: 'child', parentId: 'parent', document: doc }, { id: 'parent', title: '新名字' }, { id: 'grandchild', parentId: 'child' }, { id: 'other' }]
  const formats = { references: note => note.document ? blocks.references(note.document) : [] }
  assert.equal(pageRelations(notes, 'parent', formats).backlinks[0].id, 'child')
  assert.equal(pageRelations(notes, 'child', formats).outgoing[0].title, '新名字')
  assert.equal(pageRelations(notes.slice(0, 1), 'child', formats).outgoing[0].missing, true)
  assert.deepEqual(allowedParents(notes, 'parent').map(note => note.id), ['other'])
  assert.deepEqual(treeRows(notes, { collapsed: new Set(['parent']) }).map(row => row.note.id), ['parent', 'other'])
  assert.deepEqual(treeRows(notes, { collapsed: new Set(['parent']), selected: 'grandchild' }).map(row => row.depth), [0, 1, 2, 0])
  assert.deepEqual(treeRows(notes.filter(note => note.id !== 'parent'), { filtered: true, collapsed: new Set(['child']) }).map(row => row.note.id), ['child', 'grandchild', 'other'])
})
