import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { StopCoordinator } from '../client/host/stop-coordinator.js'
import summary from '../applications/notebook/plugins/note-summary/client.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'
import { formatFreeform } from '../applications/notebook/plugins/format-freeform/server.js'
import { richText } from '../applications/notebook/plugins/rich-text/server.js'
import { createMarkdownFormat } from '../applications/notebook/plugins/format-markdown/format.js'
import { createMarkdown } from '../applications/notebook/plugins/markdown/parser.js'
const markdown = createMarkdown(), markdownFormat = createMarkdownFormat(markdown)

const note = (id, title, pinned = false) => ({ id, title, content: '正文 ' + title, pinned, createdAt: '2026-01-01', updatedAt: '2026-01-01' })
const turn = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function fixture(t, initialNotes, extraFormats = []) {
  const root = new Context(), backup = new Map(), writes = [], messages = []
  await root.plugin(noteFormats); await root.plugin(formatPlain); await root.plugin(richText)
  const freeform = root.plugin(formatFreeform); await freeform
  for (const format of extraFormats) await root.plugin(ctx => { root.noteFormats.register(ctx, format) })
  const notes = initialNotes || [note('a', 'alpha'), note('b', 'beta', true)]
  let patch = async saved => saved
  const sdk = ctx => ({
    provide(name, value) { const service = new Service(ctx, name); Object.defineProperties(service, Object.getOwnPropertyDescriptors(value)); return service },
    toast: text => messages.push(text),
  })
  const api = root.plugin(ctx => {
    new Service(ctx, 'notesApi').request = async (path, method, data) => {
      if (!method || method === 'GET') return structuredClone(notes)
      if (method === 'PATCH') {
        const saved = await patch(root.noteFormats.update(notes.find(n => path === '/' + n.id), data))
        writes.push(saved); return saved
      }
      throw new Error('unexpected request')
    }
  })
  await api
  let model
  const startNotebook = () => root.plugin({ inject: ['notesApi', 'noteFormats'], async apply(ctx) {
    model = await createNotebook(ctx, sdk(ctx), {
      storage: { getItem: key => backup.get(key) || null, setItem: (key, value) => backup.set(key, value), removeItem: key => backup.delete(key) },
      draftKey: 'draft', autosaveMs: 60000,
    })
  } })
  const notebook = startNotebook()
  await notebook
  t.after(() => root.fiber.dispose())
  return { root, notebook, freeform, get model() { return model }, startNotebook, backup, writes, messages, api, setPatch(fn) { patch = fn }, stopping: new StopCoordinator(root) }
}

test('公开过滤器接口按消费插件清理，相同名称互不覆盖，旧句柄不能影响新注册', async t => {
  const { root, model } = await fixture(t)
  let first, second
  let observed = 0
  const a = root.plugin({ inject: ['notebook'], apply(ctx) {
    first = ctx.notebook.registerFilter(ctx, 'same-key', n => n.title === 'alpha')
    ctx.notebook.observe(ctx, () => { observed++ })
    assert.throws(() => ctx.notebook.registerFilter(ctx, 'same-key', () => true), /重复/)
  } })
  const b = root.plugin({ inject: ['notebook'], apply(ctx) { second = ctx.notebook.registerFilter(ctx, 'same-key', n => n.pinned) } })
  await a; await b
  assert.equal(model.filters, undefined); assert.equal(model.visible().length, 0)
  first.update(() => true); assert.deepEqual(model.visible().map(n => n.id), ['b'])
  await b.dispose(); assert.equal(model.visible().length, 2)
  assert.throws(() => second.update(() => true), /释放/)
  await a.dispose(); const count = observed
  const replacement = root.plugin({ inject: ['notebook'], apply(ctx) { ctx.notebook.registerFilter(ctx, 'same-key', n => n.id === 'a') } })
  await replacement; await first.dispose(); model.edit({ title: 'renamed' })
  assert.deepEqual(model.visible().map(n => n.id), ['a']); assert.equal(observed, count)
})

test('保存校验串行短路，失败保留草稿；成功通知异常不改变已保存结果', async t => {
  const { root, model, backup, writes, messages } = await fixture(t)
  let later = 0, notified = 0
  const veto = root.plugin(ctx => { ctx.on('notebook/before-save', async snapshot => { assert.ok(Object.isFrozen(snapshot)); return '校验拒绝' }) })
  const other = root.plugin(ctx => { ctx.on('notebook/before-save', () => { later++ }); ctx.on('notebook/saved', () => { notified++ }) })
  await veto; await other
  model.edit({ content: '待保存' })
  await assert.rejects(model.flush(), /校验拒绝/)
  assert.equal(later, 0); assert.equal(writes.length, 0); assert.equal(notified, 0)
  assert.equal(model.dirty, true); assert.ok(backup.has('draft'))
  await veto.dispose()
  await root.plugin(ctx => { ctx.on('notebook/saved', async () => { throw new Error('扩展监听器出错') }) })
  await model.flush(); await turn()
  assert.equal(writes.length, 1); assert.equal(model.dirty, false); assert.equal(backup.size, 0)
  assert.equal(notified, 1); assert.ok(messages.some(text => text.includes('扩展监听器出错')))
  assert.match(model.status, /已保存/)
})

test('保存等待期间继续编辑会保存最新版本，不会提前清除草稿', async t => {
  const { root, model, writes, backup } = await fixture(t)
  const pending = deferred(), entered = deferred()
  let once = true
  await root.plugin(ctx => { ctx.on('notebook/before-save', async () => { if (once) { once = false; entered.resolve(); await pending.promise } }) })
  model.edit({ content: 'first' }); const flush = model.flush(); await entered.promise
  model.edit({ content: 'second' }); assert.ok(backup.has('draft'))
  pending.resolve(); await flush
  assert.deepEqual(writes.map(n => n.content), ['first', 'second'])
  assert.equal(model.current().content, 'second'); assert.equal(model.dirty, false); assert.equal(backup.size, 0)
})

test('停止准备保存失败会取消变更并解锁，随后可重试；卸载清理不会执行保存', async t => {
  const { model, notebook, stopping, backup, writes, setPatch } = await fixture(t)
  let changed = false
  setPatch(async () => { throw new Error('磁盘写入失败') })
  model.edit({ title: 'draft' })
  await assert.rejects(stopping.run({ reason: 'disable', targets: ['editor'] }, async () => { changed = true }), /磁盘写入失败/)
  assert.equal(changed, false); assert.equal(model.busy, false); assert.equal(model.dirty, true)
  assert.ok(backup.has('draft')); assert.equal(writes.length, 0)
  setPatch(async value => value)
  await stopping.run({ reason: 'reload', targets: ['editor'] }, async () => {
    assert.equal(model.busy, true); assert.equal(model.dirty, false)
    model.edit({ title: 'should be blocked' }); assert.equal(model.current().title, 'draft')
    changed = true
  })
  assert.equal(changed, true); assert.equal(model.busy, false); assert.equal(writes.length, 1)
  model.edit({ content: 'forced disposal draft' }); await notebook.dispose(); await model.flush()
  assert.equal(writes.length, 1); assert.ok(backup.has('draft'))
})

test('停止准备遇到后续拒绝或请求失败会逆序释放全部锁，不执行消费者清理', async t => {
  const { root, model, stopping } = await fixture(t)
  const released = []
  let disposed = false
  const veto = root.plugin(ctx => {
    ctx.on('plugins/before-stop', request => { request.hold(() => released.push(1)); request.hold(() => released.push(2)); return '拒绝停用' })
    ctx.effect(() => () => { disposed = true })
  })
  await veto
  await assert.rejects(stopping.run({ reason: 'disable', targets: ['sample'] }, () => veto.dispose()), /拒绝停用/)
  assert.equal(disposed, false); assert.deepEqual(released, [2, 1]); assert.equal(model.busy, false)
  await veto.dispose()
  await assert.rejects(stopping.run({ reason: 'switch', targets: ['theme'] }, async () => { throw new Error('后端依赖保护') }), /后端依赖保护/)
  assert.equal(model.busy, false)
})

test('异步校验期间服务消失不再提交保存，重启服务仍能恢复本地草稿', async t => {
  const app = await fixture(t)
  const { root, notebook, model, writes, backup } = app
  const entered = deferred(), pending = deferred()
  await root.plugin(ctx => { ctx.on('notebook/before-save', async () => { entered.resolve(); await pending.promise }) })
  model.edit({ content: 'keep draft' }); const saving = model.flush(); await entered.promise
  await notebook.dispose(); pending.resolve(); await saving
  assert.equal(writes.length, 0); assert.equal(JSON.parse(backup.get('draft')).content, 'keep draft')
  await app.startNotebook()
  assert.equal(app.model.current().content, 'keep draft'); assert.equal(app.model.dirty, true)
})

test('保存后摘要仅监听成功保存，重复启停自动清理界面与监听器', async t => {
  const { root, model } = await fixture(t)
  const panels = new Set(), rendered = []
  let updates = 0
  await root.plugin(ctx => {
    new Service(ctx, 'shell').mount = (owner, name, node) => owner.effect(() => { assert.equal(name, 'panels'); panels.add(node); return () => panels.delete(node) })
  })
  const sdk = { config: { length: 120, showCount: true }, onConfig() {}, el(tag, props, text) {
    const node = { text, children: [], append(...items) { this.children.push(...items) }, set textContent(value) { this.text = value; updates++ }, get textContent() { return this.text } }
    if (tag === 'section') rendered.push(node)
    return node
  } }
  const start = () => root.plugin({ inject: ['notebook', 'shell'], apply: ctx => summary(ctx, sdk) })
  let plugin = start(); await plugin; assert.equal(panels.size, 1)
  model.edit({ content: '摘要示例' }); assert.equal(updates, 0)
  await model.flush(); assert.equal(updates, 3); assert.equal(rendered[0].children[1].textContent, '摘要示例')
  await plugin.dispose(); assert.equal(panels.size, 0)
  model.edit({ content: '停用后的保存' }); await model.flush(); assert.equal(updates, 3)
  plugin = start(); await plugin
  model.edit({ content: '再次启用' }); await model.flush(); assert.equal(updates, 6); assert.equal(panels.size, 1)
  await plugin.dispose(); assert.equal(panels.size, 0)
})

test('自由页面草稿保留布局，保存期间继续编辑且失败卸载后可恢复', async t => {
  const original = { ...note('page', '自由页面'), type: 'freeform', content: '初始', blocks: [{ id: 'b', x: 10, y: 20, width: 320, text: '初始' }] }
  const f = await fixture(t, [original])
  const first = [{ id: 'b', x: 600, y: 900, width: 400, text: '第一版' }]
  f.model.edit({ blocks: first })
  first[0].text = '外部变化'
  assert.equal(f.model.current().content, '第一版')
  assert.equal(JSON.parse(f.backup.get('draft')).blocks[0].y, 900)
  const gate = deferred(); let calls = 0
  f.setPatch(async saved => { if (++calls === 1) await gate.promise; return saved })
  const saving = f.model.flush(); await turn()
  const second = [{ ...f.model.current().blocks[0], text: '第二版', x: 800 }]
  f.model.edit({ blocks: second }); gate.resolve(); await saving
  assert.equal(f.writes.at(-1).blocks[0].x, 800)
  assert.equal(f.writes.at(-1).content, '第二版')
  f.setPatch(async () => { throw new Error('保存失败') })
  f.model.edit({ blocks: [{ ...second[0], text: '未保存草稿' }] })
  await assert.rejects(f.model.flush(), /保存失败/)
  await f.notebook.dispose()
  const restored = f.startNotebook(); await restored
  assert.equal(f.model.current().blocks[0].text, '未保存草稿')
  assert.equal(f.model.current().blocks[0].x, 800)
  assert.equal(f.model.dirty, true)
})

test('格式缺失时保留草稿并防止覆盖，重新注册后自动恢复', async t => {
  const original = { ...note('page', '页面'), type: 'freeform', content: '', blocks: [] }
  const f = await fixture(t, [original])
  f.model.edit({ blocks: [{ id: 'kept', x: 100, y: 200, width: 320, text: '不能丢失的草稿' }] })
  await f.notebook.dispose(); await f.freeform.dispose()
  await f.startNotebook()
  assert.equal(f.model.editable, false)
  assert.throws(() => f.model.edit({ title: '不能覆盖草稿' }), /草稿/)
  assert.match(f.backup.get('draft'), /不能丢失的草稿/)
  await f.root.plugin(formatFreeform); await turn()
  assert.equal(f.model.editable, true)
  assert.equal(f.model.current().blocks[0].text, '不能丢失的草稿')
  await f.model.flush()
  assert.equal(f.writes.at(-1).content, '不能丢失的草稿')
  assert.equal(f.backup.size, 0)
})

test('格式在停止准备锁内恢复后，解锁自动恢复草稿并允许保存', async t => {
  const original = { ...note('page', '页面'), type: 'freeform', content: '', blocks: [] }
  const f = await fixture(t, [original])
  f.model.edit({ blocks: [{ id: 'kept', x: 100, y: 200, width: 320, text: '重载后恢复的草稿' }] })
  await f.notebook.dispose(); await f.freeform.dispose(); await f.startNotebook()
  assert.equal(f.model.editable, false)
  await f.stopping.run({ reason: 'reload', targets: ['format-freeform'] }, async () => {
    await f.root.plugin(formatFreeform)
    assert.equal(f.model.busy, true)
    assert.equal(f.model.dirty, false)
    assert.equal(f.model.current().content, '')
    assert.match(f.backup.get('draft'), /重载后恢复的草稿/)
  })
  assert.equal(f.model.busy, false)
  assert.equal(f.model.editable, true)
  assert.equal(f.model.dirty, true)
  assert.equal(f.model.current().blocks[0].text, '重载后恢复的草稿')
  await f.model.flush()
  assert.equal(f.writes.at(-1).content, '重载后恢复的草稿')
  assert.equal(f.backup.size, 0)
})

test('前端通用编辑、保存及草稿恢复支持新增格式的嵌套数据', async t => {
  const format = {
    type: 'cards', label: '测试卡片', editor: 'cards', fields: ['cards'],
    defaults: () => ({ cards: [] }),
    normalize: data => ({ cards: structuredClone(data.cards) }),
    toText: data => data.cards.map(card => card.body.text).join('\n'),
  }
  const f = await fixture(t, [{ ...note('cards', '卡片'), type: 'cards', content: '', cards: [] }], [format])
  f.model.edit({ cards: [{ body: { text: '嵌套格式正文' } }] })
  assert.equal(f.model.current().content, '嵌套格式正文')
  assert.throws(() => { f.model.current().cards[0].body.text = '不可改写快照' })
  await f.notebook.dispose(); await f.startNotebook()
  assert.equal(f.model.current().cards[0].body.text, '嵌套格式正文')
  await f.model.flush()
  assert.equal(f.writes.at(-1).cards[0].body.text, '嵌套格式正文')
  assert.equal(f.backup.size, 0)
})

test('Markdown 草稿保存源码并恢复，编辑期间继续保存不会丢失语法', async t => {
  const f = await fixture(t, [{ ...note('md', 'Markdown'), type: 'markdown', markdown: '# 初稿', content: '初稿' }], [markdownFormat])
  f.model.edit({ markdown: '# 新标题\n\n**重要内容**' })
  assert.equal(f.model.current().content, '新标题\n重要内容')
  assert.equal(JSON.parse(f.backup.get('draft')).markdown, '# 新标题\n\n**重要内容**')
  await f.notebook.dispose(); await f.startNotebook()
  assert.equal(f.model.current().markdown, '# 新标题\n\n**重要内容**')
  await f.model.flush()
  assert.equal(f.writes.at(-1).markdown, '# 新标题\n\n**重要内容**')
  assert.equal(f.backup.size, 0)
})
