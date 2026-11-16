import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from './helpers.js'
import { settle } from '../../project/test/helpers.js'

test('场景 Agent 与编辑器共用版本校验、撤销和持久化', async t => {
  const f = await setupScene(t), read = f.tools.get('narrative_scene_read'), edit = f.tools.get('narrative_scene_edit')
  const initial = read()
  f.scene.edit({ op: 'patch', id: 'heading', patch: { props: { text: '手动编辑' } } })
  await assert.rejects(edit({ version: initial.version, command: { op: 'remove', id: 'heading' } }), /版本已变化/)
  const before = JSON.stringify(f.engine.composition), version = f.engine.version
  assert.throws(() => f.scene.edit({ op: 'connect', source: 'next-day', event: 'clicked', target: 'day', method: 'unknown' }), /事件或方法|对象/)
  assert.equal(JSON.stringify(f.engine.composition), before)
  assert.equal(f.engine.version, version)
  await edit({ version, command: { op: 'patch', id: 'heading', patch: { props: { text: 'Agent 编辑' } } } })
  assert.equal(f.records.get('first').composition.scenes[0].objects.find(o => o.id === 'heading').props.text, 'Agent 编辑')
  f.scene.undo(); assert.equal(f.scene.expanded().objects.find(o => o.id === 'heading').props.text, '手动编辑')
  f.scene.redo(); assert.equal(f.scene.expanded().objects.find(o => o.id === 'heading').props.text, 'Agent 编辑')
  await f.engine.open('second'); assert.deepEqual(f.engine.sceneHistory, { undo: 0, redo: 0 })
})

test('试玩状态进入存档，恢复会话不串线，切场景后仍能返回', async t => {
  const f = await setupScene(t)
  f.scene.edit({ op: 'add-scene', id: 'garden', name: '花园' })
  f.scene.edit({ op: 'add', sceneId: 'garden', id: 'flowers', type: 'counter', props: { initial: 8 } })
  await f.engine.play()
  await f.scene.call('lin-session', 'send', { text: '保存这次相遇' })
  const saved = structuredClone(f.engine.runtime)
  assert.equal(saved.objects.states['main/lin-session'].messages.length, 2)
  f.scene.switchScene('garden'); assert.equal(f.scene.runtime.state('flowers').value, 8)
  f.scene.switchScene('main'); assert.equal(f.scene.runtime.state('lin-session').messages.length, 2)
  f.engine.stop(); assert.equal(f.scene.runtime, null)
  f.engine.restoreRuntime(saved)
  assert.equal(f.scene.runtime.state('lin-session').messages[0].content, '保存这次相遇')
  assert.deepEqual(f.scene.runtime.state('yao-session').messages, [])
  assert.deepEqual(f.toasts, [])
})

test('缺少类型时给出一次可恢复错误，不递归通知崩溃', async t => {
  const f = await setupScene(t)
  f.scene.edit({ op: 'add', id: 'custom', type: 'missing-type' })
  await f.engine.play()
  assert.equal(f.scene.runtime, null)
  assert.equal(f.toasts.filter(x => x.includes('缺少对象类型')).length, 1)
  f.scene.register(f.typeOwner, { type: 'missing-type', label: '扩展', fields: {}, methods: {}, events: [] })
  await settle()
  assert.ok(f.scene.runtime)
  assert.equal(f.engine.runtime.error, '')
  assert.deepEqual(f.scene.validate(), [])
})
