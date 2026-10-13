import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardBounds, fitView, arrangeCards, moveDelta, overlayPosition, resizeCard } from '../geometry.js'

const size = n => ({ width: 288, height: n.type === 'generator' ? 420 : 230 })

test('排列分组时成员一起移动，已选成员不被重复独立排列', () => {
  const nodes=[{id:'text',type:'text',x:0,y:0},{id:'g',type:'group',x:400,y:100},{id:'a',type:'text',x:430,y:130,groupId:'g'},{id:'b',type:'text',x:800,y:130,groupId:'g'}]
  const ops=arrangeCards(nodes.slice(0,3),'horizontal',size,nodes)
  assert.equal(new Set(ops.map(op=>op.id)).size,4)
  const positions=new Map(ops.map(op=>[op.id,op.patch]))
  assert.deepEqual(positions.get('g'),{x:328,y:0})
  assert.deepEqual(positions.get('a'),{x:358,y:30})
  assert.deepEqual(positions.get('b'),{x:728,y:30})
})
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

test('四角缩放保持对角，图片不变形且不越过坐标和尺寸边界', () => {
  const before={x:10,y:20,width:400,height:200}
  for(const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    const result=resizeCard(before,corner,80,40,true)
    assert.equal(result.width/result.height,2)
    if(corner.endsWith('left')) assert.equal(result.x+result.width,410)
    else assert.equal(result.x,10)
    if(corner.startsWith('top')) assert.equal(result.y+result.height,220)
    else assert.equal(result.y,20)
  }
  const edge=resizeCard({x:-99990,y:-99990,width:400,height:200},'top-left',-1000000,-1000000,true)
  assert.ok(edge.x>=-100000 && edge.y>=-100000)
  assert.equal(edge.width/edge.height,2)
  assert.deepEqual(resizeCard(before,'bottom-right',-1000,-1000),{x:10,y:20,width:220,height:160})
})
