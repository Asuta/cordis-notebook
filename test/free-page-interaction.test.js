import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import freePage from '../applications/notebook/plugins/free-page-editor/dist/client.js'
import { documentService } from '../applications/notebook/plugins/rich-text/document.js'
import { createFreeformFormat } from '../applications/notebook/plugins/format-freeform/format.js'

test('容器快速拖动与缩放坐标正确，Shift 合并保留富文本且一次撤销恢复', async () => {
  const window = new Window(),
    previous = new Map(),
    cleanups = []
  for (const [key, value] of Object.entries({
    window,
    document: window.document,
    sessionStorage: window.sessionStorage,
    MutationObserver: window.MutationObserver,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  let root,
    notify,
    destroyed = 0
  const effect = (fn) => {
    const cleanup = fn()
    if (cleanup) cleanups.push(cleanup)
    return cleanup
  }
  let note = {
    id: 'a',
    type: 'freeform',
    blocks: [
      { id: 'one', x: 40, y: 40, width: 320, text: '第一段', outline: documentService.plain('第一段', 'one') },
      { id: 'two', x: 440, y: 40, width: 320, text: '第二段', outline: documentService.plain('第二段', 'two') },
    ],
    version: 2,
    page: { color: '#ffffff', rule: 'none' },
  }
  note.blocks[0].outline.elements[0].runs[0].format = { bold: true }
  const original = structuredClone(note.blocks),
    format = createFreeformFormat(documentService)
  try {
    freePage(
      {
        effect,
        noteAssets: {},
        noteFormats: { typeOf: (n) => n.type },
        notebook: {
          current: () => note,
          busy: false,
          editable: true,
          observe(owner, fn) {
            notify = fn
            fn()
          },
          edit(patch) {
            note = { ...note, ...format.normalize(patch) }
            notify()
          },
        },
        richText: {
          ...documentService,
          mount(owner, body, options) {
            return {
              composing: false,
              setEditable() {},
              setDocument() {},
              setAppearance() {},
              status: () => ({}),
              focus: () => options.focus(),
              destroy: () => destroyed++,
            }
          },
        },
        ui: { h: () => null, React: {}, mount: () => ({ render() {} }) },
        editorHost: {
          register(owner, type, node) {
            root = node
            document.body.append(node)
            const viewport = node.querySelector('.free-page-viewport')
            Object.defineProperties(viewport, { clientWidth: { value: 1000 }, clientHeight: { value: 700 } })
            viewport.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 700 })
            viewport.scrollTo = (left, top) => {
              viewport.scrollLeft = left
              viewport.scrollTop = top
            }
          },
        },
      },
      {
        effect,
        toast: (text) => assert.fail(text),
        el(tag, attrs = {}, text = '') {
          const node = document.createElement(tag)
          for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
          node.textContent = text
          node.setPointerCapture = () => {}
          return node
        },
        listen(node, event, handler) {
          node.addEventListener(event, handler)
          cleanups.push(() => node.removeEventListener(event, handler))
        },
      },
    )
    const drag = (selector, from, to, shiftKey = false) => {
      root
        .querySelector(selector)
        .dispatchEvent(
          new window.PointerEvent('pointerdown', {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: from[0],
            clientY: from[1],
            shiftKey,
          }),
        )
      root.dispatchEvent(
        new window.PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          clientX: to[0],
          clientY: to[1],
          shiftKey,
        }),
      )
    }
    const key = (key) => root.dispatchEvent(new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }))
    drag('[data-block-id=one] .free-block-handle', [50, 45], [100, 75])
    assert.equal(note.blocks[0].x, 90)
    assert.equal(note.blocks[0].y, 70)
    key('z')
    assert.deepEqual(note.blocks, original)
    drag('[data-block-id=one] .free-block-handle', [50, 45], [460, 65], true)
    assert.equal(note.blocks.length, 1)
    assert.equal(note.blocks[0].text, '第二段\n第一段')
    assert.equal(note.blocks[0].outline.elements[1].runs[0].format.bold, true)
    key('z')
    assert.deepEqual(note.blocks, original)
    drag('[data-block-id=one] .free-block-resize', [350, 45], [400, 45])
    assert.equal(note.blocks[0].width, 370)
    key('z')
    assert.deepEqual(note.blocks, original)
    const viewport = root.querySelector('.free-page-viewport')
    key('+')
    drag('[data-block-id=one] .free-block-handle', [55, 50], [165, 50])
    assert.ok(
      Math.abs(note.blocks[0].x - 140) < 0.01,
      '缩放坐标实际为 ' + note.blocks[0].x + '，' + root.querySelector('.free-page-status').textContent,
    )
    assert.ok(destroyed >= 1, '合并清理被移除容器的编辑器')
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
