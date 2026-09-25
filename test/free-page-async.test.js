import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import freePage from '../plugins/free-page-editor/dist/client.js'
import { mountEditor } from '../plugins/rich-text/engine.js'
import { documentService } from '../plugins/rich-text/document.js'
import { createFreeformFormat } from '../plugins/format-freeform/format.js'

function fixture(t) {
  const window = new Window(), previous = new Map(), cleanups = [], commands = new Map(), editors = new Map()
  for (const [key, value] of Object.entries({
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    MutationObserver: window.MutationObserver, sessionStorage: window.sessionStorage,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) cleanup()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const effect = fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); return cleanup }
  const format = createFreeformFormat(documentService)
  let note = {
    id: 'page', type: 'freeform', version: 2, page: { color: '#ffffff', rule: 'none' },
    blocks: ['one', 'two'].map((id, i) => ({
      id, x: 40 + i * 400, y: 40, width: 320, text: id, outline: documentService.plain(id, id),
    })),
  }
  let root, notify, finishUpload
  freePage({
    effect,
    noteAssets: { upload: () => new Promise(resolve => { finishUpload = resolve }) },
    noteFormats: { typeOf: n => n.type },
    notebook: {
      busy: false, editable: true, current: () => note,
      observe(owner, fn) { notify = fn; fn() },
      edit(patch) { note = { ...note, ...format.normalize(patch) }; notify() },
    },
    richText: {
      ...documentService,
      mount(owner, body, options) {
        const editor = mountEditor(owner, body, options)
        editors.set(body.parentElement.getAttribute('data-block-id'), { editor, images: options.images })
        return editor
      },
    },
    // Exercise actual toolbar callbacks without requiring React to render this fixture.
    ui: {
      h(component, props) {
        if (typeof component === 'function') return component(props)
        if (props?.['aria-label']) commands.set(props['aria-label'], props.onClick)
        return null
      },
      React: { useState: value => [value === 'home' ? 'insert' : value, () => {}] },
      mount: () => ({ render() {} }),
    },
    editorHost: { register(owner, type, node) {
      root = node; document.body.append(node)
      const viewport = node.querySelector('.free-page-viewport')
      Object.defineProperties(viewport, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
      viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700 })
      viewport.scrollTo = (left, top) => { viewport.scrollLeft = left; viewport.scrollTop = top }
    } },
  }, {
    effect, toast: text => assert.fail(text),
    el(tag, attrs = {}, text = '') {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
      node.textContent = text; node.setPointerCapture = () => {}
      return node
    },
    listen(node, event, handler) { node.addEventListener(event, handler); cleanups.push(() => node.removeEventListener(event, handler)) },
  })
  return {
    get note() { return structuredClone(note) },
    commands, editors,
    finishUpload: () => finishUpload('/api/note-assets/' + 'a'.repeat(64) + '.png'),
    pointer(type, selector, x, y, shiftKey = false) {
      (selector ? root.querySelector(selector) : root).dispatchEvent(new window.PointerEvent(type, {
        bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y, shiftKey,
      }))
    },
    undo() { root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })) },
    redo() { root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })) },
  }
}

for (const action of ['move', 'resize', 'space', 'merge']) test(`图片上传与${action}手势重叠时保留内容，撤销只还原手势`, async t => {
  const f = fixture(t)
  // Upload into the other block during a move too: its focus must not change
  // which blocks belong to the gesture already in progress.
  const imageBlock = action === 'move' ? 'two' : 'one'
  const upload = f.editors.get(imageBlock).images([{ name: 'review.png' }])
  const selector = action === 'space' ? '.free-page-paper' : `[data-block-id=one] .free-block-${action === 'resize' ? 'resize' : 'handle'}`
  if (action === 'space') f.commands.get('插入空间')()
  f.pointer('pointerdown', selector, 50, action === 'space' ? 20 : 45)
  f.finishUpload(); await upload
  const withImage = f.note
  assert.ok(withImage.blocks.find(b => b.id === imageBlock).outline.elements.some(n => n.kind === 'image'))
  f.pointer('pointerup', null, action === 'merge' ? 460 : 100, action === 'space' ? 50 : 75, action === 'merge')
  const after = f.note
  assert.equal(after.blocks.flatMap(b => b.outline.elements).filter(n => n.kind === 'image').length, 1)
  assert.ok(after.blocks.some(b => b.text.includes('one')))
  assert.ok(after.blocks.some(b => b.text.includes('two')))
  if (action === 'move') { assert.equal(after.blocks[0].x, 90); assert.equal(after.blocks[1].x, 440) }
  if (action === 'resize') assert.equal(after.blocks[0].width, 370)
  if (action === 'space') assert.deepEqual(after.blocks.map(b => b.y), [70, 70])
  if (action === 'merge') assert.equal(after.blocks.length, 1)
  f.undo(); assert.deepEqual(f.note, withImage)
  f.redo(); assert.deepEqual(f.note, after)
})
