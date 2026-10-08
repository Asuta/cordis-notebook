import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { setTimeout as delay } from 'node:timers/promises'

test('新格式的图标和宽版布局由声明驱动，缺失格式回退且切换不残留', async () => {
  const window = new Window(), previous = new Map(), root = new Context()
  for (const name of ['window','document','navigator','HTMLElement','Node','MutationObserver','CustomEvent','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value = name === 'window' ? window : ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name) ? window[name].bind(window) : window[name]
    Object.defineProperty(globalThis, name, {value, configurable:true, writable:true})
  }
  const listeners = new Set(), targets = Object.fromEntries(['sidebar','editor','toolbar'].map(name => [name, document.createElement('div')]))
  Object.values(targets).forEach(node => document.body.append(node))
  const observe = (owner, fn) => owner.effect(() => {listeners.add(fn); fn(); return () => listeners.delete(fn)})
  const notify = async check => {
    for (const fn of listeners) fn()
    const deadline = Date.now() + 5000
    while (true) {
      try { check(); return }
      catch (error) {
        if (!(error instanceof assert.AssertionError) || Date.now() >= deadline) throw error
      }
      await delay(10)
    }
  }
  const notes = [{id:'a',type:'new-format',title:'自定义格式',content:'内容',updatedAt:'2026-09-25'}, {id:'b',type:'missing',title:'未知格式',content:'保留内容',updatedAt:'2026-09-25'}]
  let selected = notes[0]
  const formats = new Map([['new-format', {type:'new-format',label:'自定义格式',icon:'Sun',editor:'custom',editorLayout:'wide'}]])
  const sdkFor = ctx => ({
    el: (tag, props = {}) => {const node = document.createElement(tag); for (const [key, value] of Object.entries(props)) key === 'class' ? node.className = value : node[key] = value; return node},
    provide: (name, value) => Object.assign(new Service(ctx, name), value),
    mount: (name, node) => {ctx.effect(() => {targets[name].append(node); return () => node.remove()}); return node},
    slot() {}, toast(message) { throw new Error(message) },
    button(name, text, fn) { const button = document.createElement('button'); button.textContent = text; button.onclick = fn; return this.mount(name, button) },
  })
  try {
    const {default: ui} = await import('../applications/notebook/plugins/ui/dist/client.js')
    await root.plugin(ctx => ui(ctx, sdkFor(ctx)))
    Object.assign(new Service(root,'notebook'), {notes, current:()=>selected, visible:()=>notes, observe, busy:false, editable:true})
    Object.assign(new Service(root,'noteFormats'), {get:type=>formats.get(type), list:()=>[...formats.values()], typeOf:note=>note?.type, observe})
    new Service(root,'shell')
    const {default: list} = await import('../applications/notebook/plugins/note-list/dist/client.js')
    const {default: editorHost} = await import('../applications/notebook/plugins/editor-host/dist/client.js')
    const listFiber = root.plugin({inject:['ui','notebook','noteFormats','shell'], apply:ctx => list(ctx, sdkFor(ctx))})
    const editorFiber = root.plugin({inject:['ui','notebook','noteFormats'], apply:ctx => editorHost(ctx, sdkFor(ctx))})
    await listFiber; await editorFiber
    assert.ok(targets.sidebar.querySelector('.note-card svg.lucide-sun'))
    assert.ok(targets.sidebar.querySelectorAll('.note-card')[1].querySelector('svg.lucide-file-text'))
    assert.equal(targets.editor.querySelector('.editor-writing').dataset.editorLayout, 'wide')
    const custom = document.createElement('section'), headingTarget = document.createElement('div')
    custom.append(headingTarget)
    const unregister = root.editorHost.register(root, 'custom', custom, { headingTarget })
    await notify(() => {
      assert.equal(headingTarget.querySelector('#title')?.value, '自定义格式')
      assert.equal(targets.editor.querySelectorAll('#title').length, 1)
      assert.ok(!targets.editor.querySelector('.editor-writing > .note-heading'))
    })
    formats.set('new-format', {...formats.get('new-format'), icon:'Moon', editorLayout:'standard'})
    await notify(() => {
      assert.ok(targets.sidebar.querySelector('.note-card svg.lucide-moon'))
      assert.equal(targets.editor.querySelector('.editor-writing').dataset.editorLayout, 'standard')
    })
    formats.set('new-format', {...formats.get('new-format'), editorLayout:'wide'})
    await notify(() => assert.equal(targets.editor.querySelector('.editor-writing').dataset.editorLayout, 'wide'))
    selected = notes[1]
    await notify(() => {
      assert.ok(!headingTarget.querySelector('#title'))
      assert.equal(targets.editor.querySelector('.editor-writing').dataset.editorLayout, 'standard')
      assert.equal(targets.editor.querySelector('#title')?.value, '未知格式')
      assert.match(targets.editor.textContent, /格式插件/)
    })
    selected = notes[0]
    await notify(() => assert.ok(headingTarget.querySelector('#title')))
    unregister()
    await notify(() => {
      assert.ok(targets.editor.querySelector('.editor-writing > .note-heading > #title'))
      assert.equal(targets.editor.querySelectorAll('#title').length, 1)
    })
    await editorFiber.dispose(); await listFiber.dispose()
    assert.equal(targets.editor.childElementCount, 0)
    assert.equal(targets.sidebar.childElementCount, 0)
    assert.equal(listeners.size, 0)
  } finally {
    await root.fiber.dispose(); await window.happyDOM.close()
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis,name,descriptor) : delete globalThis[name]
  }
})
