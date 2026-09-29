import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'

const densityKey = 'cordis-notebook-list-density'

async function until(check) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)) }
  throw Error('界面没有按预期更新')
}

// 笔记列表的详细 / 折叠两种显示模式及其偏好持久化。
async function mountList(initial = {}) {
  const window = new Window(), previous = new Map(), store = new Map(Object.entries(initial))
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value = name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  // sdk.storage 与浏览器全局都提供同一份存储，用来验证两种读取路径都不报错。
  const storage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => { store.set(key, String(value)) }, removeItem: key => { store.delete(key) } }
  const sidebar = document.createElement('div'); document.body.append(sidebar)
  const saved = [{ id: 'A', title: 'A', content: '正文 A', pinned: false, createdAt: '2020-01-01', updatedAt: '2020-01-01' }]
  const root = new Context()
  const sdkFor = ctx => ({
    storage: { local: storage, session: storage },
    el(tag, props = {}) { const node = document.createElement(tag); for (const [key, value] of Object.entries(props)) key === 'class' ? node.className = value : node[key] = value; return node },
    provide(name, value) { return Object.defineProperties(new Service(ctx, name), Object.getOwnPropertyDescriptors(value)) },
    mount(_name, node) { ctx.effect(() => { sidebar.append(node); return () => node.remove() }); return node },
    slot() {}, toast(message) { throw Error(message) },
  })
  const { default: ui } = await import('../applications/notebook/plugins/ui/dist/client.js')
  await root.plugin(ctx => ui(ctx, sdkFor(ctx)))
  await root.plugin(noteFormats); await root.plugin(formatPlain)
  new Service(root, 'shell')
  new Service(root, 'notesApi').request = async (path, method, data) => {
    if (!method) return structuredClone(saved)
    if (method === 'PATCH') { const note = saved.find(note => path === '/' + note.id); Object.assign(note, data); return structuredClone(note) }
    throw Error('意外请求')
  }
  await root.plugin({ inject: ['notesApi', 'noteFormats'], async apply(ctx) { await createNotebook(ctx, sdkFor(ctx), { storage, draftKey: 'test', autosaveMs: 60000 }) } })
  const { default: list } = await import('../applications/notebook/plugins/note-list/dist/client.js')
  await root.plugin({ inject: ['ui', 'notebook', 'noteFormats', 'shell'], apply: ctx => list(ctx, sdkFor(ctx)) })
  await until(() => sidebar.querySelector('.note-card'))
  const toggle = () => sidebar.querySelector('.density-toggle')
  const card = () => sidebar.querySelector('.note-card')
  const click = () => toggle().dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return {
    sidebar, store, toggle, card, click,
    list: () => sidebar.querySelector('.note-list'),
    dispose: async () => {
      await root.fiber.dispose(); await window.happyDOM.close()
      for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]
    },
  }
}

test('笔记列表可在详细与折叠模式间切换，并记住选择', async () => {
  const view = await mountList()
  try {
    assert.equal(view.list().classList.contains('compact'), false)
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'false')
    assert.ok(view.card().querySelector('.card-preview'))
    assert.ok(view.card().querySelector('.card-meta'))

    view.click()
    await until(() => view.list().classList.contains('compact'))
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'true')
    assert.equal(view.card().querySelector('.card-preview'), null)
    assert.equal(view.card().querySelector('.card-meta'), null)
    assert.equal(view.card().querySelector('.card-title span').textContent, 'A')
    assert.equal(view.store.get(densityKey), 'compact')

    view.click()
    await until(() => !view.list().classList.contains('compact'))
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'false')
    assert.ok(view.card().querySelector('.card-preview'))
    assert.equal(view.store.get(densityKey), 'comfortable')
  } finally { await view.dispose() }
})

test('已保存的折叠模式在重新打开列表时直接生效', async () => {
  const view = await mountList({ [densityKey]: 'compact' })
  try {
    assert.equal(view.list().classList.contains('compact'), true)
    assert.equal(view.toggle().getAttribute('aria-pressed'), 'true')
    assert.equal(view.card().querySelector('.card-preview'), null)
  } finally { await view.dispose() }
})

test('异常偏好值回退到详细模式', async () => {
  const view = await mountList({ [densityKey]: 'unexpected' })
  try {
    assert.equal(view.list().classList.contains('compact'), false)
    assert.ok(view.card().querySelector('.card-preview'))
  } finally { await view.dispose() }
})
