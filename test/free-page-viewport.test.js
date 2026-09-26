import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createViewport } from '../applications/notebook/plugins/free-page-editor/viewport.js'

function fixture() {
  let visible = false,
    scrollable = false,
    calls = 0
  const saved = [],
    stage = { style: {} },
    paper = { style: {} }
  const viewport = {
    isConnected: true,
    scrollLeft: 0,
    scrollTop: 0,
    get clientWidth() {
      return visible ? 400 : 0
    },
    get clientHeight() {
      return visible ? 300 : 0
    },
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    scrollTo(left, top) {
      calls++
      this.scrollLeft =
        visible && scrollable ? Math.min(left, Math.max(0, parseFloat(stage.style.width) - this.clientWidth)) : 0
      this.scrollTop =
        visible && scrollable ? Math.min(top, Math.max(0, parseFloat(stage.style.height) - this.clientHeight)) : 0
    },
  }
  const camera = createViewport(
    viewport,
    stage,
    paper,
    () => ({ width: 0, height: 0 }),
    (value) => saved.push(value),
  )
  return {
    camera,
    viewport,
    saved,
    get calls() {
      return calls
    },
    show: () => {
      visible = true
    },
    hide: () => {
      visible = false
    },
    ready: () => {
      scrollable = true
    },
  }
}

test('自由页面隐藏、样式未就绪和快速切换时保留待恢复位置', () => {
  const f = fixture(),
    a = { left: 600, top: 900, zoom: 1 },
    b = { left: 1200, top: 1800, zoom: 1 }
  f.camera.restore(a)
  f.camera.layout()
  f.camera.scrolled()
  assert.equal(f.calls, 0)
  assert.deepEqual(f.camera.snapshot(), a)
  f.show()
  f.camera.layout()
  f.camera.scrolled()
  assert.deepEqual(f.camera.snapshot(), a)
  assert.equal(f.saved.length, 0, '样式未就绪不能覆盖恢复目标')
  f.ready()
  f.camera.layout()
  f.camera.scrolled()
  assert.deepEqual(f.saved.at(-1), a)
  f.hide()
  f.viewport.scrollTop = f.viewport.scrollLeft = 0
  f.camera.scrolled()
  assert.deepEqual(f.saved.at(-1), a)
  f.camera.restore(a)
  f.camera.restore(b)
  f.camera.scrolled()
  f.show()
  f.camera.layout()
  assert.deepEqual(f.camera.snapshot(), b)
  f.camera.restore(a)
  assert.deepEqual(f.camera.snapshot(), a)
})

test('缩放保持指针下的文档坐标，恢复保存的缩放和滚动', () => {
  const f = fixture()
  f.show()
  f.ready()
  f.camera.restore({ left: 600, top: 900, zoom: 1 })
  const point = { clientX: 110, clientY: 100 }
  const before = f.camera.point(point)
  f.camera.setZoom(2, { x: point.clientX, y: point.clientY })
  assert.deepEqual(f.camera.point(point), before)
  const saved = f.saved.at(-1)
  f.camera.restore({})
  f.camera.restore(saved)
  assert.deepEqual(f.camera.point(point), before)
  f.camera.setZoom(99)
  assert.equal(f.camera.zoom, 3)
})

test('滚轮缩放逐帧插值，连续输入累积目标且切页和销毁取消动画', t => {
  const previous = new Map(), frames = new Map()
  let id = 0
  for (const [key, value] of Object.entries({
    requestAnimationFrame: fn => { frames.set(++id, fn); return id },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => ({ matches: false }),
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true })
  }
  t.after(() => { for (const [key, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  } })
  const tick = time => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(time)) }
  const f = fixture(); f.show(); f.ready()
  f.camera.restore({ left: 600, top: 900, zoom: 1 })
  const pointer = { clientX: 110, clientY: 100 }, anchor = { x: 110, y: 100 }
  const world = f.camera.point(pointer)
  const checkAnchor = () => {
    const actual = f.camera.point(pointer)
    assert.ok(Math.abs(actual.x - world.x) < 1e-8 && Math.abs(actual.y - world.y) < 1e-8)
  }
  f.camera.setZoom(2, anchor, true)
  assert.equal(f.camera.zoom, 1)
  tick(0); tick(80)
  assert.ok(f.camera.zoom > 1 && f.camera.zoom < 2)
  checkAnchor()
  f.camera.setZoom(f.camera.targetZoom * 1.1, anchor, true)
  assert.equal(f.camera.targetZoom, 2.2)
  tick(90); tick(250)
  assert.equal(f.camera.zoom, 2.2)
  assert.equal(frames.size, 0)
  checkAnchor()
  f.camera.setZoom(3, anchor, true)
  f.camera.restore({ zoom: 1, left: 0, top: 0 })
  tick(500)
  assert.equal(f.camera.zoom, 1)
  f.camera.setZoom(2, anchor, true)
  f.camera.destroy()
  assert.equal(frames.size, 0)
})
