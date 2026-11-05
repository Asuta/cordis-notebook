import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSnapshot } from '../shared/persistence.js'
import { Window } from 'happy-dom'
import { createConfig, models, normalizeConfig } from '../applications/studio/plugins/image-provider-sudeng/config.js'
import { createSudeng } from '../applications/studio/plugins/image-provider-sudeng/transport.js'
import providerPlugin from '../applications/studio/plugins/image-provider-sudeng/server.js'
import providerClient from '../applications/studio/plugins/image-provider-sudeng/client.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
const config = { baseUrl: 'https://sudeng.cc', model: models[0].id, apiKey: 'test-secret' }

test('速登配置独立保存 Key 和两个 GPT Image 模型', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-sudeng-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const settings = await createConfig(dir, { writeSnapshot, env: {} })
  assert.deepEqual(settings.public().models.map(item => item.id), models.map(item => item.id))
  assert.equal(settings.public().hasKey, false)
  await settings.save({ apiKey: 'test-secret', model: models[1].id })
  assert.equal(settings.public().model, models[1].id)
  assert.doesNotMatch(JSON.stringify(settings.public()), /test-secret/)
  await settings.save({ model: models[0].id, apiKey: '' })
  assert.equal(settings.private().apiKey, 'test-secret')
  assert.match(await readFile(join(dir, 'sudeng-private.json'), 'utf8'), /test-secret/)
  assert.throws(() => normalizeConfig({ ...config, model: 'unlisted' }), /支持的速登 GPT Image/)
})

test('速登任务优先采用卡片模型，旧卡片沿用渠道默认模型', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-sudeng-provider-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeSnapshot(join(dir, 'sudeng-private.json'), JSON.stringify(config))
  let provider
  const ctx = { effect(cleanup) { t.after(cleanup()) }, imageGeneration: { register(owner, value) { provider = value } }, http: { route() {} } }
  await providerPlugin(ctx, {}, { dataDir: dir, writeSnapshot })
  const input = { prompt: '测试', assetIds: [], ratio: '1:1', resolution: '1k' }
  assert.equal(provider.prepare(input).model, models[0].id)
  assert.equal(provider.prepare({ ...input, model: models[1].id }).model, models[1].id)
  assert.throws(() => provider.prepare({ ...input, model: 'other-model' }), /支持的速登 GPT Image/)
})

test('速登设置入口仅提交 Key 到独立配置 API', async t => {
  const window = new Window()
  t.after(() => window.happyDOM.close())
  const root = window.document.createElement('main'), side = window.document.createElement('aside')
  root.append(side)
  const state = { providers: [{ id: 'sudeng', model: models[0].id, models, hasKey: false, baseUrl: 'https://sudeng.cc' }] }
  let request
  const el = (tag, props = {}, content) => {
    const element = window.document.createElement(tag)
    for (const [name, value] of Object.entries(props)) name === 'class' ? element.className = value : element.setAttribute(name, value)
    if (content !== undefined) element.textContent = content
    return element
  }
  const ctx = { canvasSession: { state }, canvasUI: { el, button: (label, action, className) => { const button = el('button', { class: className || '' }, label); button.onclick = action; return button }, root, side, refresh: async () => {}, render: () => {} }, effect(fn) { t.after(fn()) } }
  providerClient(ctx, { request: async (path, method, body) => { request = { path, method, body } } })
  assert.equal(side.querySelector('button').textContent, '⚙ 速登')
  side.querySelector('button').onclick()
  const dialog = root.querySelector('dialog')
  assert.match(dialog.textContent, /结果不明时重复提交/)
  const key = dialog.querySelector('[aria-label="速登 API Key"]')
  key.value = 'test-secret'
  dialog.querySelector('[aria-label="速登默认模型"]').value = models[1].id
  await [...dialog.querySelectorAll('button')].find(button => button.textContent === '保存速登设置').onclick()
  assert.deepEqual(request, { path: '/api/studio/sudeng/config', method: 'POST', body: { baseUrl: 'https://sudeng.cc', model: models[1].id, apiKey: 'test-secret' } })
  assert.equal(key.value, '')
  assert.doesNotMatch(root.textContent, /test-secret/)
})

test('速登文生图使用已实测的 JSON generations 请求与 Base64 响应', async t => {
  const calls = []
  const transport = createSudeng({ request: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ model: models[0].id, data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  } })
  t.after(() => transport.close())
  const result = await transport.generate({ prompt: '蓝色圆形', ratio: '1:1', resolution: '1k' }, config, [], new AbortController().signal)
  assert.deepEqual(result, png)
  assert.equal(calls[0].url, 'https://sudeng.cc/v1/images/generations')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret')
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: models[0].id, prompt: '蓝色圆形', n: 1, quality: 'high', response_format: 'b64_json', size: '1024x1024' })
})

test('速登参考图编辑构造 OpenAI 兼容的 multipart edits 请求', async t => {
  let received
  const transport = createSudeng({ request: async (url, options) => {
    received = { url, options }
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  } })
  t.after(() => transport.close())
  await transport.generate({ prompt: '编辑参考图', ratio: 'auto', resolution: '1k' }, config, [png], new AbortController().signal)
  assert.equal(received.url, 'https://sudeng.cc/v1/images/edits')
  assert.equal(received.options.body.get('model'), models[0].id)
  assert.equal(received.options.body.getAll('image[]').length, 1)
  assert.equal(received.options.body.get('size'), null)
})
