import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createSettingsStore, publicSettings } from '../settings.js'
import { deferred, pluginServer, provider, temporaryDirectory } from './helpers.js'

const keys = ['baseUrl', 'hasApiKey', 'model', 'protocol', 'revision']
test('private settings default to empty endpoint/model and persist secrets exclusively in settings-private.json', async t => {
  const directory = await temporaryDirectory(t)
  const store = await createSettingsStore(directory)
  assert.deepEqual(publicSettings(store.snapshot()), { baseUrl: '', model: '', protocol: 'chat', hasApiKey: false, revision: 0 })
  const secret = 'only-in-server-private-file'
  const saved = await store.update({ baseUrl: 'http://127.0.0.1:8080/v1/', model: 'my-model', protocol: 'responses', apiKey: secret, revision: 0 })
  assert.deepEqual(Object.keys(saved).sort(), keys)
  assert.equal(saved.baseUrl, 'http://127.0.0.1:8080/v1')
  assert.equal(saved.hasApiKey, true)
  assert.equal(JSON.stringify(saved).includes(secret), false)
  const stored = JSON.parse(await readFile(join(directory, 'settings-private.json'), 'utf8'))
  assert.equal(stored.apiKey, secret)
  assert.deepEqual(await readdir(directory), ['settings-private.json'])
  if (process.platform !== 'win32') assert.equal((await stat(join(directory, 'settings-private.json'))).mode & 0o777, 0o600)
  const reopened = await createSettingsStore(directory)
  assert.equal(reopened.snapshot().apiKey, secret)
  assert.equal(reopened.snapshot().revision, 1)
  await reopened.update({ apiKey: '' })
  assert.equal(reopened.snapshot().apiKey, secret, 'blank key preserves an existing secret')
  await reopened.update({ clearApiKey: true })
  assert.equal(publicSettings(reopened.snapshot()).hasApiKey, false)
  assert.equal(JSON.parse(await readFile(join(directory, 'settings-private.json'), 'utf8')).apiKey, '')
})

test('settings revisions serialize concurrent writes and validation failure preserves the prior private file', async t => {
  const directory = await temporaryDirectory(t)
  const store = await createSettingsStore(directory)
  const results = await Promise.allSettled([store.update({ model: 'one', revision: 0 }), store.update({ model: 'two', revision: 0 })])
  assert.deepEqual(results.map(item => item.status), ['fulfilled', 'rejected'])
  assert.equal(results[1].reason.status, 409)
  assert.equal(store.snapshot().model, 'one')
  const before = await readFile(join(directory, 'settings-private.json'), 'utf8')
  for (const input of [null, { protocol: 'stream' }, { apiKey: '\r\nInjected: value' }, { apiKey: '\n' }, { apiKey: 5 }, { apiKey: 'x'.repeat(4097) }, { clearApiKey: 'yes' }, { clearApiKey: true, apiKey: 'new' }, { model: '\n' }, { baseUrl: 'https://user:pass@provider.example/v1' }, { baseUrl: 'https://provider.example/v1?secret=x' }, { revision: -1 }, { revision: 0.5 }, { hasApiKey: true }, { unexpected: true }]) {
    await assert.rejects(store.update(input), error => error.status === 400)
    assert.equal(await readFile(join(directory, 'settings-private.json'), 'utf8'), before)
  }
  assert.equal((await store.update({ model: 'valid-after-errors' })).revision, 2)
})

test('corrupt settings are retained and parser errors never contain their contents', async t => {
  const directory = await temporaryDirectory(t)
  const path = join(directory, 'settings-private.json')
  const corrupt = '{"apiKey":"secret-in-invalid-file",invalid}'
  await writeFile(path, corrupt)
  await assert.rejects(createSettingsStore(directory), error => error.status === 500 && !error.message.includes('secret-in-invalid-file'))
  assert.equal(await readFile(path, 'utf8'), corrupt)
})

test('HTTP settings/reply/test endpoints use the stored connection and expose no key or upstream errors', async t => {
  let failing = false
  const f = await provider(t, (_req, res) => {
    if (failing) { res.statusCode = 500; res.end('do not expose test-private-key'); return }
    res.end(JSON.stringify({ output_text: '你好，欢迎来到观测站。' }))
  })
  const app = await pluginServer(t)
  const initial = await app.request('settings')
  assert.equal(initial.status, 200)
  assert.equal(initial.value.model, '')
  assert.equal(initial.value.baseUrl, '')
  assert.equal((await app.request('test', 'POST', {})).status, 400)
  const saved = await app.request('settings', 'PUT', { ...f.settings, revision: 0 })
  assert.equal(saved.status, 200)
  assert.deepEqual(Object.keys(saved.value).sort(), keys)
  assert.equal(JSON.stringify(saved.value).includes(f.settings.apiKey), false)
  const payload = { character: '林栀', personality: '温柔', worldInfo: '观测站', prompt: '只说一句', messages: [{ role: 'user', content: '你好' }] }
  const reply = await app.request('reply', 'POST', payload)
  assert.deepEqual(reply, { status: 200, value: { reply: '你好，欢迎来到观测站。' } })
  assert.equal(f.calls[0].headers.authorization, 'Bearer ' + f.settings.apiKey)
  const tested = await app.request('test', 'POST', {})
  assert.equal(tested.value.ok, true)
  assert.equal(f.calls[1].body.max_completion_tokens, 128)
  assert.equal((await app.request('test', 'POST', { apiKey: 'not-accepted' })).status, 400)
  assert.equal((await app.request('settings', 'PUT', { revision: 0, model: 'stale' })).status, 409)
  assert.equal((await app.request('reply', 'POST', { ...payload, model: 'cannot-override' })).status, 400)
  assert.equal((await app.request('reply', 'POST', { ...payload, prompt: 'x'.repeat(300000) })).status, 413)
  assert.equal((await app.request('settings-private.json')).status, 404)
  failing = true
  const failure = await app.request('reply', 'POST', payload)
  assert.equal(failure.status, 502)
  assert.equal(JSON.stringify(failure.value).includes(f.settings.apiKey), false)
  assert.equal(f.calls.length, 3)
})

test('manifest declares optional server/client services and publishes only browser assets', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(pkg.cordis.requires, { server: ['http'], client: ['narrative', 'narrativeUI'] })
  assert.deepEqual(pkg.cordis.public, ['client.js', 'style.css'])
  assert.equal(pkg.cordis.public.includes('server.js'), false)
  assert.equal(pkg.dependencies, undefined)
})

test('HTTP disconnect cancels the real upstream fetch rather than waiting for its timeout', { timeout: 3000 }, async t => {
  const entered = deferred(), closed = deferred()
  const f = await provider(t, (_req, res) => { res.once('close', () => closed.resolve()); entered.resolve() })
  const app = await pluginServer(t)
  await app.request('settings', 'PUT', f.settings)
  const controller = new AbortController()
  const waiting = fetch(app.url + '/api/narrative/ai/reply', {
    method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character: '林栀', messages: [{ role: 'user', content: '你好' }] }),
  }).then(() => null, error => error)
  await entered.promise
  controller.abort()
  assert.equal((await waiting).name, 'AbortError')
  await closed.promise
})

test('plugin disposal aborts upstream work and removes its routes', { timeout: 3000 }, async t => {
  const entered = deferred(), closed = deferred()
  const f = await provider(t, (_req, res) => { res.once('close', () => closed.resolve()); entered.resolve() })
  const app = await pluginServer(t)
  await app.request('settings', 'PUT', f.settings)
  const waiting = app.request('reply', 'POST', { messages: [{ role: 'user', content: '你好' }] })
  await entered.promise
  await app.ctx.dispose()
  assert.equal((await waiting).status, 499)
  await closed.promise
  assert.equal((await app.request('settings')).status, 404)
})
