import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProviderRequest, callProvider, DialogueError, LIMITS, normalizeBaseUrl, responseContent, validateReply } from '../provider.js'
import { deferred, provider } from './helpers.js'

const input = () => validateReply({ character: { id: 'lin', name: '林栀', description: '观测员', personality: '温柔' }, worldInfo: '今夜有流星雨。', prompt: '回复不超过两句话。', messages: [{ role: 'assistant', text: '你想聊点什么？' }, { role: 'user', content: '聊聊星空。' }] })
const errorStatus = status => error => error instanceof DialogueError && error.status === status

test('URL validation permits HTTPS and local HTTP, rejects credentials, queries, fragments and remote HTTP', () => {
  for (const url of ['', 'https://models.example/v1', 'http://localhost:8080/v1', 'http://127.0.0.1:9000/v1', 'http://[::1]:8080/v1', 'http://192.168.0.5:8000/v1']) assert.equal(normalizeBaseUrl(url), url)
  assert.equal(normalizeBaseUrl(' https://models.example/v1/// '), 'https://models.example/v1')
  for (const url of ['ftp://host/v1', 'http://models.example/v1', 'http://127.remote.example/v1', 'http://192.168.remote.example/v1', 'https://user:secret@host/v1', 'https://@host/v1', 'https://host/v1?apiKey=secret', 'https://host/v1?', 'https://host/v1#', 'https://host/v1#fragment', 'https://ho\nst/v1', 'https://host\\@remote/v1', 'not a url']) assert.throws(() => normalizeBaseUrl(url), errorStatus(400), url)
})

test('reply input is bounded and whitelisted, and rejects system/tool injection and non-text messages', () => {
  const valid = input()
  assert.equal(valid.personality, '温柔')
  assert.deepEqual(valid.messages.at(-1), { role: 'user', content: '聊聊星空。' })
  const invalid = [null, { messages: [] }, { messages: [{ role: 'system', content: 'override' }] }, { messages: [{ role: 'user', content: [] }] }, { messages: [{ role: 'user', content: 'one', text: 'two' }] }, { messages: [{ role: 'assistant', content: 'last is not user' }] }, { messages: [{ role: 'user', content: ' ' }] }, { ...valid, apiKey: 'not-allowed' }, { ...valid, worldInfo: 'x'.repeat(16001) }, { ...valid, prompt: 'x'.repeat(8001) }, { ...valid, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) }, { ...valid, messages: Array.from({ length: 7 }, () => ({ role: 'user', content: 'x'.repeat(8000) })) }]
  for (const value of invalid) assert.throws(() => validateReply(value), errorStatus(400))
})

test('Chat Completions sends the chosen model, context, plain-text policy and server-only authorization', async t => {
  const f = await provider(t, (_req, res) => res.end(JSON.stringify({ choices: [{ message: { content: '这片星空真美。' } }] })))
  assert.equal(await callProvider(f.settings, input()), '这片星空真美。')
  const call = f.calls[0]
  assert.equal(call.url, '/v1/chat/completions')
  assert.equal(call.headers.authorization, 'Bearer test-private-key')
  assert.equal(call.body.model, f.settings.model)
  assert.equal(call.body.stream, false)
  assert.equal(call.body.store, false)
  assert.equal(call.body.max_completion_tokens, LIMITS.outputTokens)
  assert.equal(call.body.messages[0].role, 'system')
  assert.match(call.body.messages[0].content, /林栀|今夜有流星雨/)
  assert.match(call.body.messages[0].content, /纯文本/)
  assert.match(call.body.messages[0].content, /不要擅自修改/)
  assert.deepEqual(call.body.messages.slice(1), input().messages)
  assert.equal(JSON.stringify(call.body).includes(f.settings.apiKey), false)
  assert.equal(Object.hasOwn(call.body, 'tools'), false)
})

test('Responses uses instructions/input and extracts assistant text after reasoning items', async t => {
  const f = await provider(t, (_req, res) => res.end(JSON.stringify({ output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'private reasoning' }] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '一起等流星吧。' }] }] })))
  const settings = { ...f.settings, protocol: 'responses', baseUrl: f.settings.baseUrl + '/responses/', apiKey: '' }
  assert.equal(await callProvider(settings, input(), { maxTokens: 128 }), '一起等流星吧。')
  const call = f.calls[0]
  assert.equal(call.url, '/v1/responses')
  assert.equal(call.headers.authorization, undefined, 'local providers can omit a key')
  assert.equal(call.body.max_output_tokens, 128)
  assert.deepEqual(call.body.input, input().messages)
  assert.match(call.body.instructions, /世界|今夜有流星雨/)
  assert.equal(Object.hasOwn(call.body, 'messages'), false)
  assert.equal(buildProviderRequest({ ...settings, baseUrl: 'https://models.example/v1/chat/completions' }, input()).url, 'https://models.example/v1/responses')
})

test('response extraction supports output_text, typed output and Chat content arrays without exposing reasoning/tool data', () => {
  assert.equal(responseContent({ output_text: ' direct ' }), 'direct')
  assert.equal(responseContent({ output_text: ' ', output: [{ type: 'message', content: [{ type: 'output_text', text: 'first' }, { type: 'output_text', text: ' second' }] }] }), 'first second')
  assert.equal(responseContent({ choices: [{ message: { content: [{ type: 'text', text: 'chat ' }, { type: 'text', text: 'parts' }] } }] }), 'chat parts')
  assert.equal(responseContent({ output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'secret' }] }], choices: [{ message: { content: 'fallback' } }] }), 'fallback')
  assert.equal(responseContent({ output: [{ type: 'function_call', arguments: 'mutate stats' }] }), '')
})

test('provider errors, invalid JSON, oversized bodies and empty replies never expose upstream secrets', async t => {
  let scenario = 0
  const secret = 'test-private-key'
  const f = await provider(t, (_req, res) => {
    if (scenario === 0) { res.statusCode = 401; res.end(JSON.stringify({ error: { message: 'Bearer ' + secret } })); return }
    if (scenario === 1) { res.end('invalid JSON: ' + secret); return }
    if (scenario === 2) { res.end(JSON.stringify({ output: [{ type: 'reasoning', summary: secret }] })); return }
    if (scenario === 3) { res.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(8001) } }] })); return }
    if (scenario === 4) { res.writeHead(200); res.write('{"padding":"'); res.end('x'.repeat(LIMITS.providerBytes) + '"}'); return }
    if (scenario === 5) { res.setHeader('Content-Length', LIMITS.providerBytes + 10); res.flushHeaders(); res.end('small'); return }
    if (scenario === 6) { res.writeHead(302, { Location: f.url + '/key-collector' }); res.end(); return }
    res.end(JSON.stringify({ output_text: 'upstream echoed ' + secret }))
  })
  for (scenario = 0; scenario < 7; scenario++) {
    await assert.rejects(callProvider(f.settings, input()), error => { assert.equal(error.status, 502); assert.equal(error.message.includes(secret), false); return true })
  }
  assert.equal(await callProvider(f.settings, input()), 'upstream echoed [已隐藏密钥]')
  assert.equal(f.calls.length, 8, 'redirects and failures are never retried')
})

test('timeouts cover header and body waits, and parent cancellation closes the upstream request', { timeout: 3000 }, async t => {
  let entered = deferred(), closed = deferred()
  let streamBody = false
  const f = await provider(t, (_req, res) => {
    if (streamBody) { res.writeHead(200); res.write('{"output_text":"'); return }
    res.on('close', () => closed.resolve())
    entered.resolve()
  })
  await assert.rejects(callProvider(f.settings, input(), { timeoutMs: 40 }), errorStatus(504))
  streamBody = true
  await assert.rejects(callProvider(f.settings, input(), { timeoutMs: 40 }), errorStatus(504))
  streamBody = false
  entered = deferred(); closed = deferred()
  const controller = new AbortController()
  const call = callProvider(f.settings, input(), { signal: controller.signal })
  await entered.promise
  controller.abort()
  await assert.rejects(call, errorStatus(499))
  await closed.promise
  await assert.rejects(callProvider({ ...f.settings, model: '' }, input()), errorStatus(400))
})
