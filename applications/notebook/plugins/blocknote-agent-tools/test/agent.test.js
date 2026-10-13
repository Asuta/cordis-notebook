import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import tools from '../client.js'
import genericTools, { revision } from '../../agent-tools/client.js'
import { blockNoteDocument as service } from '../../format-blocknote/document.js'
import { createBlockNoteFormat } from '../../format-blocknote/format.js'
import { createNotebook } from '../../notebook/model.js'
import { Notes } from '../../notes/server.js'
import { noteFormats } from '../../note-formats/server.js'
import { formatPlain } from '../../format-plain/server.js'
import { createAgentBridge } from '../../../../../client/host/agent-bridge.js'
const block = (id, text = id, type = 'paragraph') => service.create(type, text, id)
const doc = (...blocks) => ({ version: 1, blocks })
async function fixture(t) {
  const root = new Context(), window = new Window(), backups = new Map(), controller = new AbortController()
  const bridge = createAgentBridge({ application: { id: 'notebook' }, session: 'test', window, document: window.document })
  t.after(async () => { bridge.dispose(); await root.fiber.dispose(); await window.happyDOM.close() })
  let failSave = false, writes = 0
  await root.plugin(ctx => { Object.assign(new Service(ctx, 'storage'), { read: async () => [], write: async () => { if (failSave) throw Error('磁盘写入失败'); writes++ } }) })
  await root.plugin(noteFormats); await root.plugin(formatPlain)
  const startFormat = () => root.plugin({ inject: ['noteFormats'], apply(ctx) {
    Object.assign(new Service(ctx, 'blockNoteDocument'), service)
    ctx.noteFormats.register(ctx, createBlockNoteFormat(service))
  } })
  const format = startFormat(); await format
  const notes = new Notes(root); await notes.load()
  const first = await notes.create({ type: 'blocknote' })
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
  await root.plugin({ inject: ['notebook', 'blockNoteDocument'], apply: ctx => tools(ctx, sdk(ctx)) })
  return { root, bridge, notes, backups, format, startFormat, controller, get writes() { return writes }, failSave: value => { failSave = value },
    read: args => bridge.call('notebook_blocknote_read', args),
    edit: (read, operations) => bridge.call('notebook_blocknote_edit', { id: read.id, revision: read.revision, operations }),
  }
}

test('真实笔记模型和桥接：读取草稿、兼容通用 revision、单次保存并派生正文', async t => {
  const f = await fixture(t), read = await f.read({ includeContent: true }), beforeWrites = f.writes
  const result = await f.edit(read, [
    { op: 'insert', block: { id: 'todo', type: 'checkListItem', text: '待办' }, targetId: 'a', placement: 'after' },
    { op: 'update', blockId: 'todo', patch: { props: { checked: true } } },
    { op: 'move', blockId: 'todo', targetId: 'a', placement: 'inside' },
  ])
  assert.equal(f.writes, beforeWrites + 1)
  assert.equal(result.blocks[0].children[0].props.checked, true)
  assert.equal(result.revision, await revision(f.root.notebook.current()))
  assert.equal(f.notes.list().find(n => n.id === read.id).content, 'a\n待办')
  assert.equal(f.backups.size, 0)
  f.root.notebook.edit({ title: '尚未保存标题' })
  assert.equal((await f.read()).title, '尚未保存标题')
  assert.equal((await f.read()).revision, (await f.bridge.call('notebook_read')).revision)
  assert.equal((await f.read()).blocks[0].content, undefined)
  assert.ok((await f.read({ includeContent: true })).blocks[0].content)
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
  const switching = assert.rejects(f.edit(await f.read(), op), /变化|BlockNote/)
  await f.root.notebook.choose(f.notes.list().find(n => n.type === 'plain').id)
  await switching
  await assert.rejects(f.read(), /BlockNote/)
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
  assert.ok(!f.bridge.describe().some(t => t.name === 'notebook_blocknote_edit'))
  await assert.rejects(f.read(), /不可用/)
  await f.startFormat()
  assert.equal((await f.read()).blocks[0].text, '保留草稿')
})

test('Agent 可在文字、媒体、分割线与表格间转换，保留块 ID 和子块并保存', async t => {
  const f = await fixture(t)
  await f.edit(await f.read(), [{ op: 'insert', block: { id: 'child', text: '保留子块' }, targetId: 'a', placement: 'inside' }])
  for (const type of ['image', 'video', 'audio', 'file', 'divider']) {
    const props = type === 'divider' ? {} : { url: 'https://example.com/asset', caption: '说明' }
    const result = await f.edit(await f.read(), [{ op: 'update', blockId: 'a', patch: { type, props } }])
    assert.equal(result.blocks[0].id, 'a')
    assert.equal(result.blocks[0].type, type)
    assert.equal(result.blocks[0].children[0].id, 'child')
    const stored = f.notes.list().find(note => note.id === result.id).document.blocks[0]
    assert.equal(stored.content, undefined)
    if (type !== 'divider') assert.equal(stored.props.url, props.url)
    await f.edit(await f.read(), [{ op: 'update', blockId: 'a', patch: { type: 'paragraph', text: '转换回正文' } }])
  }
  const table = service.create('table')
  await f.edit(await f.read(), [{ op: 'update', blockId: 'a', patch: { type: 'table', content: table.content } }])
  assert.deepEqual((await f.read({ includeContent: true })).blocks[0].content, table.content)
})

test('转换仍拒绝不匹配正文和非法媒体属性，错误批次不留下部分修改', async t => {
  const f = await fixture(t), before = f.root.notebook.current(), writes = f.writes
  for (const patch of [
    { type: 'image', content: [], props: { url: 'https://example.com/a.png' } },
    { type: 'video', text: '不支持的正文' },
    { type: 'image', props: { url: 'javascript:alert(1)' } },
    { type: 'divider', props: { url: 'https://example.com/a' } },
    { type: 'table' },
    { type: 'heading' },
  ]) {
    await assert.rejects(f.edit(await f.read(), [
      { op: 'insert', block: { id: 'must-not-exist', text: '不应部分保存' } },
      { op: 'update', blockId: 'a', patch },
    ]))
    assert.deepEqual(f.root.notebook.current(), before)
    assert.equal(f.writes, writes)
  }
})
