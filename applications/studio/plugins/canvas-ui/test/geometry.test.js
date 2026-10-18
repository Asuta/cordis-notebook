import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardBounds, fitView, arrangeGrid, layoutGraph, moveDelta, overlayPosition } from '../geometry.js'

const size = n => ({ width: 288, height: n.type === 'generator' ? 420 : 230 })
test('灵感卡片按近方形网格排列，保留输入内容和原对象', () => {
  const nodes = [
    { id: 'a', type: 'text', x: -100, y: -100, text: 'A' }, { id: 'b', type: 'text', x: 300, y: 300, text: 'B' },
    { id: 'c', type: 'text', x: 500, y: 0, text: 'C' }, { id: 'd', type: 'text', x: 0, y: 600, text: 'D' },
  ]
  const before = structuredClone(nodes)
  const position = Object.fromEntries(arrangeGrid(nodes, size, { startX: -100, startY: -100 }).map(item => [item.id, item.patch]))
  assert.deepEqual(position, { b: { x: 236, y: -100 }, c: { x: -100, y: 178 }, d: { x: 236, y: 178 } })
  assert.deepEqual(nodes, before)
  assert.deepEqual(cardBounds(nodes, size), { x: -100, y: -100, width: 888, height: 930 })
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

test('全局整理按输入关系分列，并在每列内部按近方形网格排列', () => {
  const nodes = [
    { id: 'text-a', type: 'text', x: 500, y: 0 }, { id: 'text-b', type: 'text', x: 600, y: 400 },
    { id: 'gen', type: 'generator', x: 0, y: 500 }, { id: 'result', type: 'image', x: 900, y: 100, sourceNodeId: 'gen' },
  ]
  const operations = layoutGraph(nodes, [{ id: 'edge', from: 'text-b', to: 'gen' }], size, { gapX: 100, gapY: 40 })
  const position = Object.fromEntries(operations.map(item => [item.id, item.patch]))
  assert.ok(position['text-b'].x < position.gen.x)
  assert.ok(position.gen.x < position.result.x)
  assert.equal(position['text-a'].x, position['text-b'].x)
  assert.notEqual(position['text-a'].y, position['text-b'].y)
})
