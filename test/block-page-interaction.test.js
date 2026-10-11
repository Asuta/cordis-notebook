import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { mountBlockEditor } from '../applications/notebook/plugins/block-editor/engine.js'
import { createBlockDocument } from '../applications/notebook/plugins/format-block/document.js'
import { documentService } from '../applications/notebook/plugins/rich-text/document.js'

const blocks = createBlockDocument(documentService)
const paste = (api, text, html = '') => api.editor.view.someProp('handlePaste', fn => fn(api.editor.view, {
  clipboardData: { files: [], getData: type => type === 'text/html' ? html : type === 'text/plain' ? text : '' },
}))
function fixture(t, document) {
  const window = new Window(), saved = new Map(), changes = []
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, DOMParser: window.DOMParser,
    MutationObserver: window.MutationObserver, getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const el = window.document.createElement('div'); window.document.body.append(el)
  let api
  t.after(async () => {
    api?.destroy()
    await window.happyDOM.close()
    for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  api = mountBlockEditor(el, blocks, documentService, { document, change: doc => changes.push(doc), error: e => { throw e } })
  return { api, changes,
    key(key, extra = {}) {
      const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })
      api.editor.view.dom.dispatchEvent(event)
      return event
    },
  }
}

test('块页面 Ctrl+Enter 切换待办和折叠状态，不拆分正文；支持撤销重做', t => {
  const todo = blocks.create('todo', '验收任务'), toggle = blocks.create('toggle', '更多内容')
  toggle.children.push(blocks.create('paragraph', '子块'))
  const { api, key } = fixture(t, { version: 1, blocks: [todo, toggle] })
  api.focus(todo.id)
  key('Enter', { ctrlKey: true })
  assert.equal(api.document.blocks.length, 2)
  assert.equal(api.document.blocks[0].checked, true)
  api.editor.commands.undo()
  assert.equal(api.document.blocks[0].checked, false)
  api.editor.commands.redo()
  assert.equal(api.document.blocks[0].checked, true)
  api.focus(toggle.id)
  key('Enter', { metaKey: true })
  assert.equal(api.document.blocks[1].collapsed, true)
  assert.equal(api.document.blocks[1].children[0].body.elements[0].runs[0].text, '子块')
  assert.equal(api.document.blocks.length, 2)
})

test('块页面回车拆分、Tab 嵌套和多行粘贴保留后缀；只读时拒绝结构改动', t => {
  const first = blocks.create('paragraph', '前后')
  const { api, key, changes } = fixture(t, { version: 1, blocks: [first] })
  api.editor.commands.setTextSelection(3)
  key('Enter')
  assert.equal(blocks.text(api.document), '前\n后')
  key('Tab')
  assert.equal(api.document.blocks.length, 1)
  assert.equal(api.document.blocks[0].children.length, 1)
  key('Tab', { shiftKey: true })
  assert.equal(api.document.blocks.length, 2)
  const second = api.document.blocks[1].id
  api.focus(second)
  api.editor.view.someProp('handlePaste', fn => fn(api.editor.view, {
    clipboardData: { files: [], getData: type => type === 'text/plain' ? '粘贴一\n粘贴二' : '' },
  }))
  assert.equal(blocks.text(api.document), '前\n粘贴一\n粘贴二\n后')
  assert.ok(changes.length > 0)
  const snapshot = api.document
  api.setEditable(false)
  assert.equal(api.add(), false)
  key('Enter')
  assert.deepEqual(api.document, snapshot)
})

for (const offset of [0, 1, 3]) test(`多段块首段偏移 ${offset} 粘贴时保留后续富文本和子块，可撤销重做`, t => {
  const parent = blocks.create('paragraph', 'ABC')
  const tail = documentService.plain('DEF', 'tail').elements[0]
  tail.runs[0].format = { bold: true }
  parent.body.elements.push(tail)
  parent.children.push(blocks.create('paragraph', 'child'))
  const { api, changes } = fixture(t, { version: 1, blocks: [parent] })
  const original = api.document
  api.editor.commands.setTextSelection(2 + offset)
  assert.equal(paste(api, 'X\nY'), true)
  const saved = api.document
  assert.equal(saved.blocks.map(b => documentService.text(b.body)).join('\n'),
    [...(offset ? ['ABC'.slice(0, offset)] : []), 'X', 'Y', 'ABC'.slice(offset), 'DEF'].join('\n'))
  assert.deepEqual(saved.blocks.at(-1).body.elements.at(-1), original.blocks[0].body.elements[1])
  assert.deepEqual(saved.blocks.flatMap(b => b.children), original.blocks[0].children)
  assert.deepEqual(changes.at(-1), saved, '保存回调必须收到完整正文')
  api.editor.commands.undo()
  assert.deepEqual(api.document, original)
  api.editor.commands.redo()
  assert.deepEqual(api.document, saved)
})

test('从编辑器复制包含本地图片的块树，粘贴保留图片和层级并生成新 ID', t => {
  const source = '/api/note-assets/' + 'a'.repeat(64) + '.png'
  const parent = blocks.create('paragraph', '图片父块')
  parent.children.push(blocks.create('image', source))
  const { api, changes } = fixture(t, { version: 1, blocks: [parent] })
  const original = api.document, html = api.editor.getHTML()
  api.editor.commands.setTextSelection(2 + '图片父块'.length)
  assert.equal(paste(api, '图片父块', html), true)
  const saved = api.document, copy = saved.blocks[1]
  assert.equal(saved.blocks.length, 2)
  assert.equal(copy.children[0].type, 'image')
  assert.equal(copy.children[0].body.elements[0].src, source)
  assert.notEqual(copy.id, original.blocks[0].id)
  assert.notEqual(copy.children[0].id, original.blocks[0].children[0].id)
  assert.deepEqual(saved.blocks[0], original.blocks[0])
  assert.deepEqual(changes.at(-1), saved)
  api.editor.commands.undo()
  assert.deepEqual(api.document, original)
  api.editor.commands.redo()
  assert.deepEqual(api.document, saved)
})

for (const src of ['https://example.com/image.png', 'data:image/png;base64,AAAA', '/api/note-assets/invalid.png']) {
  test(`内部块不能通过粘贴引入未经校验的图片：${src}`, t => {
    const parent = blocks.create('paragraph', '保留原文')
    parent.children.push(blocks.create('image', '/api/note-assets/' + 'b'.repeat(64) + '.png'))
    const { api, changes } = fixture(t, { version: 1, blocks: [parent] })
    const original = api.document
    const html = api.editor.getHTML().replace('/api/note-assets/' + 'b'.repeat(64) + '.png', src)
    assert.throws(() => paste(api, '', html), /块正文不能为空/)
    assert.deepEqual(api.document, original)
    assert.equal(changes.length, 0)
  })
}
