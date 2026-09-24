import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import freePage from '../plugins/free-page-editor/client.js'

test('自由页面等待可见尺寸再恢复滚动，隐藏通知和快速切换不覆盖各篇位置', async () => {
  const window = new Window(), previous = new Map(), cleanups = []
  let onResize, notify, viewport, paper, root, visible = false, scrollable = false, scrollCalls = 0
  let note = { id: 'a', type: 'freeform', blocks: [] }
  const model = { current: () => note, busy: false, editable: true,
    observe(owner, handler) { notify = handler; handler() } }
  const effect = fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) }
  for (const [name, value] of Object.entries({
    document: window.document, sessionStorage: window.sessionStorage,
    ResizeObserver: class {
      constructor(callback) { onResize = callback }
      observe() {}
      disconnect() { onResize = null }
    },
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  try {
    sessionStorage.setItem('cordis-page-scroll-a', '[600,900]')
    sessionStorage.setItem('cordis-page-scroll-b', '[1200,1800]')
    const sdk = {
      effect,
      el(tag, attrs = {}, text = '') {
        const el = document.createElement(tag)
        for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
        el.textContent = text
        return el
      },
      listen(el, event, handler) {
        el.addEventListener(event, handler)
        cleanups.push(() => el.removeEventListener(event, handler))
      },
    }
    freePage({
      notebook: model, noteFormats: { typeOf: value => value?.type }, effect,
      // Toolbar rendering is irrelevant to viewport geometry in this DOM test.
      ui: { h: () => null, React: {}, mount: () => ({ render() {} }) },
      editorHost: { register(owner, type, node) {
        root = node
        document.body.append(node)
        viewport = node.querySelector('.free-page-viewport')
        paper = node.querySelector('.free-page-paper')
        Object.defineProperties(viewport, {
          clientWidth: { get: () => visible ? 400 : 0 },
          clientHeight: { get: () => visible ? 300 : 0 },
        })
        Object.defineProperties(paper, {
          offsetWidth: { get: () => visible ? parseFloat(paper.style.width) || 0 : 0 },
          offsetHeight: { get: () => visible ? parseFloat(paper.style.height) || 0 : 0 },
        })
        viewport.scrollTo = (left, top) => {
          scrollCalls++
          viewport.scrollLeft = visible && scrollable ? Math.min(left, Math.max(0, paper.offsetWidth - viewport.clientWidth)) : 0
          viewport.scrollTop = visible && scrollable ? Math.min(top, Math.max(0, paper.offsetHeight - viewport.clientHeight)) : 0
        }
      } },
    }, sdk)
    const position = () => [viewport.scrollLeft, viewport.scrollTop]
    const scrollEvent = () => viewport.dispatchEvent(new window.Event('scroll'))
    notify(); onResize(); scrollEvent()
    assert.equal(scrollCalls, 0, '隐藏时不尝试恢复或测量为零的视口')
    assert.equal(sessionStorage.getItem('cordis-page-scroll-a'), '[600,900]')
    visible = true; onResize()
    scrollEvent(); notify()
    assert.equal(sessionStorage.getItem('cordis-page-scroll-a'), '[600,900]', '样式尚未生效时不覆盖恢复目标')
    scrollable = true; onResize()
    assert.deepEqual(position(), [600, 900])
    scrollEvent()
    // A -> plain -> A: delayed reveal and redundant model notifications.
    note = { id: 'plain', type: 'plain' }; notify(); visible = false; onResize()
    viewport.scrollLeft = viewport.scrollTop = 0; scrollEvent()
    note = { id: 'a', type: 'freeform', blocks: [] }; notify(); notify(); scrollEvent()
    visible = true; onResize()
    assert.deepEqual(position(), [600, 900])
    // Switch again before the pending restoration gets a visible viewport.
    note = { id: 'plain', type: 'plain' }; notify(); visible = false
    note = { id: 'a', type: 'freeform', blocks: [] }; notify()
    note = { id: 'b', type: 'freeform', blocks: [] }; notify(); scrollEvent()
    visible = true; onResize()
    assert.deepEqual(position(), [1200, 1800])
    note = { id: 'a', type: 'freeform', blocks: [] }; notify()
    assert.deepEqual(position(), [600, 900])
    // An ancestor can hide the mobile pane while root.hidden remains false.
    assert.equal(root.hidden, false)
    visible = false; viewport.scrollLeft = viewport.scrollTop = 0; scrollEvent()
    assert.equal(sessionStorage.getItem('cordis-page-scroll-a'), '[600,900]')
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup()
    await window.happyDOM.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})
