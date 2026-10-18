import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrangeCanvas, canvasLayouts } from '../layouts.js'

const size = node => ({ width: node.width || 288, height: node.height || (node.type === 'generator' ? 720 : 360) })
const nodes = [
  { id: 'input', type: 'image', x: -400, y: 100, width: 320, height: 410 },
  { id: 'g1', type: 'generator', x: 100, y: -20, prompt: '保留内容' },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, type: i % 2 ? 'video' : 'image', sourceNodeId: 'g1', x: i * 11, y: i * 23, height: 260 + i * 40 })),
  { id: 'g2', type: 'generator', x: 1000, y: 500, height: 850 },
  { id: 'b1', type: 'video', sourceNodeId: 'g2', x: 1700, y: 500, height: 430 },
  { id: 'b2', type: 'image', sourceNodeId: 'g2', x: 1700, y: 1000, height: 300 },
  { id: 'isolated', type: 'text', x: 2000, y: 0, width: 360, height: 180 },
]
const edges = [{ from: 'input', to: 'g1' }, { from: 'a0', to: 'g2' }]
function placed(input, algorithm, links = edges) {
  const operations = arrangeCanvas(input, links, size, algorithm), patches = new Map(operations.map(item => [item.id, item.patch]))
  assert.equal(patches.size, operations.length, '每张卡片只能写入一次坐标')
  return input.map(node => ({ ...node, ...patches.get(node.id) }))
}
function assertSeparated(items) {
  for (let i = 0; i < items.length; i++) {
    const a = items[i], sa = size(a)
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y))
    assert.ok(Math.abs(a.x) <= 100000 && Math.abs(a.y) <= 100000)
    for (const b of items.slice(i + 1)) {
      const sb = size(b)
      assert.ok(a.x + sa.width <= b.x || b.x + sb.width <= a.x || a.y + sa.height <= b.y || b.y + sb.height <= a.y, `${a.id} 与 ${b.id} 不应重叠`)
    }
  }
}
for (const { id, label } of canvasLayouts) test(`${label}保留关系与内容、兼容不同尺寸及旧数据中的循环`, () => {
  const before = structuredClone(nodes), edgeBefore = structuredClone(edges)
  const arranged = placed(nodes, id)
  assertSeparated(arranged)
  assert.equal(arranged.length, nodes.length)
  assert.deepEqual(nodes, before)
  assert.deepEqual(edges, edgeBefore)
  const cyclic = [{ from: 'input', to: 'g1' }, { from: 'g1', to: 'input' }, { from: 'missing', to: 'g2' }]
  assertSeparated(placed(nodes, id, cyclic))
  assert.deepEqual(arrangeCanvas([], [], size, id), [])
  assert.deepEqual(arrangeCanvas(nodes.slice(0, 1), [], size, id), [])
})

test('流程分组让各参数卡与直接产物紧邻，组间仍按依赖向右展开', () => {
  const arranged = placed(nodes, 'workflow'), byId = new Map(arranged.map(node => [node.id, node]))
  const products = arranged.filter(node => node.sourceNodeId === 'g1')
  assert.equal(Math.min(...products.map(node => node.x)), byId.get('g1').x + size(byId.get('g1')).width + 88)
  assert.ok(Math.max(...products.map(node => node.x + size(node).width)) < byId.get('g2').x)
  assert.ok(byId.get('input').x < byId.get('g1').x)
})

test('连线分层把同层产物放在同一列，所有依赖从左向右', () => {
  const arranged = placed(nodes, 'layered'), byId = new Map(arranged.map(node => [node.id, node]))
  assert.equal(new Set(arranged.filter(node => node.sourceNodeId === 'g1').map(node => node.x)).size, 1)
  for (const { from, to } of [...edges, ...nodes.filter(node => node.sourceNodeId).map(node => ({ from: node.sourceNodeId, to: node.id }))]) {
    assert.ok(byId.get(from).x + size(byId.get(from)).width < byId.get(to).x)
  }
})

test('瀑布流可减少高度差异大的卡片之间的空白，五种布局结果不同', () => {
  const boundsArea = items => {
    const left = Math.min(...items.map(node => node.x)), top = Math.min(...items.map(node => node.y))
    return (Math.max(...items.map(node => node.x + size(node).width)) - left) * (Math.max(...items.map(node => node.y + size(node).height)) - top)
  }
  const mixed = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, x: i, y: i, height: i < 3 ? 900 : 180 }))
  assert.ok(boundsArea(placed(mixed, 'masonry', [])) < boundsArea(placed(mixed, 'grid', [])))
  const signatures = canvasLayouts.map(({ id }) => JSON.stringify(placed(nodes, id).map(node => [node.id, node.x, node.y])))
  assert.equal(new Set(signatures).size, canvasLayouts.length)
})

test('所有整理方案可处理接近画板上限的混合卡片', () => {
  const many = Array.from({ length: 450 }, (_, i) => ({ id: `n${i}`, type: i % 10 ? 'image' : 'generator', sourceNodeId: i % 10 ? `n${i - i % 10}` : undefined, x: 0, y: 0, height: 200 + (i % 7) * 100 }))
  for (const { id } of canvasLayouts) assertSeparated(placed(many, id, []))
})
