import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHost } from '../server/server.js'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../applications/studio/plugins/canvas/package.json', import.meta.url))
const sharp = require('sharp')

test('灵感画布 HTTP：上传/导入/预览、真实请求协议、结果持久化、切换时中断', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-studio-runtime-'))
  const png = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#557744' } }).png().toBuffer()
  let hang = false, calls = 0
  const upstream = createServer(async (req, res) => {
    calls++
    assert.equal(req.headers.authorization, 'Bearer fake-key')
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    assert.equal(req.url, '/v1/images/edits'); assert.match(req.headers['content-type'], /multipart\/form-data/)
    assert.match(Buffer.concat(chunks).toString(), /name="image\[\]"/)
    if (hang) return
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  let app
  try {
    const dataDir = join(dir, 'apps/studio/plugin-data/canvas'); await mkdir(dataDir, { recursive: true })
    await writeFile(join(dataDir, 'pixel-private.json'), JSON.stringify({ baseUrl: `http://127.0.0.1:${upstream.address().port}`, model: 'gpt-image-2', apiKey: 'fake-key' }))
    app = await createHost({ port: 0, dataDir: dir, initialApplication: 'studio' })
    const request = async (path, input) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/studio${path}`, { method: input === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) })
      assert.equal(response.status, 200, await response.clone().text()); return response.json()
    }
    const state = await request(''); assert.equal(state.config.baseUrl, `http://127.0.0.1:${upstream.address().port}`, '必须使用本地模拟服务，禁止回落到真实配置')
    assert.equal(state.config.hasKey, true); assert.doesNotMatch(JSON.stringify(state), /fake-key/)
    const asset = await request('/upload', { name: '参考图', base64: png.toString('base64') })
    const localPath = join(dir, 'reference.png'); await writeFile(localPath, png)
    const imported = await request('/import', { path: localPath }); assert.equal(imported.width, 10)
    const image = await request('/inspect/' + asset.id); assert.equal(image.image.mimeType, 'image/webp')
    const result = await request('/edit', { boardId: state.boards[0].id, revision: 0, operations: [
      { type: 'add', node: { id: 'image', type: 'image', assetId: asset.id } },
      { type: 'add', node: { id: 'generator', type: 'generator', prompt: '改背景', x: 350 } },
      { type: 'connect', id: 'edge', from: 'image', to: 'generator' },
    ] })
    const input = { requestId: randomUUID(), boardId: result.board.id, nodeId: 'generator', revision: result.board.revision }
    await request('/generate', input)
    let saved
    for (let i = 0; i < 100; i++) { saved = await request(''); if (saved.jobs[0].status === 'succeeded') break; await new Promise(resolve => setTimeout(resolve, 30)) }
    assert.equal(saved.jobs[0].status, 'succeeded', saved.jobs[0].error); assert.equal(saved.boards[0].nodes.length, 3)
    await request('/generate', input); assert.equal(calls, 1)
    hang = true
    await request('/generate', { ...input, requestId: randomUUID(), revision: saved.boards[0].revision })
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(calls, 2)
    const start = Date.now(); await app.applications.switch(null, app.applications.session)
    assert.ok(Date.now() - start < 5000, '切换不能等待长时间生图请求')
    await app.applications.switch('studio', app.applications.session)
    saved = await request(''); assert.equal(saved.jobs.at(-1).status, 'interrupted'); assert.equal(saved.boards[0].nodes.length, 3)
  } finally { await app?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); await rm(dir, { recursive: true, force: true }) }
})
