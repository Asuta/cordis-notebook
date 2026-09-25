import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server/server.js'
import { builtins } from '../server/builtins.js'
import { ClientPlugins } from '../client/host/plugin-host.js'
import { noteFormats } from '../plugins/note-formats/server.js'

const spec = id => ({ ...builtins.find(item => item.manifest.id === id).manifest, enabled: true, state: 'enabled', serverState: 'not-applicable', generation: 1 })
const sdkFor = ctx => ({ provide(name, value) { return Object.assign(new Service(ctx, name), value) } })
const hostFor = root => new ClientPlugins(root, { sdkFor, load: p => import(`../plugins/${p.id}/client.js`) })

test('能力插件受依赖保护，Markdown 服务消失时撤销格式，恢复后保留原笔记并可继续保存', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-capability-'))
  let app
  try {
    app = await createApp({ port: 0, file: join(dir, 'notes.json') })
    assert.equal(app.ctx.markdown.toText('**正文**'), '正文')
    await assert.rejects(app.manager.toggle('markdown', false), /依赖/)
    await assert.rejects(app.manager.toggle('theme-engine', false), /依赖/)
    const note = await app.ctx.notes.create({ type: 'markdown' })
    await app.ctx.notes.update(note.id, { markdown: '# 原始源码' })
    await app.manager.stop('markdown') // Simulate provider loss outside managed stop protection.
    assert.equal(app.ctx.noteFormats.get('markdown'), undefined)
    assert.equal(app.ctx.notes.list().find(item => item.id === note.id).markdown, '# 原始源码')
    await assert.rejects(app.ctx.notes.update(note.id, { markdown: '等待恢复' }), { status: 409 })
    assert.equal((await app.ctx.notes.create()).type, 'plain')
    await app.manager.start('markdown')
    await app.manager.records.get('format-markdown').fiber
    assert.equal((await app.ctx.notes.update(note.id, { markdown: '**恢复保存**' })).content, '恢复保存')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('前端 Markdown 格式等待真实解析服务，提供者替换后重新绑定并自动注册', async () => {
  const root = new Context(), host = hostFor(root)
  try {
    await root.plugin(noteFormats)
    await host.sync([spec('format-markdown')])
    assert.equal(host.state('format-markdown'), 'waiting')
    assert.equal(root.noteFormats.get('markdown'), undefined)
    await host.sync([spec('format-markdown'), spec('markdown')])
    assert.equal(host.state('format-markdown'), 'enabled')
    assert.equal(host.describe(spec('format-markdown')).bindings.client.markdown, 'markdown')
    await host.sync([spec('format-markdown')])
    assert.equal(root.noteFormats.get('markdown'), undefined)
    await host.sync([spec('format-markdown'), spec('markdown')])
    assert.equal(root.noteFormats.update(root.noteFormats.create('markdown'), { markdown: '# 新实例' }).content, '新实例')
  } finally { await root.fiber.dispose() }
})

test('富文本能力失去时保护自由页面，恢复后重新绑定并保留内容', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-outline-capability-'))
  let app
  try {
    app = await createApp({ port: 0, file: join(dir, 'notes.json') })
    await assert.rejects(app.manager.toggle('rich-text', false), /依赖/)
    await assert.rejects(app.manager.toggle('note-assets', false), /依赖/)
    const note = await app.ctx.notes.create({ type: 'freeform' })
    const blocks = [{ id: 'outline', x: 20, y: 30, width: 400, outline: app.ctx.richText.plain('格式数据保留') }]
    const saved = await app.ctx.notes.update(note.id, { blocks })
    await app.manager.stop('rich-text')
    assert.equal(app.ctx.noteFormats.get('freeform'), undefined)
    assert.deepEqual(app.ctx.notes.list().find(n => n.id === note.id), saved)
    await assert.rejects(app.ctx.notes.update(note.id, { blocks }), { status: 409 })
    await app.manager.start('rich-text')
    await app.manager.records.get('format-freeform').fiber
    assert.equal((await app.ctx.notes.update(note.id, { blocks })).content, '格式数据保留')
  } finally { if (app) await app.close(); await rm(dir, { recursive: true, force: true }) }
})

test('主题样式归属主题消费者，停用主题和引擎均能清理，重启后只保留一份样式', async () => {
  const previous = globalThis.document, styles = new Set()
  globalThis.document = {
    head: { append(node) { styles.add(node) } },
    documentElement: { dataset: {} },
    createElement() { return { dataset: {}, remove() { styles.delete(this) } } },
  }
  const root = new Context(), host = hostFor(root)
  try {
    await root.plugin(ctx => { new Service(ctx, 'shell') })
    await host.sync([spec('theme')])
    assert.equal(host.state('theme'), 'waiting')
    await host.sync([spec('theme'), spec('theme-engine')])
    assert.equal(styles.size, 1)
    assert.equal(document.documentElement.dataset.theme, 'theme')
    await host.sync([spec('theme-engine')])
    assert.equal(styles.size, 0)
    assert.equal(document.documentElement.dataset.theme, undefined)
    await host.sync([spec('theme-blue'), spec('theme-engine')])
    assert.equal(styles.size, 1)
    assert.equal(document.documentElement.dataset.theme, 'theme-blue')
    await host.sync([spec('theme-blue')])
    assert.equal(styles.size, 0)
    assert.equal(root.theme, undefined)
    await host.sync([spec('theme-blue'), spec('theme-engine')])
    assert.equal(styles.size, 1)
    await host.sync([])
    assert.equal(styles.size, 0)
  } finally { await root.fiber.dispose(); globalThis.document = previous }
})
