import { test } from 'node:test'
import assert from 'node:assert/strict'
import createFocusTimer from '../client.js'
import { FINISH_MESSAGE, FOCUS_DURATION_MS } from '../timer.js'

/** 最小桩 DOM/SDK：只覆盖客户端入口用到的宿主契约，不替代真实浏览器验收。 */
function createElement(tag) {
  return {
    tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {}, listeners: {},
    textContent: '', disabled: false, className: '',
    append(...items) { this.children.push(...items) },
    setAttribute(name, value) { this.attributes[name] = String(value) },
    getAttribute(name) { return this.attributes[name] ?? null },
    addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler) },
    removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter(item => item !== handler) },
    listenerCount(type) { return (this.listeners[type] || []).length },
    click() { for (const handler of [...(this.listeners.click || [])]) handler() },
  }
}

function createHarness() {
  const mounted = [], cleanups = []
  const sdk = {
    el(tag, props = {}, text) {
      const node = createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value
        else if (key.startsWith('aria-')) node.setAttribute(key, value)
        else node[key] = value
      }
      if (text !== undefined) node.textContent = text
      return node
    },
    mount(name, node) { mounted.push({ name, node }); return node },
    listen(target, event, handler) {
      target.addEventListener(event, handler)
      cleanups.push(() => target.removeEventListener(event, handler))
    },
  }
  const ctx = { effect: callback => { const dispose = callback(); if (typeof dispose === 'function') cleanups.push(dispose) } }
  createFocusTimer(ctx, sdk)
  const root = mounted[0].node
  return { mounted, cleanups, root }
}

/** 可控时钟：替换 Date.now 与 setInterval，测试结束后必须 restore。 */
function createClock(start = 1_700_000_000_000) {
  const realNow = Date.now, realSetInterval = globalThis.setInterval, realClearInterval = globalThis.clearInterval
  let now = start, seq = 0
  const intervals = new Map()
  globalThis.Date.now = () => now
  globalThis.setInterval = (fn, ms) => { intervals.set(++seq, { fn, ms }); return seq }
  globalThis.clearInterval = id => { intervals.delete(id) }
  return {
    advance(ms) { now += ms; for (const entry of [...intervals.values()]) entry.fn() },
    active: () => intervals.size,
    restore() { globalThis.Date.now = realNow; globalThis.setInterval = realSetInterval; globalThis.clearInterval = realClearInterval },
  }
}

const withClock = body => {
  const clock = createClock()
  try { body(clock) } finally { clock.restore() }
}

test('挂载到编辑区底栏，初始显示 25:00 待机', () => {
  const { mounted, root } = createHarness()
  const [caption, clock, toggle, reset, notice] = root.children
  assert.equal(mounted.length, 1)
  assert.equal(mounted[0].name, 'footer')
  assert.equal(root.className, 'focus-timer')
  assert.equal(root.getAttribute('role'), 'group')
  assert.equal(caption.textContent, '专注')
  assert.equal(clock.textContent, '25:00')
  assert.equal(toggle.textContent, '开始')
  assert.equal(reset.disabled, true, '待机时重置没有可重置的内容')
  assert.equal(notice.textContent, '')
  assert.equal(notice.getAttribute('role'), 'status')
})

test('开始后按剩余时间推进显示，暂停保留剩余时间，重置回到满时长', () => {
  withClock(clock => {
    const { root } = createHarness()
    const [, display, toggle, reset] = root.children
    toggle.click()
    assert.equal(toggle.textContent, '暂停')
    assert.equal(reset.disabled, false)
    assert.equal(display.textContent, '25:00')
    assert.equal(clock.active(), 1, '只创建一个定时器')
    clock.advance(90_000)
    assert.equal(display.textContent, '23:30')
    toggle.click()
    assert.equal(toggle.textContent, '继续')
    assert.equal(clock.active(), 0, '暂停后不再走钟')
    clock.advance(600_000)
    assert.equal(display.textContent, '23:30')
    toggle.click()
    assert.equal(clock.active(), 1)
    clock.advance(30_000)
    assert.equal(display.textContent, '23:00', '继续后沿用剩余时间')
    reset.click()
    assert.equal(display.textContent, '25:00')
    assert.equal(toggle.textContent, '开始')
    assert.equal(clock.active(), 0)
  })
})

test('一轮走完显示温和提示并停止走钟，再次开始是新的一轮', () => {
  withClock(clock => {
    const { root } = createHarness()
    const [, display, toggle, , notice] = root.children
    toggle.click()
    clock.advance(FOCUS_DURATION_MS - 1000)
    assert.equal(display.textContent, '00:01')
    assert.equal(notice.textContent, '')
    clock.advance(1000)
    assert.equal(display.textContent, '00:00')
    assert.equal(root.dataset.status, 'finished')
    assert.equal(notice.textContent, FINISH_MESSAGE)
    assert.equal(clock.active(), 0)
    toggle.click()
    assert.equal(display.textContent, '25:00')
    assert.equal(notice.textContent, '', '新一轮开始后收起上一轮提示')
    assert.equal(clock.active(), 1)
  })
})

test('停用插件时清理定时器与监听器，可重复启停而不残留', () => {
  withClock(clock => {
    const { cleanups, root } = createHarness()
    const [, , toggle] = root.children
    toggle.click()
    assert.equal(clock.active(), 1)
    assert.equal(toggle.listenerCount('click'), 1)
    for (const dispose of cleanups) dispose()
    assert.equal(clock.active(), 0, '释放上下文后不残留定时器')
    assert.equal(toggle.listenerCount('click'), 0)
    toggle.click()
    assert.equal(clock.active(), 0, '清理后点击不再创建定时器')
  })
})
