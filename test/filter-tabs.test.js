import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { createNotebook } from '../applications/notebook/plugins/notebook/model.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'

async function until(check, message = '界面没有按预期更新') {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)) }
  throw Error(message)
}

test('筛选切换时胶囊跟随激活按钮，列表按新筛选重播入场动效', async () => {
  const window = new Window(), previous = new Map(), root = new Context(), animations = []
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'MutationObserver', 'CustomEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value = name === 'window' ? window : ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  window.Element.prototype.animate = function (frames, options) { animations.push({ target: this, delay: options.delay }); return { cancel() {}, finished: Promise.resolve() } }
  const targets = Object.fromEntries(['sidebar', 'toolbar'].map(name => [name, document.createElement('div')]))
  Object.values(targets).forEach(node => document.body.append(node))
  const target = name => targets[name] ||= (node => (document.body.append(node), node))(document.createElement('div'))
  const slots = new Map()
  let saved = [
    { id: 'A', title: '置顶笔记', content: '', pinned: true, createdAt: '2020-01-01', updatedAt: '2020-01-04' },
    { id: 'B', title: 'B', content: '', pinned: false, createdAt: '2020-01-01', updatedAt: '2020-01-03' },
    { id: 'C', title: 'C', content: '', pinned: false, createdAt: '2020-01-01', updatedAt: '2020-01-02' },
    { id: 'D', title: 'D', content: '', pinned: true, createdAt: '2020-01-01', updatedAt: '2020-01-01' },
  ]
  const sdkFor = ctx => ({
    el(tag, props = {}, text) {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key.startsWith('aria-')) node.setAttribute(key, value); else node[key] = value }
      if (text !== undefined) node.textContent = text
      return node
    },
    provide(name, value) { return Object.defineProperties(new Service(ctx, name), Object.getOwnPropertyDescriptors(value)) },
    mount(name, node) { ctx.effect(() => { (slots.get(name)?.at(-1) || target(name)).append(node); return () => node.remove() }); return node },
    slot(name, node) { const list = slots.get(name) || []; list.push(node); slots.set(name, list); ctx.effect(() => () => list.splice(list.indexOf(node), 1)) },
    toast(message) { throw Error(message) },
    listen(target, event, handler) { target.addEventListener(event, handler) },
    button(name, label, handler) { const node = document.createElement('button'); node.textContent = label; node.onclick = handler; return this.mount(name, node) },
  })
  try {
    const { default: ui } = await import('../applications/notebook/plugins/ui/dist/client.js')
    await root.plugin(ctx => ui(ctx, sdkFor(ctx)))
    await root.plugin(noteFormats); await root.plugin(formatPlain)
    new Service(root, 'shell')
    new Service(root, 'notesApi').request = async (path, method, data) => {
      if (!method) return structuredClone(saved)
      if (method === 'PATCH') { const note = saved.find(item => path === '/' + item.id); Object.assign(note, data); return structuredClone(note) }
      throw Error('意外请求')
    }
    await root.plugin({ inject: ['notesApi', 'noteFormats'], async apply(ctx) { await createNotebook(ctx, sdkFor(ctx), { storage: { getItem: () => null, setItem() {}, removeItem() {} }, draftKey: 'test', autosaveMs: 60000 }) } })
    const { default: list } = await import('../applications/notebook/plugins/note-list/dist/client.js')
    await root.plugin({ inject: ['ui', 'notebook', 'noteFormats', 'shell'], apply: ctx => list(ctx, sdkFor(ctx)) })
    const { default: pin } = await import('../applications/notebook/plugins/pin/dist/client.js')
    await root.plugin({ inject: ['notebook', 'noteListUI', 'shell'], apply: ctx => pin(ctx, sdkFor(ctx)) })

    const filters = targets.sidebar.querySelector('.list-filters .filters'), [pill, all, pinned] = [...filters.children]
    const cards = () => [...targets.sidebar.querySelectorAll('.note-card')]
    const titles = () => cards().map(node => node.querySelector('.card-title span').textContent)
    await until(() => titles().join() === '置顶笔记,D,B,C')
    assert.equal(pill.className, 'filter-pill')
    assert.equal(pill.getAttribute('aria-hidden'), 'true')
    assert.ok(all.classList.contains('active') && !pinned.classList.contains('active'))
    // 启动时的过滤器注册不改变可见集合，因此不重播入场动效。
    assert.deepEqual(animations, [])

    const box = (node, left, width) => { node.getBoundingClientRect = () => ({ top: 0, left, width, height: 26, right: left + width, bottom: 26 }) }
    box(filters, 10, 124); box(all, 10, 60); box(pinned, 74, 50)
    window.dispatchEvent(new window.Event('resize'))
    assert.equal(filters.style.getPropertyValue('--filter-pill-x'), '0px')
    assert.equal(filters.style.getPropertyValue('--filter-pill-width'), '60px')

    pinned.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await until(() => titles().join() === '置顶笔记,D')
    assert.ok(pinned.classList.contains('active') && !all.classList.contains('active'))
    assert.equal(filters.style.getPropertyValue('--filter-pill-x'), '64px')
    assert.equal(filters.style.getPropertyValue('--filter-pill-width'), '50px')
    assert.deepEqual(animations.map(entry => entry.delay), [0, 22])
    assert.deepEqual(animations.map(entry => entry.target), cards())

    // 选择与编辑只改变内容，不重播筛选动效。
    await root.notebook.choose('D'); root.notebook.edit({ title: '改过的标题' }); await root.notebook.flush()
    await until(() => titles().join() === '置顶笔记,改过的标题')
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(animations.length, 2)

    all.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await until(() => titles().join() === '置顶笔记,改过的标题,B,C')
    assert.deepEqual(animations.slice(2).map(entry => entry.delay), [0, 22, 44, 66])
  } finally {
    await root.fiber.dispose(); await window.happyDOM.close()
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]
  }
})
