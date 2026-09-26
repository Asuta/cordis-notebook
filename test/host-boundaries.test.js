import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from 'cordis'
import { Window } from 'happy-dom'
import { createMounts } from '../client/host/mounts.js'
import { mountStyles } from '../client/host/styles.js'

test('挂载点由服务提供者声明，替换提供者不依赖插件 ID，同名挂载点不可重复占用', async () => {
  const root = new Context(), mounts = createMounts(), original = new Set(), replacement = new Set()
  const node = { remove() { original.delete(node); replacement.delete(node) } }
  const target = set => ({ append(value) { set.add(value) } })
  const consumer = root.plugin({ inject:['shell'], apply(ctx) { mounts.mount(ctx, 'toolbar', node) } })
  try {
    const first = root.plugin(ctx => { mounts.register(ctx, 'toolbar', target(original)); new Service(ctx,'shell') })
    await first; await consumer
    assert.ok(original.has(node))
    await first.dispose(); assert.equal(original.size,0)
    const second = root.plugin(ctx => { mounts.register(ctx, 'toolbar', target(replacement)); new Service(ctx,'shell') })
    await second; await consumer
    assert.ok(replacement.has(node))
    assert.throws(() => mounts.register(root, 'toolbar', target(new Set())), /插槽已被占用/)
    await second.dispose(); assert.equal(replacement.size, 0)
    assert.throws(()=>mounts.mount(root,'toolbar',node),/缺少界面扩展/)
  } finally {await root.fiber.dispose()}
})

test('声明的 CSS 在激活前就绪，停用和加载失败均可清理', async () => {
  const window = new Window({settings:{disableCSSFileLoading:true}}), previous=Object.getOwnPropertyDescriptor(globalThis,'document')
  Object.defineProperty(globalThis,'document',{value:window.document,configurable:true})
  const root=new Context();let activated=false
  try {
    const fiber=root.plugin(async ctx=>{await mountStyles(ctx,{id:'sample',styles:['style.css','utilities.css']});activated=true})
    await new Promise(resolve=>setImmediate(resolve))
    const links=[...document.head.querySelectorAll('link')]
    assert.equal(links.length,2);assert.equal(activated,false)
    links.forEach(link=>link.onload())
    await fiber;assert.equal(activated,true)
    await fiber.dispose();assert.equal(document.head.querySelectorAll('link').length,0)
    const failed=root.plugin(ctx=>mountStyles(ctx,{id:'broken',styles:['missing.css']}))
    await new Promise(resolve=>setImmediate(resolve))
    document.head.querySelector('link').onerror()
    await assert.rejects(failed.await(),/样式加载失败/)
    await failed.dispose();assert.equal(document.head.querySelectorAll('link').length,0)
  } finally {
    await root.fiber.dispose();await window.happyDOM.close()
    if(previous)Object.defineProperty(globalThis,'document',previous);else delete globalThis.document
  }
})
