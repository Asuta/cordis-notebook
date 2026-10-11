import { writeSnapshot } from '../shared/persistence.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { newBoard } from '../applications/studio/plugins/canvas/store.js'
import { createStore, applyOperation, generationInput, createJobs } from './helpers/studio-fixture.js'
import { createConfig, createPixel, imageSize } from '../applications/studio/plugins/image-provider-pixel/pixel.js'
import { prepareReferences, referenceUploadBudget } from '../applications/studio/plugins/image-provider-pixel/references.js'

async function setup(t) { const directory = await mkdtemp(join(tmpdir(), 'cordis-studio-')); t.after(() => rm(directory, { recursive: true, force: true })); return { directory, store: await createStore(directory) } }
const png = () => sharp({ create: { width: 8, height: 6, channels: 4, background: '#759253' } }).png().toBuffer()
const until = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)) }; assert.fail('等待任务超时') }

test('卡片操作可撤销；连线只接入生成卡片，顺序决定提示词和参考图', () => {
  let board = newBoard('测试')
  for (const node of [{ id: 'a', type: 'text', text: '第一段' }, { id: 'b', type: 'text', text: '第二段' }, { id: 'g', type: 'generator', prompt: '补充要求' }]) board = applyOperation(board, { type: 'add', node }, {}).board
  board = applyOperation(board, { type: 'connect', id: 'e1', from: 'a', to: 'g' }, {}).board
  board = applyOperation(board, { type: 'connect', id: 'e2', from: 'b', to: 'g' }, {}).board
  assert.equal(generationInput(board, 'g').prompt, '第一段\n\n第二段\n\n补充要求')
  const changed = applyOperation(board, { type: 'reorder', id: 'g', edges: ['e2', 'e1'] }, {})
  assert.equal(generationInput(changed.board, 'g').prompt, '第二段\n\n第一段\n\n补充要求')
  assert.deepEqual(applyOperation(changed.board, changed.inverse, {}).board.edges, board.edges)
  assert.throws(() => applyOperation(board, { type: 'connect', id: 'bad', from: 'g', to: 'a' }, {}), /只能/)
  const removed = applyOperation(board, { type: 'remove', ids: ['a'] }, {})
  assert.equal(removed.board.edges.length, 1)
  assert.equal(applyOperation(removed.board, removed.inverse, {}).board.nodes.length, 3)
})

test('存储采用版本检查和原子操作，图片独立持久化并生成预览', async t => {
  const { directory, store } = await setup(t), board = store.read().boards[0]
  await assert.rejects(store.edit(board.id, 9, [{ type: 'rename', title: '错误覆盖' }]), error => error.status === 409)
  await assert.rejects(store.edit(board.id, 0, [{ type: 'rename', title: '不应写入' }, { type: 'nonsense' }]), /未知/)
  assert.equal(store.read().boards[0].title, board.title)
  const asset = await store.addImage(await png(), '参考图')
  assert.equal(asset.width, 8); assert.equal(asset.height, 6); assert.ok((await store.image(asset.id, true)).length > 0)
  const result = await store.edit(board.id, 0, [{ type: 'add', node: { id: 'img', type: 'image', assetId: asset.id } }])
  const restored = await createStore(directory)
  assert.equal(restored.read().boards[0].revision, result.board.revision)
  assert.deepEqual(restored.read().boards[0].nodes, result.board.nodes)
})

test('撤销断线和批量删除完整恢复卡片、连线及生成输入顺序，重做后仍可撤销', () => {
  const assets = { one: {}, two: {} }
  let board = newBoard('顺序')
  for (const node of [
    { id: 'a', type: 'text', text: '第一段' }, { id: 'b', type: 'text', text: '第二段' },
    { id: 'i1', type: 'image', assetId: 'one' }, { id: 'i2', type: 'image', assetId: 'two' },
    { id: 'g', type: 'generator' },
  ]) board = applyOperation(board, { type: 'add', node }, assets).board
  for (const from of ['a', 'i1', 'b', 'i2']) board = applyOperation(board, { type: 'connect', id: 'e-' + from, from, to: 'g' }, assets).board
  for (const operation of [{ type: 'disconnect', id: 'e-a' }, { type: 'disconnect', id: 'e-i1' }, { type: 'remove', ids: ['a', 'i1', 'i2'] }]) {
    const changed = applyOperation(board, operation, assets)
    const undone = applyOperation(changed.board, changed.inverse, assets)
    const redone = applyOperation(undone.board, undone.inverse, assets)
    const again = applyOperation(redone.board, redone.inverse, assets)
    for (const result of [undone, again]) {
      assert.deepEqual(result.board.nodes, board.nodes)
      assert.deepEqual(result.board.edges, board.edges)
      assert.deepEqual(generationInput(result.board, 'g'), generationInput(board, 'g'))
    }
  }
})

test('撤销和重做在服务端检查相关字段，冲突时整批操作不写入', async t => {
  const { store } = await setup(t), id = store.read().boards[0].id
  const edit = operations => store.edit(id, store.read().boards[0].revision, operations)
  await edit([{ type: 'add', node: { id: 'a', type: 'text', text: '原文' } }])
  const changed = await edit([{ type: 'update', id: 'a', patch: { text: '本页修改' } }])
  await edit([{ type: 'update', id: 'a', patch: { x: 999 } }])
  const undone = await edit(changed.inverse)
  assert.equal(undone.board.nodes[0].text, '原文', '不相关的坐标变化不应阻止撤销文字')
  assert.equal(undone.board.nodes[0].x, 999)
  await edit([{ type: 'update', id: 'a', patch: { text: '其他页面内容' } }])
  const before = store.read().boards[0]
  await assert.rejects(edit([{ type: 'rename', title: '不应写入' }, ...undone.inverse]), error => error.status === 409)
  assert.deepEqual(store.read().boards[0], before)
  await assert.rejects(edit(changed.inverse), error => error.status === 409)
  assert.deepEqual(store.read().boards[0], before)
  const added = await edit([{ type: 'add', node: { id: 'b', type: 'text' } }])
  await edit([{ type: 'update', id: 'b', patch: { text: '其他页面的新内容' } }])
  await assert.rejects(edit(added.inverse), error => error.status === 409)
})

test('首次设置图片服务经过 JSON 传输后可撤销、重做并继续撤销更早操作', async t => {
  const { directory, store } = await setup(t), id = store.read().boards[0].id
  const wire = value => JSON.parse(JSON.stringify(value))
  const edit = async operations => wire(await store.edit(id, store.read().boards[0].revision, wire(operations)))
  const added = await edit([{ type: 'add', node: { id: 'g', type: 'generator' } }])
  assert.equal(Object.hasOwn(added.board.nodes[0], 'provider'), false)
  const changed = await edit([{ type: 'update', id: 'g', patch: { provider: 'pixel', prompt: '更新提示词' } }])
  const undone = await edit(changed.inverse)
  assert.deepEqual(undone.board.nodes, added.board.nodes)
  assert.equal(Object.hasOwn((await createStore(directory)).read().boards[0].nodes[0], 'provider'), false)
  const redone = await edit(undone.inverse)
  assert.deepEqual(redone.board.nodes, changed.board.nodes)
  await edit(redone.inverse)
  assert.equal((await edit(added.inverse)).board.nodes.length, 0)
})

test('可选字段撤销仍检查冲突，删除只允许已声明且非必填的字段', () => {
  const wire = value => JSON.parse(JSON.stringify(value))
  const board = applyOperation(newBoard('旧卡片'), { type: 'add', node: { id: 'g', type: 'generator' } }, {}).board
  const changed = applyOperation(board, { type: 'update', id: 'g', patch: { provider: 'pixel' } }, {})
  const undo = wire(changed.inverse)
  const external = applyOperation(changed.board, { type: 'update', id: 'g', patch: { provider: 'another-provider' } }, {})
  assert.throws(() => applyOperation(external.board, undo, {}), error => error.status === 409)
  const moved = applyOperation(changed.board, { type: 'update', id: 'g', patch: { x: 555 } }, {})
  const undone = applyOperation(moved.board, undo, {})
  assert.equal(undone.board.nodes[0].x, 555)
  assert.equal(Object.hasOwn(undone.board.nodes[0], 'provider'), false)
  const reset = applyOperation(undone.board, { type: 'update', id: 'g', patch: { provider: '' } }, {})
  assert.throws(() => applyOperation(reset.board, wire(undone.inverse), {}), error => error.status === 409)
  for (const unset of [['id'], ['type'], ['unknown'], ['prompt'], ['x'], ['provider', 'provider'], 'provider']) {
    assert.throws(() => applyOperation(changed.board, { type: 'update', id: 'g', patch: {}, unset }, {}), error => error.status === 400)
  }
  assert.throws(() => applyOperation(changed.board, { type: 'update', id: 'g', patch: { provider: 'pixel' }, unset: ['provider'] }, {}), error => error.status === 400)
})

test('配置首次导入，之后独立保存；公开信息和任务不含 Key', async t => {
  const { directory } = await setup(t), configPath = join(directory, 'config.toml')
  await writeFile(configPath, '[skills.other.env]\nIGNORED="x"\n[skills.ai-pixel-image2.env]\nAI_PIXEL_API_KEY = "private-test-key"\nAI_PIXEL_API_BASE_URL = "https://ai-pixel.online"\nAI_PIXEL_IMAGE_MODEL = "gpt-image-2"\n[next]\nother="ignored"')
  const config = await createConfig(directory, { writeSnapshot, env: {}, configPath })
  assert.equal(config.private().apiKey, 'private-test-key')
  assert.equal(config.public().hasKey, true); assert.doesNotMatch(JSON.stringify(config.public()), /private-test-key/)
  await config.save({ apiKey: '', model: 'gpt-image-2' })
  assert.equal((await createConfig(directory, { writeSnapshot, env: {}, configPath: 'missing' })).private().apiKey, 'private-test-key')
})

test('Pixel 文生图走 JSON，参考图走 edits 的 image[]，比例与分辨率进入请求', async () => {
  const calls = [], image = await png(), dispatcher = { close: async () => {} }
  const pixel = createPixel({ dispatcher, request: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }), { status: 200 }) } })
  const input = { prompt: '测试', ratio: '16:9', resolution: '2k' }, config = { baseUrl: 'https://ai-pixel.online', apiKey: 'secret', model: 'gpt-image-2' }
  assert.deepEqual(await pixel.generate(input, config, [], new AbortController().signal), image)
  assert.match(calls[0].url, /images\/generations$/)
  assert.equal(JSON.parse(calls[0].options.body).size, '2048x1152')
  await pixel.generate(input, config, [image, image], new AbortController().signal)
  assert.match(calls[1].url, /images\/edits$/); assert.equal(calls[1].options.body.getAll('image[]').length, 2)
  assert.equal(calls[1].options.headers['Content-Type'], undefined)
  assert.equal(imageSize('1:1', '1k'), '1024x1024'); await pixel.close()
})

test('生成冻结输入、重复请求不重复生图、结果新增卡片；退出会中断任务', async t => {
  const { directory, store } = await setup(t), first = store.read().boards[0]
  let calls = 0, release
  const pixel = { close: async () => {}, generate: (input, config, images, signal) => {
    calls++; assert.equal(input.prompt, '原提示词'); assert.equal(config.apiKey, 'private')
    return new Promise((resolve, reject) => { release = () => png().then(resolve); signal.addEventListener('abort', () => reject(Error('已中断')), { once: true }) })
  } }
  const jobs = await createJobs(store, { private: () => ({ apiKey: 'private', model: 'gpt-image-2' }) }, pixel)
  t.after(() => jobs.close())
  const added = await store.edit(first.id, 0, [{ type: 'add', node: { id: 'g', type: 'generator', prompt: '原提示词' } }])
  const args = { requestId: randomUUID(), boardId: first.id, nodeId: 'g', revision: added.board.revision }
  const job = await jobs.start(args); await until(() => calls === 1)
  await jobs.start(args); assert.equal(calls, 1)
  await store.edit(first.id, added.board.revision, [{ type: 'update', id: 'g', patch: { prompt: '之后的修改' } }])
  release(); await until(() => store.read().jobs[0].status === 'succeeded')
  assert.equal(store.read().jobs[0].input.prompt, '原提示词')
  assert.equal(store.read().boards[0].nodes.filter(n => n.type === 'image').length, 1)
  assert.doesNotMatch(await readFile(join(directory, 'studio.json'), 'utf8'), /private/)
  let board = store.read().boards[0]
  board = (await store.edit(first.id, board.revision, [{ type: 'update', id: 'g', patch: { prompt: '原提示词' } }])).board
  await jobs.start({ ...args, requestId: randomUUID(), revision: board.revision }); await until(() => calls === 2)
  await jobs.close()
  assert.equal(store.read().jobs.at(-1).status, 'interrupted')
  assert.equal(store.read().jobs[0].id, job.id)
  assert.equal((await createStore(directory)).read().boards[0].nodes.length, 2)
})

test('大参考图只优化上传副本，multipart 图片总量受控且原图字节不变', async () => {
  const original = await sharp(randomBytes(1024 * 1024 * 3), { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer()
  const saved = Buffer.from(original)
  let calls = 0
  const pixel = createPixel({ dispatcher: { close: async () => {} }, request: async (url, options) => {
    calls++
    assert.match(url, /images\/edits$/)
    const files = options.body.getAll('image[]')
    assert.equal(files.length, 2)
    assert.ok(files.reduce((sum, file) => sum + file.size, 0) <= referenceUploadBudget)
    for (const file of files) {
      assert.equal(file.type, 'image/jpeg'); assert.match(file.name, /\.jpg$/)
      const meta = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
      assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, 1024)
    }
    return new Response(JSON.stringify({ data: [{ b64_json: (await png()).toString('base64') }] }))
  } })
  await pixel.generate({ prompt: '测试', ratio: '1:1', resolution: '1k' }, { baseUrl: 'https://example.com', apiKey: 'test', model: 'gpt-image-2' }, [original, original], new AbortController().signal)
  assert.equal(calls, 1); assert.deepEqual(original, saved)
  await pixel.close()
})

test('小参考图不转码，透明参考图优化后仍保留透明通道', async () => {
  const small = await png()
  assert.equal((await prepareReferences([small]))[0].bytes, small)
  const raw = randomBytes(256 * 256 * 4)
  for (let i = 3; i < raw.length; i += 4) raw[i] = 100
  const original = await sharp(raw, { raw: { width: 256, height: 256, channels: 4 } }).png().toBuffer()
  const [prepared] = await prepareReferences([original], { budget: 64 * 1024 })
  assert.ok(prepared.bytes.length <= 64 * 1024)
  assert.equal(prepared.type, 'image/png')
  assert.equal((await sharp(prepared.bytes).stats()).isOpaque, false)
})

test('网络失败保留底层错误码并区分参考图请求与结果下载，不泄漏凭证或自动重试', async () => {
  const config = { baseUrl: 'https://example.com', apiKey: 'private-test-key', model: 'gpt-image-2' }
  const input = { prompt: '测试', ratio: '1:1', resolution: '1k' }
  let calls = 0
  const cause = Object.assign(Error('private-test-key sensitive proxy detail'), { code: 'ECONNRESET' })
  const requestError = new TypeError('fetch failed', { cause })
  const pixel = createPixel({ dispatcher: { close: async () => {} }, request: async () => { calls++; throw requestError } })
  await assert.rejects(pixel.generate(input, config, [await png()], new AbortController().signal), error => {
    assert.match(error.message, /参考图生成请求失败.*ECONNRESET/)
    assert.doesNotMatch(error.message, /private-test-key|sensitive proxy detail/)
    return true
  })
  assert.equal(calls, 1)
  const download = createPixel({ dispatcher: { close: async () => {} }, request: async url => {
    if (String(url).endsWith('/generations')) return new Response(JSON.stringify({ data: [{ url: 'https://example.com/result.png' }] }))
    return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated', { cause: Object.assign(Error('closed'), { code: 'UND_ERR_SOCKET' }) })) } }))
  } })
  await assert.rejects(download.generate(input, config, [], new AbortController().signal), /下载生成图片失败.*UND_ERR_SOCKET/)
  await pixel.close(); await download.close()
})

test('聚合网络错误展示可诊断代码，HTTP 错误仍保留状态并隐藏 Key', async () => {
  const config = { baseUrl: 'https://example.com', apiKey: 'private-test-key', model: 'gpt-image-2' }, input = { prompt: '测试', ratio: '1:1', resolution: '1k' }
  const aggregate = new AggregateError([Object.assign(Error('timeout'), { code: 'ETIMEDOUT' }), Object.assign(Error('refused'), { code: 'ECONNREFUSED' })])
  const pixel = createPixel({ dispatcher: { close: async () => {} }, request: async () => { throw new TypeError('fetch failed', { cause: aggregate }) } })
  await assert.rejects(pixel.generate(input, config, [], new AbortController().signal), /文生图请求失败.*ETIMEDOUT.*ECONNREFUSED/)
  const http = createPixel({ dispatcher: { close: async () => {} }, request: async () => new Response(JSON.stringify({ error: { message: 'invalid private-test-key' } }), { status: 401 }) })
  await assert.rejects(http.generate(input, config, [], new AbortController().signal), error => {
    assert.match(error.message, /HTTP 401/); assert.doesNotMatch(error.message, /private-test-key/); return true
  })
  await pixel.close(); await http.close()
})

test('重启将排队和运行中的任务都标记中断，不自动重新扣费', async t => {
  const { directory, store } = await setup(t)
  await store.change(state => { state.jobs.push({ id: 'one', status: 'queued' }, { id: 'two', status: 'running' }) })
  const restored = await createStore(directory)
  const jobs = await createJobs(restored, { private: () => ({}) }, {})
  await jobs.close()
  assert.deepEqual(restored.read().jobs.map(j => j.status), ['interrupted', 'interrupted'])
})
