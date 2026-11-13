import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChatController } from '../chat.js'
import { deferred } from './helpers.js'
import { fixture } from './engine.js'

const offline = () => ({ baseUrl: '', model: '', protocol: 'chat', hasApiKey: false })
const live = () => ({ baseUrl: 'http://127.0.0.1/v1', model: 'my-model', protocol: 'responses', hasApiKey: true })
function setup(t, { request = async () => { throw Error('unexpected network') }, connection = offline } = {}) {
  const f = fixture()
  t.after(() => f.ctx.dispose())
  const controller = createChatController(f.ctx, f.engine, request, connection)
  f.handlers.get('chat').enter(f.node)
  return { ...f, controller }
}

test('chat enter resets turns and uses authored welcome while retaining previous transcript', async t => {
  const f = setup(t)
  assert.equal(f.handlers.get('chat').label, '聊天')
  assert.equal(f.engine.runtime.chatTurns, 0)
  assert.deepEqual(f.engine.runtime.text, f.node.lines[0])
  assert.equal(f.engine.runtime.transcript[0].text, '以前的剧情。')
  assert.equal(f.engine.runtime.transcript[1].text, f.node.lines[0].text)
  f.node.lines = [{ speaker: '', text: '旁白开场。' }]
  f.handlers.get('chat').enter(f.node)
  assert.equal(f.engine.runtime.text.speaker, '')
  assert.equal(f.engine.runtime.transcript.at(-1).role, 'narrator')
})

test('offline chat uses authored replies by chatTurns, emits completed turns and never changes stats', async t => {
  let network = 0
  const f = setup(t, { request: async () => { network++; return { reply: 'should never be used' } } })
  const variables = structuredClone(f.engine.runtime.variables)
  assert.equal(await f.controller.send('第一句话'), true)
  assert.equal(f.engine.runtime.text.text, f.node.chat.demoReplies[0])
  assert.equal(await f.controller.send('第二句话'), true)
  assert.equal(f.engine.runtime.text.text, f.node.chat.demoReplies[1])
  assert.equal(f.engine.runtime.chatTurns, 2)
  assert.deepEqual(f.engine.runtime.variables, variables)
  assert.deepEqual(f.events.map(item => item.event), ['chat.message', 'chat.message'])
  assert.deepEqual(f.events.map(item => item.payload.demo), [true, true])
  assert.equal(await f.controller.send('超过上限'), false)
  assert.equal(network, 0)
  assert.equal(f.engine.runtime.transcript.length, 6)
})

test('missing demo replies do not loop, fabricate text or silently fall through to a provider', async t => {
  const f = setup(t)
  f.node.chat.demoReplies = ['仅有一轮。']
  assert.equal(await f.controller.send('第一轮'), true)
  assert.equal(await f.controller.send('第二轮'), false)
  assert.equal(f.engine.runtime.chatTurns, 1)
  assert.match(f.engine.runtime.error, /本轮未编写示例/)
})

test('connected chat sends character/personality/world/prompt/history and awaits rules before unlocking', async t => {
  const result = deferred(), event = deferred(), entered = deferred(), requests = []
  const f = setup(t, { connection: live, request: async (...args) => { requests.push(args); return result.promise } })
  f.engine.eventHook = async (name, payload) => {
    assert.equal(name, 'chat.message')
    assert.equal(payload.reply, '真实回复')
    entered.resolve()
    await event.promise
  }
  const sending = f.controller.send('你好')
  assert.equal(f.engine.runtime.busy, true)
  assert.equal(await f.controller.send('重复发送'), false)
  assert.equal(requests.length, 1)
  const [path, method, payload] = requests[0]
  assert.equal(path, '/api/narrative/ai/reply'); assert.equal(method, 'POST')
  assert.equal(payload.character.name, '林栀')
  assert.equal(payload.personality, '温柔好奇')
  assert.equal(payload.worldInfo, '今夜的观测站。')
  assert.equal(payload.prompt, '说说星空。')
  assert.deepEqual(payload.messages.at(-1), { role: 'user', content: '你好' })
  assert.equal(payload.messages.some(item => item.role === 'narrator'), false)
  result.resolve({ reply: '真实回复' })
  await entered.promise
  assert.equal(f.engine.runtime.busy, true)
  assert.equal(f.engine.runtime.chatTurns, 1)
  assert.equal(f.events[0].payload.demo, false)
  event.resolve()
  assert.equal(await sending, true)
  assert.equal(f.engine.runtime.busy, false)
})

test('live failures preserve transcript, turns and draft opportunity without switching to demo', async t => {
  const f = setup(t, { connection: live, request: async () => { throw Error('upstream leaked key should never be displayed') } })
  const before = structuredClone(f.engine.runtime.transcript)
  assert.equal(await f.controller.send('你好'), false)
  assert.deepEqual(f.engine.runtime.transcript, before)
  assert.equal(f.engine.runtime.chatTurns, 0)
  assert.equal(f.engine.runtime.busy, false)
  assert.match(f.engine.runtime.error, /未切换为示例对话/)
  assert.equal(f.engine.runtime.error.includes('upstream leaked'), false)
})

test('stale replies are ignored after exit, restored runtime, node changes, same-node reentry and cancellation', async t => {
  for (const change of ['stop', 'restore', 'node', 'reenter', 'cancel', 'dispose']) {
    const result = deferred()
    const f = setup(t, { connection: live, request: () => result.promise })
    const old = f.engine.runtime
    const sending = f.controller.send('迟来的回复')
    if (change === 'stop') f.engine.stop()
    if (change === 'restore') f.engine.restore()
    if (change === 'node') await f.engine.go('next')
    if (change === 'reenter') f.handlers.get('chat').enter(f.node)
    if (change === 'cancel') f.controller.cancel()
    if (change === 'dispose') await f.ctx.dispose()
    const snapshot = structuredClone(f.engine.runtime)
    result.resolve({ reply: '陈旧结果' })
    assert.equal(await sending, false, change)
    assert.deepEqual(f.engine.runtime, snapshot, change)
    assert.equal(f.events.length, 0, change)
    assert.equal(old.transcript.some(item => item.text === '陈旧结果'), false)
  }
})

test('continue allows early exit, awaits events and guards event-driven redirects and conditional choices', async t => {
  const f = setup(t)
  const event = deferred(), entered = deferred()
  f.engine.eventHook = async name => { assert.equal(name, 'chat.continue'); entered.resolve(); await event.promise }
  const continuation = f.controller.continueStory(f.node)
  await entered.promise
  assert.deepEqual(f.calls, [])
  assert.equal(f.engine.runtime.busy, true)
  event.resolve()
  await continuation
  assert.deepEqual(f.calls, ['next'])
  assert.equal(f.engine.runtime.nodeId, 'next')
  await f.engine.go('talk')
  f.node.choices = [{ id: 'gated', target: 'next', condition: { variable: 'trust', op: 'gte', value: 100 } }]
  f.calls.length = 0
  await f.controller.continueStory(f.node)
  assert.deepEqual(f.calls, [], 'chat continuation must not bypass gated choices')
  f.node.choices = []
  f.engine.eventHook = async () => f.engine.stop()
  await f.controller.continueStory(f.node)
  assert.deepEqual(f.calls, [], 'do not go after an event has replaced the runtime')
})

test('cancelling an awaited continue event releases busy state and invalidates its eventual jump', async t => {
  const f = setup(t), gate = deferred()
  f.engine.eventHook = () => gate.promise
  const continuation = f.controller.continueStory(f.node)
  assert.equal(f.engine.runtime.busy, true)
  f.controller.cancel()
  assert.equal(f.engine.runtime.busy, false)
  gate.resolve()
  await continuation
  assert.deepEqual(f.calls, [])
})

test('restored turns select the matching authored reply and history is bounded for real requests', async t => {
  const f = setup(t)
  f.engine.runtime.chatTurns = 1
  assert.equal(await f.controller.send('存档恢复后'), true)
  assert.equal(f.engine.runtime.text.text, '作者的第二轮示例。')
  const requests = []
  const g = setup(t, { connection: live, request: async (_path, _method, payload) => { requests.push(payload); return { reply: 'hi' } } })
  g.engine.runtime.transcript = Array.from({ length: 999 }, (_, i) => ({ id: String(i), name: '角色', role: 'assistant', text: 'x'.repeat(8000) }))
  await g.controller.send('最近的一句')
  assert.ok(requests[0].messages.length <= 40)
  assert.ok(requests[0].messages.reduce((sum, item) => sum + item.content.length, 0) <= 48000)
  assert.equal(g.engine.runtime.transcript.length, 1000)
})
