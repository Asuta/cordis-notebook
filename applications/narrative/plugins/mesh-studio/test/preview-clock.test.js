import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Motion } from '../vendor/packages/runtime/src/engine/motion.js'
import { createPreviewStepper } from '../preview-clock.js'

function preview(loop = false) {
  const motion = new Motion([0, 0])
  motion.speakKana('あいうえお、こんにちは', { speed: 7, loop })
  // Match the real runtime advance() contract, including its per-call rounding.
  const step = createPreviewStepper({ advance(seconds) {
    for (let i = 0; i < Math.round(seconds * 60); i++) motion.update(1 / 60)
  } })
  return { motion, step }
}

for (const hz of [30, 60, 90, 120, 144, 165, 240]) test(`${hz}Hz 下嘴型持续变化、按真实时长播完并继续待机`, () => {
  const { motion, step } = preview(), openings = new Set()
  for (let i = 0; i < hz * 3; i++) {
    step(1 / hz)
    openings.add(Math.round(motion.getLipSyncState().open * 100))
  }
  assert.ok(openings.size > 10, '播放不能停在同一口型')
  assert.equal(motion.getLipSyncState().active, false, '假名文本应播放结束')
  assert.ok(Math.abs(motion.t - 3) < 1e-9, '各刷新率的动画时长一致')
  step(1 / 30)
  assert.ok(motion.t > 3, '播完后待机时间仍然推进')
})

test('165Hz 循环播放可重复经过闭嘴和张嘴，停止后解除口型', () => {
  const { motion, step } = preview(true), openings = new Set()
  for (let i = 0; i < 165 * 6; i++) { step(1 / 165); openings.add(Math.round(motion.getLipSyncState().open * 100)) }
  assert.equal(motion.getLipSyncState().active, true)
  assert.ok(openings.size > 10)
  motion.stopLipSync(); step(1 / 30)
  assert.equal(motion.getLipSyncState().active, false)
})

test('保留短帧余量，后台长间隔不会无限补帧', () => {
  const { motion, step } = preview()
  step(1 / 240); assert.equal(motion.t, 0)
  step(1 / 240); step(1 / 240); step(1 / 240)
  assert.equal(motion.t, 1 / 60)
  const before = motion.t
  step(20)
  assert.ok(Math.abs(motion.t - before - .05) < 1e-9)
})
