import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { snapshotNote } from '../applications/notebook/plugins/note-formats/note.js'
import { normalizeBlocks, blocksText } from '../applications/notebook/plugins/format-freeform/format.js'
import { createHistory } from '../applications/notebook/plugins/free-page-editor/history.js'

const block = (id = 'one', x = 80, y = 120, text = '自由页面正文') => ({ id, x, y, width: 320, text })
test('自由页面 API 保存位置、提取正文并兼容无格式旧笔记，重启不丢布局', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-free-page-')), file = join(dir, 'notes.json')
  let app
  try {
    await writeFile(file, JSON.stringify([{ id: 'old', title: '旧笔记', content: '旧正文', pinned: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }]))
    app = await createApp({ port: 0, file })
    const request = async (path, method, data) => fetch(`http://127.0.0.1:${app.server.address().port}/api/notes${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    const created = await (await request('', 'POST', { type: 'freeform' })).json()
    assert.equal(created.type, 'freeform'); assert.deepEqual(created.blocks, [])
    const blocks = [block('below', 900, 1200, '后面'), block('above', 40, 50, '前面')]
    const saved = await (await request('/' + created.id, 'PATCH', { blocks })).json()
    assert.deepEqual(saved.blocks, blocks); assert.equal(saved.content, '前面\n后面')
    assert.equal((await request('/' + created.id, 'PATCH', { blocks: [block('duplicate'), block('duplicate')] })).status, 400)
    assert.equal((await request('/' + created.id, 'PATCH', { content: '覆盖正文' })).status, 400)
    assert.equal((await request('/' + created.id, 'PATCH', { type: 'plain' })).status, 400)
    assert.equal((await request('/old', 'PATCH', { blocks })).status, 400)
    assert.equal((await request('', 'POST', { type: 'unknown' })).status, 409)
    assert.equal((await request('/old', 'PATCH', { content: '旧笔记继续编辑' })).status, 200)
    await app.close(); app = await createApp({ port: 0, file })
    const restored = app.ctx.notes.list().find(note => note.id === created.id)
    assert.deepEqual(restored.blocks, blocks); assert.equal(restored.content, '前面\n后面')
    assert.equal(app.ctx.notes.list().find(note => note.id === 'old').content, '旧笔记继续编辑')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('文字块校验、快照隔离和阅读顺序', () => {
  for (const blocks of [[block('a', -1)], [{ ...block(), width: Infinity }], [{ ...block(), text: null }], Array.from({ length: 1001 }, (_, i) => block(String(i))), [{ ...block(), text: 'x'.repeat(200001) }]]) assert.throws(() => normalizeBlocks(blocks))
  const source = { blocks: [block()] }, snapshot = snapshotNote(source)
  source.blocks[0].text = '修改'
  assert.equal(snapshot.blocks[0].text, '自由页面正文')
  assert.throws(() => { snapshot.blocks[0].x = 0 })
  assert.equal(blocksText([block('right', 300, 20, '右'), block('left', 20, 20, '左')]), '左\n右')
})

test('文字输入和拖动分组撤销，重做及新编辑分叉', () => {
  const history = createHistory(), original = [block()]
  history.record([], null)
  history.record(original, 'text:one')
  history.record([{ ...block(), text: 'a' }], 'text:one')
  const edited = [{ ...block(), text: 'abc' }]
  assert.deepEqual(history.undo(edited), original)
  assert.deepEqual(history.redo(original), edited)
  assert.deepEqual(history.undo(edited), original)
  history.record(original, 'gesture:one')
  assert.equal(history.canRedo, false)
  assert.deepEqual(history.undo([{ ...block(), x: 200 }]), original)
  assert.deepEqual(history.undo(original), [])
})
