import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeSnapshot } from '../shared/persistence.js'
import { createConfig, accountId } from '../applications/studio/plugins/image-provider-wavespeed/config.js'
import { createCatalog } from '../applications/studio/plugins/image-provider-wavespeed/catalog.js'
import { normalizeModels, describeSchema, prepareInput } from '../applications/studio/plugins/image-provider-wavespeed/schema.js'
import { createWaveSpeed, outputURLs } from '../applications/studio/plugins/image-provider-wavespeed/wavespeed.js'
import { createJobs } from '../applications/studio/plugins/image-generation/jobs.js'
import { generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { createStore, owner } from './helpers/studio-fixture.js'
import { row, modelRows, createWaveMock, imageFixture, until } from './helpers/studio-wavespeed.js'

const models = () => normalizeModels(structuredClone(modelRows))
const input = patch => ({ prompt: '测试生成', parameters: {}, references: [], bindings: {}, ...patch })
async function directory(t, cleanups = []) { const path = await mkdtemp(join(tmpdir(), 'studio-wavespeed-')); t.after(async () => { for (const fn of cleanups.reverse()) await fn(); await rm(path, { recursive: true, force: true }) }); return path }
async function transport(t) { const mock = await createWaveMock(), wave = createWaveSpeed(); t.after(async () => { await wave.close(); await mock.close() }); return { mock, wave } }

test('模型目录覆盖所有图片视频类型，搜索分页、缓存合并、刷新与账户隔离', async t => {
  const dir = await directory(t), config = await createConfig(dir, { writeSnapshot, env: { WAVESPEED_API_KEY: 'test-key' } })
  let calls = 0
  const rows = [...modelRows, ...Array.from({ length: 65 }, (_, i) => row('extra/image-' + i, 'text-to-image', { prompt: { type: 'string' } }))]
  const catalog = await createCatalog(dir, config, { async api() { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return structuredClone(rows) } }, writeSnapshot)
  const [first, second] = await Promise.all([catalog.list({ limit: 30 }), catalog.list({ offset: 30, limit: 30 })])
  assert.equal(calls, 1); assert.equal(first.catalogTotal, 70); assert.equal(first.items.length, 30); assert.equal(second.items.length, 30)
  assert.equal(new Set([...first.items, ...second.items].map(m => m.id)).size, 60)
  assert.equal((await catalog.list({ query: 'extra/image-64' })).items[0].id, 'extra/image-64')
  assert.deepEqual((await catalog.list({ kind: 'video' })).items.map(m => m.id), ['mock/video', 'mock/video-edit'])
  assert.equal((await catalog.list({ type: 'image-to-image' })).total, 1)
  assert.equal((await catalog.detail('mock/no-schema')).supported, false)
  await catalog.list({ refresh: true }); assert.equal(calls, 2)
  const cached = await createCatalog(dir, config, { api() { throw Error('新鲜缓存不应联网') } }, writeSnapshot)
  assert.equal((await cached.list()).catalogTotal, 70)
  await config.save({ apiKey: 'other-key' })
  assert.throws(() => cached.get('mock/image'), /先打开/)
  assert.equal((await catalog.list()).catalogTotal, 70); assert.equal(calls, 3)
  assert.doesNotMatch(await readFile(join(dir, 'models-cache.json'), 'utf8'), /test-key|other-key/)
})

test('私有配置持久化，公开数据不包含 Key，空白保留原 Key，拒绝不安全接口', async t => {
  const dir = await directory(t), config = await createConfig(dir, { writeSnapshot, env: { WAVESPEED_API_KEY: 'test-key' } })
  assert.doesNotMatch(JSON.stringify(config.public()), /test-key/)
  const fingerprint = accountId(config.private())
  await config.save({ apiKey: '  ' }); assert.equal(accountId(config.private()), fingerprint)
  await assert.rejects(config.save({ baseUrl: 'http://example.com' }), /HTTPS/)
  await assert.rejects(config.save({ baseUrl: 'https://example.com/api/v3?secret=x' }), /HTTPS/)
  await config.save({ baseUrl: 'https://example.com/api/v3/', apiKey: 'updated-key' })
  const reopened = await createConfig(dir, { writeSnapshot, env: {} })
  assert.equal(reopened.private().apiKey, 'updated-key'); assert.equal(reopened.public().baseUrl, 'https://example.com')
})

test('模型真实约束、嵌套默认值与同步开关校验，拒绝必填、枚举、范围和未知字段', () => {
  const model = models().get('mock/image'), prepared = prepareInput(model, input({ parameters: { steps: 7, enable_sync_mode: true } }))
  assert.deepEqual(prepared.parameters, { steps: 7, size: '1k', seed: -1, options: { strength: 0.5 }, prompt: '测试生成', enable_sync_mode: false, enable_base64_output: false })
  for (const parameters of [{ steps: 0 }, { steps: 1.5 }, { size: '4k' }, { options: { strength: 2 } }, { unknown: true }]) assert.throws(() => prepareInput(model, input({ parameters })), /参数不符合/)
  assert.throws(() => prepareInput(model, input({ prompt: '' })), /参数不符合/)
  const nested = { type: 'object', $defs: { strength: { type: 'number', default: 0.6 } }, properties: { options: { allOf: [{ type: 'object', properties: { strength: { $ref: '#/$defs/strength' } } }] } } }
  assert.equal(describeSchema(nested).defaults.options.strength, 0.6)
  for (const $schema of ['https://json-schema.org/draft/2020-12/schema', 'https://json-schema.org/draft/2019-09/schema']) {
    const copy = structuredClone(model); copy.schema.$schema = $schema
    assert.equal(prepareInput(copy, input()).preview.steps, 20)
  }
})

test('卡片内素材与连线素材共同排序，按真实服务键读取模型参数和首尾帧绑定', async t => {
  const store = await createStore(await directory(t)), [a, b] = await Promise.all([store.addImage(await imageFixture()), store.addImage(await imageFixture())])
  const board = store.read().boards[0], key = 'wavespeed:mock/video'
  const result = await store.edit(board.id, 0, [
    { type: 'add', node: { id: 'i', type: 'image', assetId: b.id } },
    { type: 'add', node: { id: 'g', type: 'generator', model: 'mock/video', prompt: '动起来', modelParameters: { [key]: { duration: 5 }, 'pixel:mock/video': { duration: 99 } }, references: [{ id: 'first', assetId: a.id }], referenceOrder: ['edge:linked', 'direct:first'], referenceBindings: { [key]: { 'edge:linked': '/start_image', 'direct:first': '/end_image' } } } },
    { type: 'connect', id: 'linked', from: 'i', to: 'g' },
  ])
  const snapshot = generationInput(result.board, 'g', store.types, store.read().assets, { providerId: 'wavespeed' })
  assert.deepEqual(snapshot.assetIds, [b.id, a.id]); assert.equal(snapshot.parameters.duration, 5)
  assert.deepEqual(snapshot.references.map(r => r.source), ['edge', 'direct'])
  const prepared = prepareInput(models().get('mock/video'), snapshot)
  const body = prepared.fill(new Map([['edge:linked', 'https://example.com/first.png'], ['direct:first', 'https://example.com/last.png']]))
  assert.equal(body.start_image, 'https://example.com/first.png'); assert.equal(body.end_image, 'https://example.com/last.png')
  assert.deepEqual(prepared.bindings, snapshot.bindings); assert.equal(prepared.parameters.start_image, undefined)
})

test('每份参考必须使用，首尾帧必须显式分配，单输入自动绑定、数组保序和超限拒绝', () => {
  const all = models(), refs = [0, 1].map(i => ({ key: 'direct:' + i, assetId: String(i), kind: 'image' }))
  assert.throws(() => prepareInput(all.get('mock/video'), input({ references: refs })), /指定输入位置/)
  const firstFrame = prepareInput(all.get('mock/video'), input({ references: [refs[0]] }))
  assert.deepEqual(firstFrame.bindings, { 'direct:0': '/start_image' })
  assert.equal(firstFrame.fill(new Map([['direct:0', 'https://example.com/first.png']])).start_image, 'https://example.com/first.png')
  assert.throws(() => prepareInput(all.get('mock/video'), input({ references: refs, bindings: { 'direct:0': '/start_image', 'direct:1': '/start_image' } })), /最多接受 1/)
  assert.throws(() => prepareInput(all.get('mock/image'), input({ references: refs })), /不接受图片/)
  assert.throws(() => prepareInput(all.get('mock/edit'), input({ references: [{ ...refs[0], kind: 'video' }] })), /不接受视频/)
  assert.throws(() => prepareInput(all.get('mock/edit'), input({ references: [...refs, ...refs] })), /最多接受 3/)
  const prepared = prepareInput(all.get('mock/edit'), input({ references: refs }))
  assert.deepEqual(prepared.bindings, { 'direct:0': '/images', 'direct:1': '/images' })
  assert.deepEqual(prepared.fill(new Map(refs.map(r => [r.key, r.key]))).images, ['direct:0', 'direct:1'])
})

test('真实 HTTP 上传保留签名与字节，PUT/结果下载无 Key，checkpoint 落盘后才查询且只 POST 一次', async t => {
  const { mock, wave } = await transport(t), model = models().get('mock/edit')
  const refs = ['a', 'b'].map(key => ({ key, assetId: 'same-image', kind: 'image' })), values = input({ references: refs }), checkpoints = []
  const output = await wave.generate(mock.config, model, values, prepareInput(model, values), [mock.png, mock.png], new AbortController().signal,
    async checkpoint => { checkpoints.push(checkpoint); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(mock.requests.some(r => r.method === 'GET' && r.url.includes('predictions')), false) }, accountId(mock.config))
  assert.equal(mock.uploads.size, 1); assert.deepEqual(mock.uploads.get('1').bytes, mock.png)
  assert.equal(mock.uploads.get('1').input.size, mock.png.length)
  assert.equal(mock.requests.filter(r => r.method === 'POST' && r.url === '/api/v3/mock/edit').length, 1)
  assert.deepEqual(mock.requests.find(r => r.body).body.images, [mock.origin + '/media/1', mock.origin + '/media/1'])
  assert.deepEqual(checkpoints.map(c => c.phase), ['preparing', 'submitting', 'submitted'])
  assert.deepEqual(output, [{ bytes: mock.png, kind: 'image' }]); assert.deepEqual(mock.errors, [])
})

test('非 JSON 的明确提交错误标为失败，网络异常仍保持不确定，输出格式解析图片和视频', async t => {
  const { mock, wave } = await transport(t); mock.state.submissionStatus = 402
  const model = models().get('mock/image'), values = input()
  await assert.rejects(wave.generate(mock.config, model, values, prepareInput(model, values), [], new AbortController().signal, async () => {}, accountId(mock.config)), error => error.terminal === true && error.statusCode === 402)
  const broken = createWaveSpeed({ request: async () => { throw Error('socket closed') } }); t.after(() => broken.close())
  await assert.rejects(broken.api(mock.config, 'POST', model.path, {}, undefined, true), error => !error.terminal)
  assert.deepEqual(outputURLs({ images: [{ url: 'https://example.com/a.png' }], videos: ['https://example.com/a.mp4'] }, 'image').map(o => o.kind), ['image', 'video'])
})

test('暂停后保存迟到的远端 ID，重启只恢复查询，不重新提交；实际参数与绑定持久化', async t => {
  const cleanups = [], dir = await directory(t, cleanups), store = await createStore(dir), jobs = await createJobs(store), base = owner()
  let submit = 0, query = 0, release, checkpointSaved
  cleanups.push(() => jobs.close())
  const account = accountId({ baseUrl: 'https://example.com', apiKey: 'test-key' })
  const provider = { id: 'wavespeed', label: '测试', public: () => ({ modelCatalog: true, resumable: true }), prepare: () => ({ model: 'mock/image', outputKind: 'image', parameters: { steps: 20, seed: -1 }, bindings: { 'direct:a': '/images' }, async generate(_, signal, { checkpoint }) {
    submit++; await checkpoint({ phase: 'submitting', account })
    await new Promise(resolve => { release = resolve }); await checkpoint({ phase: 'submitted', account, taskId: 'late-task' }); checkpointSaved = true
    signal.throwIfAborted(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } }), resume: job => ({ model: job.model, async generate() { query++; return imageFixture() } }) }
  jobs.register(base, provider)
  const board = store.read().boards[0]
  await store.edit(board.id, 0, [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/image', prompt: '保存任务' } }])
  const id = randomUUID(), request = { requestId: id, boardId: board.id, nodeId: 'g', revision: 1 }
  await jobs.start(request); await until(() => release)
  await jobs.cancel(id); assert.equal(jobs.read()[0].status, 'uncertain')
  await assert.rejects(jobs.start({ ...request, requestId: randomUUID(), revision: store.read().boards[0].revision }), /提交结果未确认/)
  release(); await until(() => checkpointSaved); await until(() => jobs.read()[0].status === 'paused')
  assert.equal(jobs.read()[0].remote.taskId, 'late-task'); assert.equal(submit, 1)
  await jobs.close()
  await store.records('image-generation').change(tx => { tx.records[0].status = 'running' })
  const reopened = await createStore(dir), restored = await createJobs(reopened); cleanups.push(() => restored.close())
  restored.register(owner(), provider)
  await until(() => restored.read()[0].status === 'succeeded')
  assert.equal(submit, 1); assert.equal(query, 1)
  assert.equal(restored.read()[0].input.parameters.seed, -1)
  assert.deepEqual(restored.read()[0].input.bindings, { 'direct:a': '/images' })
  assert.equal(reopened.read().boards[0].nodes.filter(n => n.jobId === id).length, 1)
})

test('无法确认的提交重启后不自动重试，账户不匹配拒绝恢复，可结束跟踪再生成', async t => {
  const cleanups = [], store = await createStore(await directory(t, cleanups)), jobs = await createJobs(store), board = store.read().boards[0]
  cleanups.push(() => jobs.close())
  let submits = 0
  jobs.register(owner(), { id: 'uncertain', label: '不确定', public: () => ({}), prepare: () => ({ model: 'test', async generate(_, signal, { checkpoint }) { submits++; await checkpoint({ phase: 'submitting' }); throw Error('连接断开') } }) })
  await store.edit(board.id, 0, [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'uncertain', prompt: '测试' } }])
  const request = { requestId: randomUUID(), boardId: board.id, nodeId: 'g', revision: 1 }
  await jobs.start(request); await until(() => jobs.read()[0].status === 'uncertain')
  await jobs.start(request); assert.equal(submits, 1)
  await assert.rejects(jobs.resume(request.requestId), /没有可恢复/)
  await jobs.detach(request.requestId); assert.equal(jobs.read()[0].status, 'detached')
  await jobs.start({ ...request, requestId: randomUUID(), revision: store.read().boards[0].revision }); await until(() => submits === 2)
  await jobs.close()
  const restored = await createJobs(store); cleanups.push(() => restored.close())
  restored.register(owner(), { id: 'uncertain', label: '不确定', public: () => ({}), prepare() { throw Error('重启不能提交') }, resume() { throw Error('账户已变化') } })
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(submits, 2)
  await store.records('image-generation').change(tx => { tx.records[1].status = 'paused'; tx.records[1].remote = { phase: 'submitted', taskId: 'known' } })
  await assert.rejects(restored.resume(restored.read()[1].id), /账户已变化/)
  assert.equal(restored.read()[1].status, 'paused')
})
