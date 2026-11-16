import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ObjectRuntime } from '../runtime.js'
import { builtinTypes } from '../../scene-ui/types.js'
import { templateProject } from '../../project/demo.js'
import { expandScene } from '../../project/composition.js'

function fixture(options = {}) {
  const project = templateProject('salon'), scene = expandScene(project.composition, 'main')
  for (const o of scene.objects.filter(o => o.type === 'conversation')) o.props.source = 'script'
  const types = new Map(builtinTypes().map(d => [d.type, d]))
  return { scene, types, services: { engine: { project }, service: () => null }, ...options }
}
test('两个会话状态独立，公开方法触发事件连接，快照可恢复', async () => {
  const f = fixture(), r = new ObjectRuntime(f)
  await r.invoke('lin-session', 'send', { text: '你好林栀' })
  assert.equal(r.state('lin-session').messages.length, 2)
  assert.deepEqual(r.state('yao-session').messages, [])
  assert.equal(r.state('relationship').value, 1)
  await r.invoke('yao-session', 'send', { text: '你好遥' })
  assert.equal(r.state('relationship').value, 2)
  assert.equal(r.state('lin-session').messages[0].content, '你好林栀')
  const button = f.scene.objects.find(o => o.type === 'button')
  await r.invoke(button.id, 'click')
  assert.equal(r.state('day').value, 2)
  assert.throws(() => { r.state('lin-session').messages.push({}) }, TypeError)
  const snapshot = r.snapshot(); r.dispose()
  const restored = new ObjectRuntime({ ...f, snapshot })
  snapshot.states['main/lin-session'].messages.length = 0
  assert.equal(restored.state('lin-session').messages.length, 2)
  assert.equal(restored.state('day').value, 2)
  restored.dispose()
})

for (const flag of ['enabled', 'paused']) test(`父对象 ${flag} 中断请求，迟到的回复不得写入状态`, async () => {
  const f = fixture(), session = f.scene.objects.find(o => o.id === 'lin-session')
  session.parent = 'layout'; session.props.source = 'ai'
  const pending = Promise.withResolvers(); let signal
  f.services.service = () => ({ reply: (_, s) => { signal = s; return pending.promise } })
  const r = new ObjectRuntime(f), sending = r.invoke('lin-session', 'send', { text: '等待回复' })
  assert.equal(r.state('lin-session').busy, true)
  r.setFlags('layout', { [flag]: flag === 'paused' })
  assert.equal(signal.aborted, true)
  assert.equal(r.state('lin-session').busy, false)
  pending.resolve({ reply: '迟到的回复' }); await sending
  assert.deepEqual(r.state('lin-session').messages, [])
  assert.equal(r.state('relationship').value, 0)
  r.setFlags('layout', { [flag]: flag !== 'paused' })
  f.services.service = () => ({ reply: async () => ({ reply: '恢复后正常回复' }) })
  await r.invoke('lin-session', 'send', { text: '重试' })
  assert.equal(r.state('lin-session').messages.at(-1).content, '恢复后正常回复')
  r.dispose()
})

test('事件循环在 64 步停止，错误方法和参数在运行前拒绝', async () => {
  const f = fixture()
  f.scene.connections.push({ id: 'loop', source: 'day', event: 'changed', target: 'day', method: 'add', args: { amount: 1 } })
  const r = new ObjectRuntime(f)
  await assert.rejects(r.invoke('day', 'add'), /64 步/)
  assert.equal(r.pending, 0); r.dispose()
  f.scene.connections.at(-1).method = 'missing'
  assert.throws(() => new ObjectRuntime(f), /事件或方法不可用/)
  f.scene.connections.at(-1).method = 'add'; f.scene.connections.at(-1).args.amount = 'wrong'
  assert.throws(() => new ObjectRuntime(f), /数值参数/)
})

test('会话取消公开方法立即终止网络，并允许重试', async () => {
  const f = fixture(), pending = Promise.withResolvers(); let signal
  f.scene.objects.find(o => o.id === 'lin-session').props.source = 'ai'
  f.services.service = () => ({ reply: (_, s) => { signal = s; return pending.promise } })
  const r = new ObjectRuntime(f), sending = r.invoke('lin-session', 'send', { text: '先暂停这次回复' })
  await r.invoke('lin-session', 'cancel')
  assert.equal(signal.aborted, true)
  assert.equal(r.status('lin-session').paused, false)
  pending.reject(new DOMException('Aborted', 'AbortError')); assert.equal(await sending, false)
  assert.deepEqual(r.state('lin-session').messages, [])
  assert.equal(r.state('lin-session').busy, false)
  r.dispose()
})

test('事件负载映射到声明参数，坏引用与坏存档不会启动', async () => {
  const f = fixture()
  f.scene.connections = [{ id: 'map', source: 'day', event: 'changed', target: 'relationship', method: 'set', argument: 'value' }]
  const r = new ObjectRuntime(f)
  await r.invoke('day', 'add', { amount: 1 })
  assert.equal(r.state('relationship').value, 2)
  const snapshot = r.snapshot(); r.dispose()
  snapshot.states['main/lin-session'].messages = 'bad'
  assert.throws(() => new ObjectRuntime({ ...f, snapshot }), /聊天存档/)
  f.scene.objects.find(o => o.type === 'chat-window').refs.session = 'day'
  assert.throws(() => new ObjectRuntime(f), /类型不匹配/)
})
