import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { mountEditor } from '../applications/notebook/plugins/rich-text/engine.js'
import { normalizeDocument, documentText } from '../applications/notebook/plugins/rich-text/document.js'
import { darkReaderMarkViews } from '../applications/notebook/plugins/rich-text/darkreader.js'

function fixture(t, format, appearance) {
  const window = new Window(), saved = new Map()
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, DOMParser: window.DOMParser,
    ClipboardEvent: window.ClipboardEvent, MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window), requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const el = document.createElement('div'); document.body.append(el)
  const changes = [], api = mountEditor({ effect: fn => fn() }, el, {
    appearance,
    document: normalizeDocument({ version: 1, elements: [{ id: 'p', kind: 'paragraph', runs: [
      { text: '颜色', format }, { text: '粗体', format: { bold: true,
        ...(format.color ? { color: '#c00000' } : { highlight: '#ffff00' }) } }, { text: '普通文字' },
    ] }] }),
    change: doc => changes.push(doc), error: e => { throw e },
  })
  t.after(async () => {
    api.destroy()
    await window.happyDOM.close()
    for (const [key, descriptor] of saved) descriptor
      ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
  })
  return { api, el, changes, flush: () => api.editor.view.domObserver.flush() }
}

for (const [format, selector, suffix] of [
  [{ color: '#336699' }, 'span[style*="color"]', 'color'],
  [{ highlight: '#fff59d' }, 'mark', 'bgcolor'],
]) test(`Dark Reader 修改及移除 ${suffix} 属性不会重建混合格式文字或写入文档`, t => {
  const { api, el, changes, flush } = fixture(t, format)
  const before = api.document, nodes = [...el.querySelectorAll(selector)]
  assert.ok(nodes.length >= 2)
  for (let round = 0; round < 10; round++) {
    for (const node of nodes) {
      node.style.setProperty(`--darkreader-inline-${suffix}`, round % 2 ? '#88aacc' : '#99bbdd')
      node.setAttribute(`data-darkreader-inline-${suffix}`, '')
    }
    flush()
    assert.ok(nodes.every(node => node.isConnected), '扩展改色不能触发节点替换，否则扩展会重新改色形成循环')
    assert.deepEqual(api.document, before)
    assert.equal(changes.length, 0)
  }
  for (const node of nodes) {
    node.style.removeProperty(`--darkreader-inline-${suffix}`)
    node.removeAttribute(`data-darkreader-inline-${suffix}`)
  }
  flush()
  assert.ok(nodes.every(node => node.isConnected))
  assert.deepEqual(api.document, before)
  assert.equal(changes.length, 0)
})

for (const format of [{}, { bold: true }, { italic: true }, { underline: true }, { strike: true },
  { superscript: true }, { subscript: true }, { link: 'https://example.com' }])
  test(`深色主题的对比度装饰与 ${Object.keys(format)[0] || '文字颜色'} 组合时，扩展改色不重建节点`, t => {
    const { api, el, changes, flush } = fixture(t, { color: '#336699', ...format },
      { background: '#212121', foreground: '#eeeeee' })
    const before = api.document, nodes = [...el.querySelectorAll('.outline-contrast')]
    assert.ok(nodes.length >= 2)
    for (let round = 0; round < 10; round++) {
      for (const node of nodes)
        node.style.setProperty('--darkreader-text--outline-readable-ink', round % 2 ? '#88aacc' : '#99bbdd')
      flush()
      assert.ok(nodes.every(node => node.isConnected), '对比度装饰上的扩展变量不能触发节点替换')
      assert.deepEqual(api.document, before)
      assert.equal(changes.length, 0)
    }
    for (const node of nodes) node.style.removeProperty('--darkreader-text--outline-readable-ink')
    flush()
    assert.ok(nodes.every(node => node.isConnected))
    // Text changes inside the same decoration must still reach the document.
    nodes[0].firstChild.textContent = '对比度文字输入'
    flush()
    assert.match(documentText(api.document), /^对比度文字输入/)
    assert.equal(changes.length, 1)
  })

test('扩展改色后仍接受文字输入、格式命令、粘贴和重新载入', t => {
  const { api, el, changes, flush } = fixture(t, { color: '#336699' })
  const span = el.querySelector('span[style*="color"]')
  span.style.setProperty('--darkreader-inline-color', '#88aacc')
  span.setAttribute('data-darkreader-inline-color', '')
  flush()
  const original = api.document
  span.firstChild.textContent = '输入中文'
  flush()
  assert.match(documentText(api.document), /^输入中文粗体普通文字$/)
  assert.equal(changes.length, 1)
  api.editor.commands.selectAll()
  api.exec('color', '#00ff00')
  api.exec('highlight', '#ffff00')
  assert.ok(api.document.elements[0].runs.every(run => run.format.color === '#00ff00' && run.format.highlight === '#ffff00'))
  api.editor.view.pasteHTML('<p>粘贴<strong>粗体</strong></p>')
  assert.match(documentText(api.document), /粘贴粗体/)
  assert.ok(api.document.elements[0].runs.some(run => run.text === '粗体' && run.format.bold))
  assert.equal(JSON.stringify(api.document).includes('darkreader'), false)
  api.setDocument(original)
  assert.deepEqual(api.document, original)
})

test('仅忽略扩展显示属性，保留真实颜色、字体、优先级及内容变化', t => {
  const { api } = fixture(t, { color: '#336699' })
  const mark = api.editor.state.schema.marks.textStyle.create({ color: '#336699' })
  const view = darkReaderMarkViews.textStyle(mark, api.editor.view, true)
  const styleMutation = (before, after) => {
    view.dom.setAttribute('style', after)
    return view.ignoreMutation({ type: 'attributes', target: view.dom, attributeName: 'style', oldValue: before })
  }
  assert.equal(styleMutation('color: red', 'color: red; --darkreader-inline-color: pink'), true)
  assert.equal(styleMutation('color: red; --darkreader-inline-color: pink', 'color: red'), true)
  assert.equal(styleMutation('color: red; font-size: 12pt', 'font-size: 12pt; color: red; --darkreader-inline-color: pink'), true)
  assert.equal(styleMutation('color: red', 'color: blue; --darkreader-inline-color: pink'), false)
  assert.equal(styleMutation('color: red', 'color: red !important; --darkreader-inline-color: pink'), false)
  assert.equal(styleMutation('font-size: 12pt', 'font-size: 18pt; --darkreader-inline-color: pink'), false)
  assert.equal(styleMutation('color: red; --app-color: blue', 'color: red; --app-color: green'), false)
  assert.equal(view.ignoreMutation({ type: 'attributes', target: view.dom, attributeName: 'class' }), false)
  assert.equal(view.ignoreMutation({ type: 'attributes', target: view.dom, attributeName: 'data-darkreader-inline-color' }), true)
  assert.equal(view.ignoreMutation({ type: 'attributes', target: document.createElement('span'), attributeName: 'data-darkreader-inline-color' }), false)
  const contrast = document.createElement('span')
  contrast.className = 'outline-contrast'
  view.contentDOM.append(contrast)
  contrast.style.cssText = '--outline-readable-ink: red; --darkreader-text--outline-readable-ink: pink'
  const mutation = { type: 'attributes', target: contrast, attributeName: 'style', oldValue: '--outline-readable-ink: red' }
  assert.equal(view.ignoreMutation(mutation), true)
  contrast.style.setProperty('--outline-readable-ink', 'blue')
  assert.equal(view.ignoreMutation(mutation), false)
  assert.equal(view.ignoreMutation({ type: 'attributes', target: contrast, attributeName: 'class' }), false)
  for (const type of ['childList', 'characterData', 'selection'])
    assert.equal(view.ignoreMutation({ type, target: view.dom }), false)
})
