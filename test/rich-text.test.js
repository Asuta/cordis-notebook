import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { createApp } from '../server/server.js'
import {
  normalizeDocument,
  plainDocument,
  documentText,
  toEditor,
  fromEditor,
  documentService,
} from '../applications/notebook/plugins/rich-text/document.js'
import { createFreeformFormat } from '../applications/notebook/plugins/format-freeform/format.js'
import { mountEditor } from '../applications/notebook/plugins/rich-text/engine.js'

test('富文本格式、段落属性、列表和表格往返编辑器后保持语义', () => {
  const p = (id, text) => ({ id, kind: 'paragraph', runs: [{ text }] })
  const input = normalizeDocument({
    version: 1,
    elements: [
      {
        ...p('a', '中文'),
        indent: 2,
        tag: 'todo',
        checked: true,
        collapsed: true,
        align: 'center',
        runs: [
          {
            text: '中文',
            format: {
              bold: true,
              italic: true,
              underline: true,
              color: '#123456',
              size: 18,
              font: 'Microsoft YaHei',
              link: 'https://example.com',
              highlight: '#ffff00',
            },
          },
        ],
      },
      {
        id: 'list',
        kind: 'list',
        ordered: true,
        start: 3,
        children: [{ id: 'item', kind: 'item', children: [p('b', '列表')] }],
      },
      {
        id: 'table',
        kind: 'table',
        children: [
          {
            id: 'row',
            kind: 'row',
            children: [
              {
                id: 'cell',
                kind: 'cell',
                header: true,
                colspan: 1,
                rowspan: 1,
                widths: [120],
                children: [p('c', '单元格')],
              },
            ],
          },
        ],
      },
      { id: 'image', kind: 'image', src: '/api/note-assets/' + 'a'.repeat(64) + '.png', alt: '图注', width: 320 },
    ],
  })
  assert.deepEqual(fromEditor(toEditor(input)), input)
  assert.equal(documentText(input), '中文\n列表\n单元格\n图注')
  const dirty = toEditor(input)
  dirty.content[0].content[0].marks.push({ type: 'link', attrs: { href: 'javascript:alert(1)' } })
  assert.equal(fromEditor(dirty).elements[0].runs[0].format.link, undefined)
  assert.throws(() => normalizeDocument({ version: 9, elements: [] }))
  assert.throws(() =>
    normalizeDocument({ version: 1, elements: [{ kind: 'image', src: 'https://example.com/x.png' }] }),
  )
  assert.throws(() => plainDocument('x'.repeat(200001)))
  const legacy = { id: 'old', x: 10, y: 30, width: 320, text: '旧笔记\n第二行' }
  const format = createFreeformFormat(documentService)
  assert.deepEqual(format.normalize({ blocks: [legacy] }).blocks, [legacy])
  assert.equal(format.normalize({ blocks: [{ ...legacy, outline: input }] }).blocks[0].text, documentText(input))
})

test('真实富文本编辑器保留标记，拒绝超限操作并随消费上下文销毁', async () => {
  const window = new Window(),
    previous = new Map(),
    cleanups = []
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  try {
    const element = document.createElement('div')
    document.body.append(element)
    const changes = [],
      errors = []
    const owner = {
      effect(fn) {
        const cleanup = fn()
        cleanups.push(cleanup)
        return cleanup
      },
    }
    const api = mountEditor(owner, element, {
      document: plainDocument('第一段\n第二段'),
      change: (doc) => changes.push(doc),
      error: (e) => errors.push(e),
    })
    api.editor.commands.setTextSelection({ from: 1, to: 4 })
    api.exec('bold')
    assert.equal(api.document.elements[0].runs[0].format.bold, true)
    api.exec('tag', 'todo')
    api.exec('checked')
    assert.equal(api.document.elements[0].checked, true)
    api.exec('indent', 1)
    assert.equal(api.document.elements[0].indent, 1)
    const before = api.document
    api.editor.commands.insertContent('x'.repeat(200001))
    assert.deepEqual(api.document, before)
    assert.equal(errors.length, 1)
    api.setDocument(plainDocument('恢复内容'))
    assert.equal(documentText(api.document), '恢复内容')
    api.exec('table')
    assert.ok(api.document.elements.some((n) => n.kind === 'table'))
    api.exec('addRowAfter')
    assert.equal(api.document.elements.find((n) => n.kind === 'table').children.length, 4)
    assert.ok(changes.length >= 4)
    api.destroy()
    assert.equal(api.editor.isDestroyed, true)
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('本地图片与富文本文档保存重启后可读取，无效数据不覆盖原文', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-rich-')),
    file = join(dir, 'notes.json')
  let app
  try {
    app = await createApp({ port: 0, file })
    const request = (path, method, data) =>
      fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6SAAAAABJRU5ErkJggg==',
      'base64',
    )
    const asset = await (await request('/api/note-assets', 'POST', { data: bytes.toString('base64') })).json()
    assert.match(asset.src, /^\/api\/note-assets\/[a-f0-9]{64}\.png$/)
    assert.equal(
      (await request('/api/note-assets', 'POST', { data: Buffer.from('<svg/>').toString('base64') })).status,
      400,
    )
    const created = await (await request('/api/notes', 'POST', { type: 'freeform' })).json()
    const outline = plainDocument('富文本正文')
    outline.elements[0].indent = 30
    outline.elements.push({ id: 'img', kind: 'image', src: asset.src, alt: '本地图片', width: 320 })
    outline.elements.push({ id: 'list', kind: 'list', ordered: true, start: 1,
      children: [{ id: 'item', kind: 'item', indent: 24, children: plainDocument('深缩进列表', 'nested').elements }] })
    const blocks = [{ id: 'a', x: 240, y: 300, width: 420, text: '不可相信的缓存', outline }]
    const saved = await (
      await request('/api/notes/' + created.id, 'PATCH', { blocks, page: { rule: 'grid', color: '#fffedd' } })
    ).json()
    assert.equal(saved.content, '富文本正文\n本地图片\n深缩进列表')
    assert.equal(saved.blocks[0].outline.elements[0].indent, 30)
    assert.equal(saved.blocks[0].outline.elements[2].children[0].indent, 24)
    assert.equal(saved.version, 2)
    assert.equal(
      (
        await request('/api/notes/' + created.id, 'PATCH', {
          blocks: [{ ...blocks[0], outline: { version: 999, elements: [] } }],
        })
      ).status,
      400,
    )
    await app.close()
    app = await createApp({ port: 0, file })
    assert.deepEqual(
      app.ctx.notes.list().find((n) => n.id === created.id),
      saved,
    )
    const response = await request(asset.src, 'GET')
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes)
  } finally {
    if (app) await app.close()
    await rm(dir, { recursive: true, force: true })
  }
})
