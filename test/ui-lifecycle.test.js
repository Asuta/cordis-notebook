import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { Context, Service } from 'cordis'

test('React UI 订阅在 Cordis 代理变化时保持稳定，消费插件停用后清理 DOM 与订阅，恢复不重复挂载', async () => {
  const window = new Window({ url: 'http://localhost/' }),
    previous = new Map()
  for (const name of [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'Node',
    'MutationObserver',
    'CustomEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame'
  ]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    const value =
      name === 'window'
        ? window
        : typeof window[name] === 'function' &&
            ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(name)
          ? window[name].bind(window)
          : window[name]
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  const root = new Context(),
    container = document.createElement('div'),
    listeners = new Set()
  let value = 0,
    renders = 0,
    subscriptions = 0
  document.body.append(container)
  try {
    const { createUI } = await import('../plugins/ui/runtime.bundle.js')
    const provider = await root.plugin((ctx) => {
      Object.assign(new Service(ctx, 'ui'), createUI())
    })
    Object.assign(new Service(root, 'counter'), {
      getValue: () => value,
      observe(owner, handler) {
        subscriptions++
        return owner.effect(() => {
          listeners.add(handler)
          handler()
          return () => listeners.delete(handler)
        })
      }
    })
    const consumer = root.plugin({
      inject: ['ui', 'counter'],
      apply(ctx) {
        const { h, useObserve } = ctx.ui
        function Counter() {
          renders++
          useObserve(ctx, ctx.counter)
          return h('span', null, String(ctx.counter.getValue()))
        }
        ctx.ui.mount(ctx, container, h(Counter))
      }
    })
    await consumer
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(container.textContent, '0')
    assert.equal(subscriptions, 1)
    value = 1
    for (const listener of listeners) listener()
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(container.textContent, '1')
    assert.ok(renders < 8, '同步 observe 不能形成 React 重渲染循环')
    assert.equal(listeners.size, 1)
    await provider.dispose()
    assert.equal(container.textContent, '')
    assert.equal(listeners.size, 0)
    await root.plugin((ctx) => {
      Object.assign(new Service(ctx, 'ui'), createUI())
    })
    await consumer
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(container.textContent, '1')
    assert.equal(container.childElementCount, 1)
    assert.equal(listeners.size, 1)
    await consumer.dispose()
    assert.equal(listeners.size, 0)
    assert.equal(container.childElementCount, 0)
    let failures = 0
    container.addEventListener('cordis-ui-error', () => failures++)
    const broken = root.plugin({ inject: ['ui'], apply(ctx) {
      function Broken() { throw new Error('组件测试错误') }
      ctx.ui.mount(ctx, container, ctx.ui.h(Broken))
    } })
    await broken
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(failures, 1)
    assert.match(container.textContent, /界面加载失败/)
    await broken.dispose()
    assert.equal(container.childElementCount, 0)
  } finally {
    await root.fiber.dispose()
    await window.happyDOM.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})
