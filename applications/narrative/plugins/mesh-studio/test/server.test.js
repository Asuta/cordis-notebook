import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../../../../../server/server.js'
import { unpackAvatar } from '../compiled/runtime.js'

test('真实宿主：完整编辑器、原生绑定保存、冲突保护、资源包迁移与停用恢复', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'narrative-mesh-'))
  let host = await createHost({ port: 0, dataDir: directory, locationRoot: directory, initialApplication: 'narrative' })
  t.after(async () => { await host?.close(); await rm(directory, { recursive: true, force: true }) })
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch('http://127.0.0.1:' + host.server.address().port + path, { method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': host.applications.session, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : new Uint8Array(await response.arrayBuffer())
    return { status: response.status, headers: response.headers, result }
  }
  const base = '/api/narrative/mesh/projects/test-story'
  const opened = await request(base + '/open', 'POST', {})
  assert.equal(opened.status, 200, JSON.stringify(opened.result))
  const { editorProject, model } = opened.result
  assert.match(model.archiveId, /^[a-f0-9]{64}$/); assert.ok(model.size > 1000)
  const html = await request(base + '/studio/editor.html')
  assert.equal(html.status, 200); assert.match(new TextDecoder().decode(html.result), /studio.js/)
  assert.equal((await request(base + '/studio/studio.js')).status, 200)
  assert.equal((await request(base + '/studio/miko-qipao/built/overlays/overlays.json')).status, 404)
  const rigPath = base + '/studio/__studio/projects/' + editorProject + '/rig.json'
  const original = await request(rigPath)
  assert.equal(original.status, 200); assert.equal(original.headers.get('x-mesh-revision'), '0')
  const next = structuredClone(original.result); next.head.shiftX += 2
  const mutationPath = rigPath.replace(/rig\.json$/, 'rig')
  assert.equal((await request(mutationPath, 'POST', next)).status, 409)
  assert.equal((await request(mutationPath, 'POST', next, { 'X-Mesh-Revision': '0' })).status, 200)
  assert.equal((await request(mutationPath, 'POST', original.result, { 'X-Mesh-Revision': '0' })).status, 409)
  const published = await request(base + '/publish', 'POST', { editorProject })
  assert.equal(published.status, 200); assert.notEqual(published.result.archiveId, model.archiveId)
  const archivePath = '/api/narrative/mesh/archives/' + published.result.archiveId
  const archive = await request(archivePath + '.mavatar')
  const files = unpackAvatar(archive.result)
  assert.equal(JSON.parse(new TextDecoder().decode(files['rig.json'])).head.shiftX, next.head.shiftX)
  assert.ok(files['source.png']); assert.ok(files['MIKO_ASSET_TERMS.md']); assert.ok(files['built/base.png']); assert.ok(files['variants/eyes_closed.png'], '保留可用于重新构建的完整差分原图')
  const nativeExport = await request(base + '/studio/__studio/export', 'POST', { project: editorProject, includeSource: true })
  assert.equal(nativeExport.status, 200); assert.ok(unpackAvatar(nativeExport.result)['variants/eyes_closed.png'])
  const old = unpackAvatar((await request('/api/narrative/mesh/archives/' + model.archiveId + '.mavatar')).result)
  assert.equal(JSON.parse(new TextDecoder().decode(old['rig.json'])).head.shiftX, original.result.head.shiftX, '旧作品和存档使用的资源保持不变')
  const exported = await request(archivePath + '/export')
  assert.equal((await request('/api/narrative/mesh/archives', 'POST', exported.result)).result.archiveId, published.result.archiveId)
  assert.equal((await request('/api/narrative/mesh/archives', 'POST', { base64: 'AAAA' })).status, 400)
  const importedNative = await request(base + '/studio/__studio/import', 'POST', exported.result)
  assert.equal(importedNative.status, 200, JSON.stringify(importedNative.result))
  const reopened = await request('/api/narrative/mesh/projects/another-story/open', 'POST', { archiveId: published.result.archiveId })
  assert.equal(reopened.status, 200)
  const independent = await request('/api/narrative/mesh/projects/another-story/studio/__studio/projects/' + reopened.result.editorProject + '/rig.json')
  assert.equal(independent.result.head.shiftX, next.head.shiftX)
  assert.equal((await request(base + '/open', 'POST', {}, { 'X-Application-Session': 'stale' })).status, 409)
  await host.manager.toggle('mesh-studio', false)
  assert.equal((await request(archivePath + '.mavatar')).status, 404)
  await host.manager.toggle('mesh-studio', true)
  assert.equal((await request(archivePath + '.mavatar')).status, 200)
  await host.close()
  host = await createHost({ port: 0, dataDir: directory, locationRoot: directory, initialApplication: 'narrative' })
  assert.equal((await request(archivePath + '.mavatar')).status, 200)
})
