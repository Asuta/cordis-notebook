import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampCrop, normalizedAngle, rotatedSize, workspaceToSource } from '../quick-edit-transform.js'

test('旋转尺寸覆盖 0、90、45 度和 360 度整圈', () => {
  assert.deepEqual(rotatedSize(100, 50, 0), { width: 100, height: 50 })
  assert.deepEqual(rotatedSize(100, 50, 90), { width: 50, height: 100 })
  assert.deepEqual(rotatedSize(100, 50, 45), { width: 107, height: 107 })
  assert.deepEqual(rotatedSize(100, 50, 360), { width: 100, height: 50 })
  assert.deepEqual(rotatedSize(100, 50, -90), { width: 50, height: 100 })
  assert.equal(normalizedAngle(-90), 270)
  assert.equal(normalizedAngle(720), 0)
})

test('把旋转和镜像后的画布坐标映射回原图坐标', () => {
  const base = { width: 100, height: 50, sourceWidth: 100, sourceHeight: 50, mirrored: false }
  assert.deepEqual(workspaceToSource(10, 20, { ...base, angle: 0 }), { x: 10, y: 20 })
  assert.deepEqual(workspaceToSource(10, 20, { ...base, width: 50, height: 100, angle: 90 }), { x: 20, y: 40 })
  assert.deepEqual(workspaceToSource(10, 20, { ...base, angle: 0, mirrored: true }), { x: 90, y: 20 })
})

test('裁切框限制在画布内，过小区域返回空', () => {
  assert.deepEqual(clampCrop({ x: -10, y: -5, w: 50, h: 200 }, 100, 100), { x: 0, y: 0, w: 40, h: 100 })
  assert.deepEqual(clampCrop({ x: 20, y: 30, w: 40, h: 50 }, 100, 100), { x: 20, y: 30, w: 40, h: 50 })
  assert.equal(clampCrop({ x: 10, y: 10, w: 1, h: 40 }, 100, 100), null)
  assert.equal(clampCrop(null, 100, 100), null)
})
