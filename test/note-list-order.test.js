import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'

async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)) }
  throw Error('界面没有按预期更新')
}
for (const change of ['edit', 'pin']) test('笔记列表按显示顺序拖动，保留其他笔记位置：' + change, async () => {
  const window = new Window(), previous = new Map(), root = new Context(), orders = []
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value = name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  const sidebar = document.createElement('div'); document.body.append(sidebar)
  let saved = ['A', 'B', 'C', 'D'].map((id, i) => ({ id, title: id, content: '', pinned: false, createdAt: '2020-01-01', updatedAt: `2020-01-0${4 - i}` }))
  const sdkFor = ctx => ({
    el(tag, props = {}) { const node = document.createElement(tag); for (const [key, value] of Object.entries(props)) key === 'class' ? node.className = value : node[key] = value; return node },
    provide(name, value) { return Object.defineProperties(new Service(ctx, name), Object.getOwnPropertyDescriptors(value)) },
    mount(_name, node) { ctx.effect(() => { sidebar.append(node); return () => node.remove() }); return node },
    slot() {}, toast(message) { throw Error(message) },
  })
  try {
    const { default: ui } = await import('../applications/notebook/plugins/ui/dist/client.js')
    await root.plugin(ctx => ui(ctx, sdkFor(ctx)))
    await root.plugin(noteFormats); await root.plugin(formatPlain)
    new Service(root, 'shell')
    new Service(root, 'notesApi').request = async (path, method, data) => {
      if (!method) return structuredClone(saved)
      if (method === 'PATCH') {
        const note = saved.find(note => path === '/' + note.id)
        Object.assign(note, data, { updatedAt: new Date().toISOString() }); return structuredClone(note)
      }
      if (method === 'PUT') {
        orders.push(data.ids)
        saved = data.ids.map((id, order) => ({ ...saved.find(note => note.id === id), order }))
        return structuredClone(saved)
      }
      throw Error('意外请求')
    }
    await root.plugin({ inject: ['notesApi', 'noteFormats'], async apply(ctx) { await createNotebook(ctx, sdkFor(ctx), { storage: { getItem: () => null, setItem() {}, removeItem() {} }, draftKey: 'test', autosaveMs: 60000 }) } })
    const { default: list } = await import('../applications/notebook/plugins/note-list/dist/client.js')
    await root.plugin({ inject: ['ui', 'notebook', 'noteFormats', 'shell'], apply: ctx => list(ctx, sdkFor(ctx)) })
    const cards = () => [...sidebar.querySelectorAll('.note-card')]
    const titles = () => cards().map(node => node.querySelector('.card-title span').textContent)
    await until(() => titles().join() === 'A,B,C,D')
    await root.notebook.choose('C')
    root.notebook.edit(change === 'edit' ? { content: '编辑后的正文' } : { pinned: true })
    await root.notebook.flush()
    await until(() => titles().join() === 'C,A,B,D')
    assert.deepEqual(root.notebook.notes.map(note => note.id), ['A', 'B', 'C', 'D'])
    const dataTransfer = { setData(_type, value) { this.value = value }, getData() { return this.value } }
    const dispatch = (node, type) => {
      const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: 75 })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer }); node.dispatchEvent(event)
    }
    dispatch(cards()[3], 'dragstart')
    await until(() => cards()[3].classList.contains('dragging'))
    cards()[1].getBoundingClientRect = () => ({ top: 0, height: 100 })
    dispatch(cards()[1], 'dragover')
    await until(() => cards()[1].classList.contains('drop-after'))
    dispatch(cards()[1], 'drop')
    await until(() => orders.length === 1)
    assert.deepEqual(orders[0], ['C', 'A', 'D', 'B'])
    await until(() => titles().join() === 'C,A,D,B')
    assert.deepEqual(saved.map(note => note.id), ['C', 'A', 'D', 'B'])
  } finally {
    await root.fiber.dispose(); await window.happyDOM.close()
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]
  }
})
