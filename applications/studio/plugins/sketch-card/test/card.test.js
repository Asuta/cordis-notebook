import { test } from 'node:test'
import assert from 'node:assert/strict'
import { definition, digest, MAX_POINTS, MAX_STROKES } from '../card.js'

const stroke = (points = [10, 10, 40, 40], extra = {}) => ({ color: '#273128', width: 3, points, ...extra })
const node = (value = {}) => ({ id: 'card', type: definition.id, title: '手绘参考图', x: 0, y: 0, strokes: [stroke()], ...value })
const image = { id: 'asset-id', kind: 'image' }

test('默认笔画数组互相独立，类型以图片输出', () => {
  const first = definition.defaults(), second = definition.defaults()
  first.strokes.push(stroke())
  assert.deepEqual(second.strokes, [])
  assert.equal(definition.output, 'image')
  assert.deepEqual(definition.fields, ['strokes', 'assetId', 'referenceDigest'])
  assert.doesNotThrow(() => definition.validate(node(), {}))
})

test('校验笔画数据、素材和参考图版本', () => {
  const valid = node({ assetId: image.id, referenceDigest: digest([stroke()]) })
  assert.doesNotThrow(() => definition.validate(valid, { [image.id]: image }))
  assert.throws(() => definition.validate(node({ strokes: undefined }), {}))
  assert.throws(() => definition.validate(node({ strokes: [null] }), {}))
  assert.throws(() => definition.validate(node({ strokes: [stroke([1, 2, 3])] }), {}))
  assert.throws(() => definition.validate(node({ strokes: [stroke([1, 2], { color: 'red' })] }), {}))
  assert.throws(() => definition.validate(node({ strokes: [stroke([1, 2], { width: 0 })] }), {}))
  assert.throws(() => definition.validate(node({ strokes: [stroke([1, Number.NaN])] }), {}))
  assert.throws(() => definition.validate(node({ strokes: [stroke(new Array(8002).fill(1))] }), {}))
  assert.throws(() => definition.validate(node({ strokes: new Array(MAX_STROKES + 1).fill(stroke()) }), {}))
  assert.throws(() => definition.validate(node({ strokes: Array.from({ length: MAX_STROKES }, () => stroke(new Array(204).fill(1))) }), {}))
  assert.throws(() => definition.validate(node({ assetId: 'missing' }), {}))
  assert.throws(() => definition.validate(node({ assetId: 'video-id' }), { 'video-id': { kind: 'video' } }))
  assert.throws(() => definition.validate(node({ referenceDigest: 1 }), {}))
  assert.throws(() => definition.validate(node({ referenceDigest: 'x'.repeat(41) }), {}))
})

test('未生成参考图时拒绝作为输入，生成后返回素材', () => {
  assert.throws(() => definition.resolve(node()), /生成参考图/)
  assert.deepEqual(definition.resolve(node({ assetId: image.id })), { assetId: image.id })
})

test('参考图摘要随笔画变化且稳定', () => {
  const first = [stroke()], second = [stroke([10, 10, 40, 60])]
  assert.equal(digest(first), digest(structuredClone(first)))
  assert.notEqual(digest(first), digest(second))
  assert.equal(digest([]), digest([]))
})
