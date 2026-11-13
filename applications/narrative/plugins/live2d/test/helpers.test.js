import test from 'node:test'
import assert from 'node:assert/strict'
import { configuration, missingConfiguration, modelPlacement, motionRequest, patchConfiguration, resourceURL, untilAborted } from '../helpers.js'

test('unconfigured characters stay optional and report both required URLs', () => {
  const character = { id: 'lin', expressions: { happy: 'portrait' } }
  const before = structuredClone(character)
  assert.equal(missingConfiguration(configuration(character)).length, 2)
  assert.deepEqual(character, before)
  patchConfiguration(character, { modelUrl: '', expressions: { neutral: '' }, tapMotion: { group: '' } })
  assert.deepEqual(character, before)
})

test('editing Live2D preserves static portraits, other mappings and extension fields', () => {
  const character = { portrait: 'lin', expressions: { happy: 'lin-smile' }, live2d: { coreUrl: '/core.js', expressions: { neutral: 'calm' }, extra: true } }
  patchConfiguration(character, { modelUrl: ' /lin/lin.model3.json ', expressions: { happy: 'smile' } })
  assert.deepEqual(character.live2d, { modelUrl: '/lin/lin.model3.json', coreUrl: '/core.js', expressions: { neutral: 'calm', happy: 'smile' }, extra: true })
  assert.equal(character.expressions.happy, 'lin-smile')
  assert.equal(character.portrait, 'lin')
  assert.deepEqual(configuration({ live2d: { tapMotion: 'TapBody' } }).tapMotion, { group: 'TapBody' })
})

test('motion indices are zero-based integers; omission means random', () => {
  assert.deepEqual(motionRequest({ group: ' TapBody ', index: 0 }), { group: 'TapBody', index: 0 })
  assert.deepEqual(motionRequest({ group: 'Idle' }), { group: 'Idle' })
  for (const index of [-1, 1.5, '0', NaN]) assert.throws(() => motionRequest({ group: 'Idle', index }))
  assert.throws(() => motionRequest({ group: '' }))
})

test('stage geometry respects position and scale and uses the actual portrait box', () => {
  const input = { width: 1000, height: 500, modelWidth: 200, modelHeight: 400 }
  assert.deepEqual(modelPlacement({ ...input, stage: { position: 25, scale: 100 } }), { x: 250, y: 500, scale: 1.15 })
  assert.deepEqual(modelPlacement({ ...input, stage: { position: 75, scale: 180 } }), { x: 750, y: 500, scale: 1.15 * 1.8 })
  assert.deepEqual(modelPlacement({ ...input, portrait: { x: -5, y: 50, width: 300, height: 400 } }), { x: 145, y: 450, scale: 1 })
  assert.equal(modelPlacement({ ...input, height: 0 }), null)
})

test('model-relative paths resolve and executable URL schemes are rejected', () => {
  assert.equal(resourceURL('textures/a.png', 'https://models.test/lin/lin.model3.json'), 'https://models.test/lin/textures/a.png')
  for (const url of ['javascript:alert(1)', 'file:///sdk/core.js', 'data:text/javascript,void 0']) assert.throws(() => resourceURL(url, 'https://models.test/'))
})

test('waiting on optional imports stops immediately without unhandled rejection', async () => {
  const controller = new AbortController()
  let reject
  const pending = new Promise((resolve, fail) => { reject = fail })
  const wait = untilAborted(pending, controller.signal)
  controller.abort()
  await assert.rejects(wait, { name: 'AbortError' })
  reject(Error('late failure'))
  await Promise.resolve()
})
