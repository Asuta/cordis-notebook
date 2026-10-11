import { test } from 'node:test'
import assert from 'node:assert/strict'
import { instrumentModelStream } from '../workbench/model-timing.js'

for (const type of ['thinking_delta', 'text_delta', 'toolcall_delta']) test('模型首段计时观察生产者且保留原始事件：' + type, async () => {
  let now = 100, options
  const events = [], pushed = [], payload = { private: 'secret' }, response = { headers: 'secret' }
  const stream = { push(event) { pushed.push(event) }, result() { return Promise.resolve('result-only consumer') } }
  const wrapped = instrumentModelStream((model, context, input) => { options = input; return stream }, event => events.push(event), () => now)
  const seen = []
  assert.equal(wrapped({}, {}, { onPayload: async value => { seen.push(value); now = 120; return 'replacement' }, onResponse: value => seen.push(value) }), stream)
  assert.equal(await options.onPayload(payload), 'replacement')
  now = 150; await options.onResponse(response)
  now = 170; stream.push({ type, delta: '' })
  assert.equal(events.at(-1).timing.firstOutputAt, undefined)
  now = 200; stream.push({ type, delta: 'secret model content' })
  now = 280; stream.push({ type: 'done', message: {} })
  assert.equal(await stream.result(), 'result-only consumer')
  assert.deepEqual(seen, [payload, response]); assert.equal(pushed.length, 3)
  assert.equal(events.at(-1).status, 'done')
  assert.deepEqual(events.at(-1).timing, { invokedAt: 100, requestStartedAt: 120, preparationMs: 20,
    responseAt: 150, responseWaitMs: 30, firstOutputAt: 200, waitMs: 80, endedAt: 280, totalMs: 180, streamingMs: 80 })
  assert.equal(new Set(events.map(event => event.id)).size, 1)
  assert.doesNotMatch(JSON.stringify(events), /secret|replacement/)
})

test('错误、取消、无输出不伪造首段和响应头指标；各次请求独立', () => {
  const events = [], wrapped = instrumentModelStream(() => ({ push() {} }), event => events.push(event), () => 100)
  wrapped({}, {}).push({ type: 'error', reason: 'aborted' })
  assert.equal(events.at(-1).status, 'stopped'); assert.equal(events.at(-1).timing.waitMs, undefined)
  wrapped({}, {}).push({ type: 'error', reason: 'error' })
  assert.equal(events.at(-1).status, 'error'); assert.equal(events.at(-1).timing.responseAt, undefined)
  wrapped({}, {}).push({ type: 'done' })
  assert.equal(events.at(-1).timing.streamingMs, undefined)
  assert.equal(new Set(events.map(event => event.id)).size, 3)
  const throws = instrumentModelStream(() => { throw Error('request failed') }, event => events.push(event), () => 100)
  assert.throws(() => throws({}, {}), /request failed/); assert.equal(events.at(-1).status, 'error')
})
