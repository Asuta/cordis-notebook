import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSnapshot } from '../shared/persistence.js'
import { createConfig, imageSize, models, normalizeConfig } from '../applications/studio/plugins/image-provider-4dai/config.js'
import { create4dai } from '../applications/studio/plugins/image-provider-4dai/transport.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])
const config = { baseUrl: 'https://api.4dai.cc', model: models[0].id, apiKey: 'test-secret' }

test('4dai 配置仅允许两个 GPT Image 模型，Key 私有且可保留', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-4dai-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const settings = await createConfig(dir, { writeSnapshot, env: {} })
  assert.deepEqual(settings.public().models.map(item => item.id), models.map(item => item.id))
  assert.equal(settings.public().hasKey, false)
  await settings.save({ apiKey: 'test-secret', model: models[1].id })
  assert.equal(settings.private().model, models[1].id)
  assert.equal(settings.public().model, models[1].id)
  assert.doesNotMatch(JSON.stringify(settings.public()), /test-secret/)
  await settings.save({ model: models[0].id, apiKey: '' })
  assert.equal(settings.private().apiKey, 'test-secret')
  const persisted = await readFile(join(dir, '4dai-private.json'), 'utf8')
  assert.match(persisted, /test-secret/)
  assert.throws(() => normalizeConfig({ ...config, model: 'gpt-image-2-4k' }), /支持的 GPT Image/)
  assert.equal(imageSize('16:9', '2k'), '2048x1152')
})

test('4dai 文生图发 JSON generations 并接受 base64 结果', async t => {
  const calls = []
  const transport = create4dai({ request: async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  } })
  t.after(() => transport.close())
  const result = await transport.generate({ prompt: '测试提示词', ratio: '16:9', resolution: '2k' }, config, [], new AbortController().signal)
  assert.deepEqual(result, png)
  assert.equal(calls[0].url, 'https://api.4dai.cc/v1/images/generations')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret')
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: models[0].id, prompt: '测试提示词', n: 1, quality: 'high', response_format: 'b64_json', size: '2048x1152' })
})

test('4dai 有参考图时发 multipart edits 并携带图片', async t => {
  let received
  const transport = create4dai({ request: async (url, options) => {
    received = { url, options }
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
  } })
  t.after(() => transport.close())
  await transport.generate({ prompt: '编辑参考图', ratio: 'auto', resolution: '1k' }, config, [png], new AbortController().signal)
  assert.equal(received.url, 'https://api.4dai.cc/v1/images/edits')
  assert.equal(received.options.body.get('model'), models[0].id)
  assert.equal(received.options.body.get('prompt'), '编辑参考图')
  assert.equal(received.options.body.getAll('image[]').length, 1)
  assert.match(received.options.body.getAll('image[]')[0].name, /reference-1\.png/)
  assert.equal(received.options.body.get('size'), null)
})
