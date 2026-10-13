import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import tools from '../client.js'
import genericTools, { revision } from '../../agent-tools/client.js'
import { applyOperations, types } from '../operations.js'
import { createBlockDocument, blockTypes } from '../../format-block/document.js'
import { createBlockFormat } from '../../format-block/format.js'
import { documentService } from '../../rich-text/document.js'
import { createNotebook } from '../../notebook/model.js'
import { Notes } from '../../notes/server.js'
import { noteFormats } from '../../note-formats/server.js'
import { formatPlain } from '../../format-plain/server.js'
import { createAgentBridge } from '../../../../../client/host/agent-bridge.js'

const service = createBlockDocument(documentService)
const block = (id, text = id, type = 'paragraph') => service.create(type, text, id)
const doc = (...blocks) => ({ version: 1, blocks })

test('块操作覆盖所有格式；插入简单正文、标题、表格、图片与富文本，无需整篇文档', () => {
  assert.deepEqual(types, blockTypes)
  const image = '/api/note-assets/' + 'a'.repeat(64) + '.png'
  const rich = documentService.plain('加粗'); rich.elements[0].runs[0].format = { bold: true }
  const operations = types.map((type, i) => ({ op: 'insert', block: { id: 'b' + i, type,
    ...(['table', 'divider'].includes(type) ? {} : { text: type === 'image' ? image : type }), ...(type === 'heading' ? { level: 2 } : {}) } }))
  operations.push({ op: 'insert', block: { id: 'rich', body: rich } })
  const result = applyOperations(service, doc(), operations)
  assert.equal(result.document.blocks.length, types.length + 1)
  assert.equal(result.document.blocks[1].body.elements[0].level, 2)
  assert.equal(result.document.blocks.at(-1).body.elements[0].runs[0].format.bold, true)
  assert.deepEqual(result.insertedIds, result.document.blocks.map(b => b.id))
})

test('按 ID 编辑保留其他块与子树；移动顺序、嵌套和取消嵌套正确', () => {
  const a = block('a'), b = block('b', '任务', 'todo'), c = block('c', '折叠', 'toggle')
  b.children.push(block('child')); c.collapsed = true
  const input = doc(a, b, c), original = structuredClone(input)
  const result = applyOperations(service, input, [
    { op: 'insert', block: { id: 'new', text: '插在后面' }, targetId: 'a', placement: 'after' },
    { op: 'update', blockId: 'b', patch: { checked: true } },
    { op: 'move', blockId: 'b', targetId: 'c', placement: 'inside' },
    { op: 'move', blockId: 'new', targetId: 'a', placement: 'before' },
  ]).document
  assert.deepEqual(input, original)
  assert.deepEqual(result.blocks.map(b => b.id), ['new', 'a', 'c'])
  assert.deepEqual(result.blocks[1], a)
  assert.equal(result.blocks[2].collapsed, false)
  assert.equal(result.blocks[2].children[0].checked, true)
  assert.deepEqual(result.blocks[2].children[0].children, b.children)
  const moved = applyOperations(service, result, [{ op: 'move', blockId: 'b', targetId: 'c', placement: 'after' }, { op: 'move', blockId: 'new', placement: 'end' }]).document
  assert.deepEqual(moved.blocks.map(b => b.id), ['a', 'c', 'b', 'new'])
  assert.deepEqual(moved.blocks[2].children, b.children)
  const removed = applyOperations(service, moved, [{ op: 'remove', blockId: 'b' }]).document
  assert.equal(service.text(removed).includes('child'), false)
})

test('文字替换保留标题级别，状态修改保留富文本；删除最后一块留下稳定空块', () => {
  const h = block('h', '标题', 'heading'); h.body.elements[0].level = 3
  const todo = block('t', '任务', 'todo'); todo.body.elements[0].runs[0].format = { bold: true }
  const result = applyOperations(service, doc(h, todo), [
    { op: 'update', blockId: 'h', patch: { text: '新标题' } },
    { op: 'update', blockId: 't', patch: { checked: true } },
  ]).document
  assert.equal(result.blocks[0].body.elements[0].level, 3)
  assert.deepEqual(result.blocks[1].body, todo.body)
  const empty = applyOperations(service, doc(h), [{ op: 'remove', blockId: 'h' }]).document
  assert.equal(empty.blocks.length, 1)
  assert.equal(service.text(empty), '')
  const roundtrip = service.fromEditor(service.toEditor(empty))
  assert.equal(roundtrip.blocks[0].id, empty.blocks[0].id)
  assert.equal(service.text(roundtrip), '')
})

test('错误批次、缺失目标、重复 ID、自引用、非法正文和格式上限都不改变输入', () => {
  const a = block('a'); a.children.push(block('child'))
  const input = doc(a, block('b')), original = structuredClone(input)
  const bad = [
    { op: 'remove', blockId: 'missing' },
    { op: 'insert', block: { id: 'a' } },
    { op: 'insert', block: { text: '无目标' }, placement: 'after' },
    { op: 'move', blockId: 'a', placement: 'inside', targetId: 'child' },
    { op: 'move', blockId: 'a', placement: 'after', targetId: 'a' },
    { op: 'move', blockId: 'a', placement: 'end', targetId: 'b' },
    { op: 'update', blockId: 'a', patch: { children: [] } },
    { op: 'update', blockId: 'a', patch: { body: { type: 'doc' } } },
    { op: 'update', blockId: 'a', patch: { checked: 'false' } },
    { op: 'update', blockId: 'a', patch: { collapsed: true } },
    { op: 'update', blockId: 'a', patch: { type: null } },
    { op: 'update', blockId: 'a', patch: { type: 'table' } },
    { op: 'update', blockId: 'a', patch: { text: 'x', body: a.body } },
    { op: 'update', blockId: 'a', patch: { text: 'x'.repeat(200001) } },
  ]
  for (const op of bad) {
    assert.throws(() => applyOperations(service, input, [{ op: 'update', blockId: 'b', patch: { text: '不能部分成功' } }, op]))
    assert.deepEqual(input, original)
  }
  let deep = block('d12')
  for (let i = 11; i >= 0; i--) { const parent = block('d' + i); parent.children.push(deep); deep = parent }
  assert.throws(() => applyOperations(service, doc(deep, block('extra')), [{ op: 'move', blockId: 'extra', targetId: 'd12', placement: 'inside' }]), /12/)
  const full = doc(...Array.from({ length: 1000 }, (_, i) => block('n' + i)))
  assert.throws(() => applyOperations(service, full, [{ op: 'insert', block: {} }]), /1000/)
})

async function fixture(t) {
  const root = new Context(), window = new Window(), backups = new Map(), controller = new AbortController()
  const bridge = createAgentBridge({ application: { id: 'notebook' }, session: 'test', window, document: window.document })
  t.after(async () => { bridge.dispose(); await root.fiber.dispose(); await window.happyDOM.close() })
  let failSave = false, writes = 0
  await root.plugin(ctx => { Object.assign(new Service(ctx, 'storage'), { read: async () => [], write: async () => { if (failSave) throw Error('磁盘写入失败'); writes++ } }) })
  await root.plugin(noteFormats); await root.plugin(formatPlain)
  const startFormat = () => root.plugin({ inject: ['noteFormats'], apply(ctx) {
    Object.assign(new Service(ctx, 'blockDocument'), service)
    ctx.noteFormats.register(ctx, createBlockFormat(service))
  } })
  const format = startFormat(); await format
  const notes = new Notes(root); await notes.load()
  const first = await notes.create({ type: 'block' })
  await notes.update(first.id, { document: doc(block('a')) })
  await notes.create({ type: 'plain', title: '普通笔记' })
  await root.plugin(ctx => { new Service(ctx, 'notesApi').request = (path, method, data) => {
    if (!method) return notes.list()
    if (method === 'PATCH') { const { revision, ...patch } = data; return notes.update(path.slice(1), patch, revision) }
    if (method === 'POST') return notes.create(data)
    throw Error('unexpected request')
  } })
  const sdk = ctx => ({ signal: controller.signal, agent: bridge.forOwner(ctx), toast() {},
    provide(name, value) { const s = new Service(ctx, name); Object.defineProperties(s, Object.getOwnPropertyDescriptors(value)); return s },
  })
  await root.plugin({ inject: ['noteFormats', 'notesApi'], async apply(ctx) { await createNotebook(ctx, sdk(ctx), {
    storage: { getItem: key => backups.get(key), setItem: (key, value) => backups.set(key, value), removeItem: key => backups.delete(key) }, draftKey: 'test', autosaveMs: 60000,
  }) } })
  await root.notebook.choose(first.id)
  await root.plugin({ inject: ['notebook'], apply: ctx => genericTools(ctx, sdk(ctx)) })
  await root.plugin({ inject: ['notebook', 'blockDocument'], apply: ctx => tools(ctx, sdk(ctx)) })
  return { root, bridge, notes, backups, format, startFormat, controller, get writes() { return writes }, failSave: value => { failSave = value },
    read: args => bridge.call('notebook_blocks_read', args),
    edit: (read, operations) => bridge.call('notebook_blocks_edit', { id: read.id, revision: read.revision, operations }),
  }
}

test('真实笔记模型和桥接：读取草稿、兼容通用 revision、单次保存并派生正文', async t => {
  const f = await fixture(t), read = await f.read({ includeBody: true }), beforeWrites = f.writes
  const result = await f.edit(read, [
    { op: 'insert', block: { id: 'todo', type: 'todo', text: '待办' }, targetId: 'a', placement: 'after' },
    { op: 'update', blockId: 'todo', patch: { checked: true } },
    { op: 'move', blockId: 'todo', targetId: 'a', placement: 'inside' },
  ])
  assert.equal(f.writes, beforeWrites + 1)
  assert.equal(result.blocks[0].children[0].checked, true)
  assert.equal(result.revision, await revision(f.root.notebook.current()))
  assert.equal(f.notes.list().find(n => n.id === read.id).content, 'a\n待办')
  assert.equal(f.backups.size, 0)
  f.root.notebook.edit({ title: '尚未保存标题' })
  assert.equal((await f.read()).title, '尚未保存标题')
  assert.equal((await f.read()).revision, (await f.bridge.call('notebook_read')).revision)
  assert.equal((await f.read()).blocks[0].body, undefined)
  assert.ok((await f.read({ includeBody: true })).blocks[0].body)
})

test('拒绝旧版本、校验中输入/切换笔记、停用和格式错误，不覆盖页面状态', async t => {
  const f = await fixture(t), op = [{ op: 'update', blockId: 'a', patch: { text: 'Agent 内容' } }]
  const stale = await f.read(); f.root.notebook.edit({ title: '用户继续输入' })
  await assert.rejects(f.edit(stale, op), /笔记已变化/)
  const fresh = await f.read(), pending = f.edit(fresh, op)
  f.root.notebook.edit({ title: '校验期间输入' })
  await assert.rejects(pending, /笔记已变化/)
  const before = f.root.notebook.current()
  await assert.rejects(f.edit(await f.read(), [...op, { op: 'remove', blockId: 'missing' }]), /不存在/)
  assert.deepEqual(f.root.notebook.current(), before)
  const switching = assert.rejects(f.edit(await f.read(), op), /变化|块页面/)
  await f.root.notebook.choose(f.notes.list().find(n => n.type === 'plain').id)
  await switching
  await assert.rejects(f.read(), /块页面/)
  await f.root.notebook.choose(before.id)
  const disposing = f.edit(await f.read(), op); f.controller.abort()
  await assert.rejects(disposing, /停用/)
})

test('保存失败保留草稿，恢复后重读可继续；服务卸载只撤销块工具并能恢复', async t => {
  const f = await fixture(t)
  f.failSave(true)
  await assert.rejects(f.edit(await f.read(), [{ op: 'update', blockId: 'a', patch: { text: '保留草稿' } }]), /磁盘写入失败/)
  assert.equal(f.root.notebook.dirty, true)
  assert.equal(f.backups.size, 1)
  assert.equal((await f.read()).blocks[0].text, '保留草稿')
  f.failSave(false); await f.root.notebook.flush()
  await f.format.dispose()
  assert.ok(f.bridge.describe().some(t => t.name === 'notebook_read'))
  assert.ok(!f.bridge.describe().some(t => t.name === 'notebook_blocks_edit'))
  await assert.rejects(f.read(), /不可用/)
  await f.startFormat()
  assert.equal((await f.read()).blocks[0].text, '保留草稿')
})
