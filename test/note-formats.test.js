import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from 'cordis'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/server.js'
import { noteFormats } from '../src/plugins/note-formats.js'

export const checklist = {
  type: 'checklist', label: '测试清单', editor: 'checklist', fields: ['items'],
  defaults: () => ({ items: [] }),
  normalize(data) {
    if (!Array.isArray(data.items) || data.items.some(item => typeof item.text !== 'string' || typeof item.done !== 'boolean')) throw new Error('清单数据无效')
    return { items: data.items.map(item => ({ text: item.text, done: item.done })) }
  },
  toText: data => data.items.map(item => (item.done ? '[x] ' : '[ ] ') + item.text).join('\n'),
}
test('注册第三种格式即可使用通用创建、校验、派生正文及持久化；卸载不损坏未知数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-format-')), file = join(dir, 'notes.json')
  let app
  try {
    app = await createApp({ port: 0, file })
    const provider = app.ctx.plugin({ inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, checklist) } }); await provider
    const created = await app.ctx.notes.create({ type: 'checklist' })
    const saved = await app.ctx.notes.update(created.id, { items: [{ text: '无需修改通用保存代码', done: true }] })
    assert.equal(saved.content, '[x] 无需修改通用保存代码')
    await assert.rejects(app.ctx.notes.update(created.id, { items: [{ text: 42, done: true }] }), /无效/)
    const before = await readFile(file, 'utf8')
    await provider.dispose()
    await assert.rejects(app.ctx.notes.update(created.id, { title: '不允许覆盖' }), { status: 409 })
    assert.equal(await readFile(file, 'utf8'), before)
    await app.close(); app = await createApp({ port: 0, file })
    assert.deepEqual(app.ctx.notes.list()[0], saved)
    await app.ctx.plugin({ inject: ['noteFormats'], apply(ctx) { ctx.noteFormats.register(ctx, checklist) } })
    assert.equal((await app.ctx.notes.update(created.id, { title: '恢复编辑' })).items[0].text, '无需修改通用保存代码')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('格式注册归属、重复保护、旧释放句柄与订阅清理', async () => {
  const root = new Context(); await root.plugin(noteFormats)
  let oldDispose, notifications = 0
  try {
    const observer = root.plugin(ctx => root.noteFormats.observe(ctx, () => notifications++)); await observer
    const provider = root.plugin(ctx => { oldDispose = root.noteFormats.register(ctx, checklist) }); await provider
    assert.equal(root.noteFormats.list()[0].label, '测试清单')
    assert.throws(() => root.noteFormats.register(root, checklist), /重复/)
    assert.throws(() => root.noteFormats.register(root, { ...checklist, type: 'bad', fields: ['id'] }), /公共字段/)
    await provider.dispose()
    assert.equal(root.noteFormats.get('checklist'), undefined)
    const next = root.plugin(ctx => { root.noteFormats.register(ctx, checklist) }); await next
    await oldDispose(); assert.ok(root.noteFormats.get('checklist'))
    await observer.dispose(); const count = notifications
    await next.dispose(); assert.equal(notifications, count)
  } finally { await root.fiber.dispose() }
})

test('停用内置格式仅撤销该格式，其他格式及已有笔记仍然可用', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-format-toggle-'))
  const app = await createApp({ port: 0, file: join(dir, 'notes.json') })
  try {
    const page = await app.ctx.notes.create({ type: 'freeform' })
    await app.manager.toggle('format-freeform', false)
    assert.equal(app.ctx.noteFormats.get('freeform'), undefined)
    assert.ok(app.ctx.noteFormats.get('plain'))
    await assert.rejects(app.ctx.notes.create({ type: 'freeform' }), { status: 409 })
    await assert.rejects(app.ctx.notes.update(page.id, { title: '无格式不可写' }), { status: 409 })
    assert.ok(app.ctx.notes.list().some(note => note.id === page.id))
    await app.ctx.notes.create()
    await app.manager.toggle('format-freeform', true)
    assert.equal((await app.ctx.notes.update(page.id, { title: '恢复正常' })).title, '恢复正常')
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }) }
})
