import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardBounds, fitView, arrangeCards, moveDelta, overlayPosition } from '../geometry.js'

const size = n => ({ width: 288, height: n.type === 'generator' ? 420 : 230 })
test('灵感卡片按真实高度排列，保留输入内容与未选卡片', () => {
  const nodes = [{ id: 'gen', type: 'generator', x: -100, y: -100, prompt: '保留提示词' }, { id: 'text', type: 'text', x: 300, y: 300, text: '保留文字' }]
  const before = structuredClone(nodes)
  assert.deepEqual(arrangeCards(nodes, 'vertical', size), [
    { type: 'update', id: 'gen', patch: { x: -100, y: -100 } },
    { type: 'update', id: 'text', patch: { x: -100, y: 360 } },
  ])
  assert.deepEqual(nodes, before)
  assert.deepEqual(cardBounds(nodes, size), { x: -100, y: -100, width: 688, height: 630 })
})

test('聚焦负坐标内容时为底部工具保留空间，视角可存入现有协议', () => {
  const box = { x: -500, y: -400, width: 1000, height: 700 }, view = fitView(box, 900, 600, 120)
  assert.equal(view.zoom, 416 / 700)
  assert.ok(view.y + box.y * view.zoom >= 32)
  assert.ok(view.y + (box.y + box.height) * view.zoom <= 480 - 32 + 1e-9)
  assert.equal(fitView(box, 0, 0), null)
})

test('多选移动到文档边界时使用共同偏移，不压缩相对位置', () => {
  assert.deepEqual(moveDelta([{ x: 99980, y: -99990 }, { x: 99800, y: -99500 }], 100, -100), { x: 20, y: -10 })
})

test('浮层在四边翻转和约束，不落入底部工具区', () => {
  for (const x of [-800, 0, 400, 1800]) for (const y of [-600, 0, 300, 1800]) {
    const p = overlayPosition({ x, y, width: 200, height: 250 }, 320, 50, 700, 500, 100)
    assert.ok(p.x >= 8 && p.x + 320 <= 692)
    assert.ok(p.y >= 8 && p.y + 50 <= 392)
  }
})
