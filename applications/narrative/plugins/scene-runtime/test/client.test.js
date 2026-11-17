import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from './helpers.js'
import { deferred, owner, settle } from '../../project/test/helpers.js'
import saves from '../../saves/client.js'

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

test('AI 请求中切换场景清理忙碌快照，手动与自动存档可用，迟到回复不串线', async t => {
  const f = await setupScene(t), pending = deferred(), panels = new Map(), savesOwner = owner()
  let signal, calls = 0
  f.scene.edit({ op: 'patch', id: 'lin-session', patch: { props: { source: 'ai' } } })
  f.scene.edit({ op: 'add-scene', id: 'garden', name: '花园' })
  f.scene.edit({ op: 'add-scene', id: 'broken', name: '缺少插件的场景' })
  f.scene.edit({ op: 'add', sceneId: 'broken', id: 'missing', type: 'missing-type' })
  f.scene.provide(f.typeOwner, 'ai', { reply(_, s) {
    if (++calls === 2) { signal = s; return pending.promise }
    return Promise.resolve({ reply: calls === 1 ? '已完成的回复' : '重试成功' })
  } })
  Object.assign(savesOwner, { narrative: f.engine, narrativeUI: { registerPanel(_, d) { panels.set(d.id, d) }, registerToolbar() {} } })
  saves(savesOwner, f.sdk); f.ctx.effect(() => () => savesOwner.dispose())
  await f.engine.play()
  await f.scene.call('lin-session', 'send', { text: '第一轮' })
  const history = f.scene.runtime.state('lin-session').messages
  const sending = f.scene.call('lin-session', 'send', { text: '等待中的第二轮' })
  assert.equal(f.scene.runtime.state('lin-session').busy, true)
  const previousRuntime = f.scene.runtime
  assert.throws(() => f.scene.switchScene('broken'), /缺少对象类型/)
  assert.equal(f.scene.runtime, previousRuntime)
  assert.equal(signal.aborted, false)
  assert.equal(f.scene.runtime.state('lin-session').busy, true)
  f.scene.switchScene('garden')
  assert.equal(signal.aborted, true)
  assert.equal(f.engine.runtime.objects.states['main/lin-session'].busy, false)
  assert.deepEqual(f.engine.runtime.objects.states['main/lin-session'].messages, history)
  const host = document.createElement('div'); panels.get('saves').render(host)
  const save = [...host.querySelectorAll('button')].find(b => b.textContent === '保存进度')
  assert.ok(save); save.click(); await settle()
  const manual = JSON.parse(f.window.localStorage.getItem('save:first:1'))
  assert.equal(manual.runtime.objects.sceneId, 'garden')
  t.mock.timers.tick(250)
  const auto = JSON.parse(f.window.localStorage.getItem('save:first:auto'))
  assert.equal(auto.runtime.objects.sceneId, 'garden')
  assert.equal(auto.runtime.objects.states['main/lin-session'].busy, false)
  f.scene.switchScene('main')
  pending.resolve({ reply: '不应出现的迟到回复' }); assert.equal(await sending, false)
  assert.deepEqual(f.scene.runtime.state('lin-session').messages, history)
  await f.scene.call('lin-session', 'send', { text: '重新发送' })
  assert.equal(f.scene.runtime.state('lin-session').messages.at(-1).content, '重试成功')
  f.engine.restoreRuntime(manual.runtime)
  assert.equal(f.scene.selected, 'garden')
  f.scene.switchScene('main')
  assert.deepEqual(f.scene.runtime.state('lin-session').messages, history)
})
