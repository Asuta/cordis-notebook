import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBlockDocument } from '../applications/notebook/plugins/format-block/document.js'
import { createBlockFormat } from '../applications/notebook/plugins/format-block/format.js'
import { moveBlock, indentBlock, cloneBlock } from '../applications/notebook/plugins/block-editor/tree.js'
import { documentService } from '../applications/notebook/plugins/rich-text/document.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'

const blocks = createBlockDocument(documentService)
const paragraph = (id, text, children = []) => ({ id, type: 'paragraph', body: documentService.plain(text, id), checked: false, collapsed: false, children })

test('块页面在当前宿主注册，保存重启后保留结构，格式恢复后可继续编辑', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-block-page-'))
  const file = join(dir, 'notes.json')
  let app
  try {
    app = await createApp({ port: 0, file })
    for (const type of ['plain', 'markdown', 'freeform', 'block']) assert.ok(app.ctx.noteFormats.get(type))
    const note = await app.ctx.notes.create({ type: 'block', title: '块页面恢复验收' })
    const document = { version: 1, blocks: [paragraph('root', '根块', [paragraph('child', '子块')])] }
    const saved = await app.ctx.notes.update(note.id, { document })
    assert.equal(saved.content, '根块\n子块')
    await app.close(); app = null
    app = await createApp({ port: 0, file })
    const restored = app.ctx.notes.list().find(n => n.id === note.id)
    assert.deepEqual(restored.document, saved.document)
    await app.manager.stop('format-block')
    assert.equal(app.ctx.noteFormats.get('block'), undefined)
    assert.deepEqual(app.ctx.notes.list().find(n => n.id === note.id).document, saved.document)
    await assert.rejects(app.ctx.notes.update(note.id, { document }), { status: 409 })
    await app.manager.start('format-block')
    assert.equal((await app.ctx.notes.update(note.id, { document })).content, '根块\n子块')
  } finally {
    if (app) await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('块页面格式拥有稳定 ID、嵌套正文和富文本往返转换', () => {
  const input = { version: 1, blocks: [paragraph('root', '根块', [paragraph('child', '子块')])] }
  const normalized = blocks.normalize(input)
  assert.equal(blocks.text(normalized), '根块\n子块')
  assert.deepEqual(blocks.fromEditor(blocks.toEditor(normalized)), normalized)
  const format = createBlockFormat(blocks)
  assert.equal(format.type, 'block')
  assert.deepEqual(format.normalize({ document: input }).document, normalized)
  assert.equal(format.toText({ document: normalized }), '根块\n子块')
})

test('块工厂可以创建空表格和已上传资源图片块', () => {
  const table = blocks.create('table')
  assert.equal(table.body.elements[0].kind, 'table')
  assert.equal(table.body.elements[0].children.length, 3)
  const image = blocks.create('image', '/api/note-assets/' + 'a'.repeat(64) + '.png')
  assert.equal(image.body.elements[0].kind, 'image')
  assert.throws(() => blocks.create('image'), /资源地址/)
})

test('块页面拒绝重复 ID、未知类型、过深层级和过大正文', () => {
  assert.throws(() => blocks.normalize({ version: 1, blocks: [paragraph('same', 'a'), paragraph('same', 'b')] }), /ID/)
  assert.throws(() => blocks.normalize({ version: 1, blocks: [{ ...paragraph('bad', 'x'), type: 'unknown' }] }), /类型/)
  let deep = paragraph('0', 'deep')
  for (let i = 1; i < 14; i++) deep = paragraph(String(i), 'deep', [deep])
  assert.throws(() => blocks.normalize({ version: 1, blocks: [deep] }), /12/)
  assert.throws(() => blocks.normalize({ version: 1, blocks: [paragraph('large', 'x'.repeat(200001))] }), /过长/)
})

test('块移动、嵌套、取消嵌套和复制都保留子树', () => {
  const root = [paragraph('a', 'a'), paragraph('b', 'b', [paragraph('b-child', 'child')]), paragraph('c', 'c')]
  const doc = { version: 1, blocks: root }
  assert.equal(moveBlock(doc, 'a', 'b', 'inside'), true)
  assert.deepEqual(doc.blocks.map(b => b.id), ['b', 'c'])
  assert.deepEqual(doc.blocks[0].children.map(b => b.id), ['b-child', 'a'])
  assert.equal(indentBlock(doc, 'c', 1), true)
  assert.deepEqual(doc.blocks.map(b => b.id), ['b'])
  assert.deepEqual(doc.blocks[0].children.map(b => b.id), ['b-child', 'a', 'c'])
  assert.equal(indentBlock(doc, 'c', -1), true)
  assert.deepEqual(doc.blocks.map(b => b.id), ['b', 'c'])
  const copy = cloneBlock(doc.blocks[0])
  assert.notEqual(copy.id, 'b')
  assert.notEqual(copy.children[0].id, 'b-child')
  assert.equal(copy.body.elements[0].id.startsWith(copy.id + ':'), true)
})
