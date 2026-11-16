import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequest } from '../client/host/request.js'

for (const cancelled of ['owner', 'object']) test('request 合并信号后由 ' + cancelled + ' 取消，不吞掉中止错误', async () => {
  const owner = new AbortController(), object = new AbortController(), entered = Promise.withResolvers()
  let received
  const request = createRequest('test-session', async (_path, options) => {
    received = options; entered.resolve()
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  })
  const pending = request('/api/narrative/ai/reply', 'POST', { messages: [] }, AbortSignal.any([owner.signal, object.signal]))
  await entered.promise
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  ;(cancelled === 'owner' ? owner : object).abort()
  await rejected
  assert.equal(received.signal.aborted, true)
  assert.equal(received.headers['X-Application-Session'], 'test-session')
})
