import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHost } from '../server/server.js'
import { videoMetadata } from '../applications/studio/plugins/canvas/video.js'
import { createStore } from './helpers/studio-fixture.js'
import { createWaveMock, videoFixture, until } from './helpers/studio-wavespeed.js'

test('真实 MP4/WebM 元数据、文件校验及旧图片兼容，视频独立落盘', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-video-')); t.after(() => rm(dir, { recursive: true, force: true }))
  for (const extension of ['mp4', 'webm']) {
    const bytes = await videoFixture(extension), meta = videoMetadata(bytes)
    assert.equal(meta.width, 64); assert.equal(meta.height, 48); assert.ok(Math.abs(meta.duration - 3) < 0.1)
    assert.equal(meta.extension, extension)
    const store = await createStore(dir), asset = await store.addVideo(bytes, '测试视频')
    assert.equal(asset.kind, 'video'); assert.deepEqual(await store.media(asset.id), bytes)
    const reopened = await createStore(dir)
    assert.deepEqual(reopened.read().assets[asset.id], asset)
    await assert.rejects(reopened.image(asset.id), /图片不存在/)
  }
  for (const bytes of [Buffer.from('not a video'), (await videoFixture('mp4')).subarray(0, 200), (await videoFixture('webm')).subarray(0, 100)]) assert.throws(() => videoMetadata(bytes), /视频|容器/)
})

test('完整 WaveSpeed HTTP：目录、分块视频、混合参考、结果卡片、Range、刷新和重启仅查询原任务', { timeout: 25000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-wave-http-')), mock = await createWaveMock()
  let app, lastState
  try {
    for (const [provider, file, value] of [
      ['image-provider-wavespeed', 'wavespeed-private.json', mock.config],
      ['image-provider-pixel', 'pixel-private.json', { baseUrl: mock.origin, apiKey: 'mock-key', model: 'mock' }],
    ]) {
      const path = join(dir, 'apps/studio/plugin-data', provider); await mkdir(path, { recursive: true }); await writeFile(join(path, file), JSON.stringify(value))
    }
    app = await createHost({ port: 0, dataDir: dir, initialApplication: 'studio' })
    const origin = () => 'http://127.0.0.1:' + app.server.address().port
    const raw = (path, body, headers = {}) => fetch(origin() + '/api/studio' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const request = async (path, body) => { const response = await raw(path, body); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const edit = async operations => { const state = await request(''); return request('/edit', { boardId: state.boards[0].id, revision: state.boards[0].revision, operations }) }
    const state = await request(''), provider = state.providers.find(p => p.id === 'wavespeed')
    assert.equal(provider.baseUrl, mock.origin); assert.equal(provider.hasKey, true)
    assert.doesNotMatch(JSON.stringify(state), /mock-key/)
    const catalog = await request('/providers/wavespeed/models?kind=video&limit=1')
    assert.equal(catalog.total, 2); assert.equal(catalog.items.length, 1); assert.equal(catalog.catalogTotal, 5)
    const model = await request('/providers/wavespeed/model?id=mock%2Fvideo')
    assert.deepEqual(model.mediaFields.map(f => f.label), ['首帧', '尾帧'])
    assert.equal((await request('/providers/wavespeed/model?id=mock%2Fvideo-edit')).outputKind, 'video')
    const upload = await request('/media/uploads', { name: '本机视频', size: mock.mp4.length })
    assert.equal((await raw('/media/uploads/' + upload.id, { offset: 2, base64: mock.mp4.toString('base64') })).status, 400)
    assert.equal((await raw('/media/uploads/' + upload.id + '/finish', {})).status, 400)
    for (const offset of [0, 1024, 2048]) await request('/media/uploads/' + upload.id, { offset, base64: mock.mp4.subarray(offset, offset + 1024).toString('base64') })
    const video = await request('/media/uploads/' + upload.id + '/finish', {})
    assert.equal(video.kind, 'video'); assert.equal(video.width, 64)
    assert.equal((await raw('/media/uploads/' + upload.id + '/finish', {})).status, 400)
    const videoPath = join(dir, 'input.webm'); await writeFile(videoPath, await videoFixture('webm'))
    const imported = await request('/import', { path: videoPath }); assert.equal(imported.mimeType, 'video/webm')
    const path = '/videos/' + video.id
    const range = await raw(path, undefined, { Range: 'bytes=0-63' })
    assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 0-63/' + mock.mp4.length)
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), mock.mp4.subarray(0, 64))
    const suffix = await raw(path, undefined, { Range: 'bytes=-20' }); assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), mock.mp4.subarray(-20))
    assert.equal((await raw(path, undefined, { Range: 'bytes=999999-' })).status, 416)
    const head = await fetch(origin() + '/api/studio' + path, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-type'), 'video/mp4'); assert.equal((await head.arrayBuffer()).byteLength, 0)
    const [a, b] = await Promise.all(['卡片内图片', '连线图片'].map(name => request('/upload', { name, base64: mock.png.toString('base64') })))
    await edit([
      { type: 'add', node: { id: 'image', type: 'image', assetId: b.id } },
      { type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', prompt: '生成三秒视频', modelParameters: { 'wavespeed:mock/video': { duration: 3 } }, references: [{ id: 'inside', assetId: a.id }], referenceOrder: ['edge:connected', 'direct:inside'], referenceBindings: { 'wavespeed:mock/video': { 'edge:connected': '/start_image', 'direct:inside': '/end_image' } } } },
      { type: 'connect', id: 'connected', from: 'image', to: 'g' },
    ])
    const stateFile = join(dir, 'apps/studio/plugin-data/canvas/studio.json')
    mock.state.onPrediction = async id => { const persisted = JSON.parse(await readFile(stateFile, 'utf8')); assert.ok(persisted.jobs.some(j => j.remote?.taskId === id)) }
    let current = await request(''), requestId = randomUUID()
    const generate = () => request('/generate', { requestId, boardId: current.boards[0].id, revision: current.boards[0].revision, nodeId: 'g' })
    await generate()
    await until(async () => { lastState = await request(''); return lastState.jobs[0].status === 'succeeded' }, '视频生成未完成')
    await generate()
    const job = lastState.jobs[0], result = lastState.boards[0].nodes.find(n => n.jobId === job.id)
    assert.equal(result.type, 'video'); assert.equal(lastState.assets[result.assetId].kind, 'video')
    assert.equal(job.input.parameters.duration, 3); assert.deepEqual(job.input.assetIds, [b.id, a.id])
    assert.doesNotMatch(JSON.stringify(job), /signature=|mock-key|\/media\//)
    assert.equal(mock.requests.filter(r => r.method === 'POST' && r.url === '/api/v3/mock/video').length, 1)
    assert.deepEqual(Buffer.from(await (await raw('/videos/' + result.assetId)).arrayBuffer()), mock.mp4)
    const body = mock.requests.find(r => r.body).body
    assert.equal(body.start_image, mock.origin + '/media/1'); assert.equal(body.end_image, mock.origin + '/media/2')
    // Feed an actual local video into a second generation, pause on exit, then recover.
    await edit([{ type: 'update', id: 'g', patch: { model: 'mock/video-edit', references: [{ id: 'clip', assetId: video.id }] } }, { type: 'disconnect', id: 'connected' }])
    mock.state.complete = false; current = await request(''); requestId = randomUUID(); await generate()
    await until(async () => { const next = await request(''); return next.jobs[1].remote?.taskId && next.jobs[1].status === 'running' })
    const secondId = (await request('')).jobs[1].remote.taskId
    await app.close(); app = undefined
    mock.state.complete = true
    app = await createHost({ port: 0, dataDir: dir, initialApplication: 'studio' })
    await until(async () => { lastState = await request(''); return lastState.jobs[1].status === 'succeeded' })
    assert.equal(lastState.jobs[1].remote.taskId, secondId)
    assert.equal(mock.requests.filter(r => r.method === 'POST' && r.url.startsWith('/api/v3/mock/')).length, 2)
    assert.equal(lastState.boards[0].nodes.filter(n => n.jobId).length, 2)
    assert.deepEqual(mock.uploads.get('3').bytes, mock.mp4)
    assert.deepEqual(mock.errors, [])
  } finally { await app?.close(); await mock.close(); await rm(dir, { recursive: true, force: true }) }
})
