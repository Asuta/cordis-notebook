import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../server/server.js'
import { packageBytes, importPackage } from '../applications/novel/plugins/game/package.js'
import { unpackAvatar } from '../applications/novel/plugins/game/mesh-avatar/compiled/runtime.js'

test('原生 Miko：编辑保存与版本冲突、旧快照、完整工程及许可随作品包往返', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-mesh-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const app = await createHost({ port: 0, dataDir: dir, locationRoot: dir, initialApplication: 'novel' }); t.after(() => app.close())
  const base = 'http://127.0.0.1:' + app.server.address().port
  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }
  const response = async (path, method = 'GET', body, extra = {}) => {
    const r = await fetch(base + path, { method, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: r.status, headers: r.headers, data: await r.json() }
  }
  const request = async (path, method, body) => { const r = await response(path, method, body); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data }
  const p = await request('/api/novel/miko-demo', 'POST'), summary = p.models[0], path = '/api/novel/projects/' + p.id
  assert.equal(summary.engine, 'mesh-avatar'); assert.equal(p.cast[0].modelId, summary.id)
  const model = await request(path + '/models/' + summary.id)
  assert.equal(model.rig.parameters.find(p => p.id === 'angleX').max, 30)
  assert.ok(p.scenes[0].commands.some(c => c.type === 'model' && c.parameters.angleX === -28))
  const studio = path + '/mesh-studio/__studio/projects/' + summary.editorProject
  const native = await response(studio + '/rig.json'); assert.equal(native.status, 200); assert.equal(native.headers.get('X-Mesh-Revision'), '1')
  const modified = structuredClone(native.data); modified.head.shiftX += 2
  const saved = await response(studio + '/rig', 'POST', modified, { 'X-Mesh-Revision': '1' })
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.headers.get('X-Mesh-Revision'), '2')
  const conflict = await response(studio + '/rig', 'POST', native.data, { 'X-Mesh-Revision': '1' }); assert.equal(conflict.status, 409)
  const latest = await request(path + '/models/' + summary.id)
  assert.equal(latest.nativeRig.head.shiftX, modified.head.shiftX)
  assert.equal((await request(path + '/models/' + summary.id + '?revision=1')).nativeRig.head.shiftX, native.data.head.shiftX)
  const read = async url => { const r = await fetch(base + url, { headers }); assert.equal(r.status, 200, url); return new Uint8Array(await r.arrayBuffer()) }
  const oldFiles = unpackAvatar(await read(path + '/models/' + summary.id + '/archive.mavatar?revision=1'))
  assert.ok(oldFiles['MIKO_ASSET_TERMS.md']); assert.ok(oldFiles['variants/eyes_closed.png']); assert.ok(oldFiles['built/sprites/mouth_a.png'])
  const current = await request(path), bytes = await packageBytes(current, read)
  const imported = await importPackage(new File([bytes], 'Miko.novel.zip'), request)
  assert.notEqual(imported.models[0].id, summary.id); assert.equal(imported.models[0].engine, 'mesh-avatar')
  const copyPath = '/api/novel/projects/' + imported.id, copy = await request(copyPath + '/models/' + imported.models[0].id)
  assert.equal(copy.nativeRig.head.shiftX, modified.head.shiftX); assert.equal(copy.manifest.author, model.manifest.author)
  const copyFiles = unpackAvatar(await read(copyPath + '/models/' + copy.id + '/archive.mavatar?revision=1'))
  assert.deepEqual(copyFiles['MIKO_ASSET_TERMS.md'], oldFiles['MIKO_ASSET_TERMS.md'])
  assert.deepEqual(copyFiles['variants/eyes_closed.png'], oldFiles['variants/eyes_closed.png'])
  assert.equal((await response(copyPath + '/models/' + copy.id, 'PUT', { expectedRevision: 1, model: copy })).status, 400)
  assert.equal((await response(copyPath + '/mesh-avatars/adopt', 'POST', { editorProject: '../other' })).status, 400)
  const html = await fetch(base + path + '/mesh-studio/editor.html?project=' + summary.editorProject)
  assert.equal(html.status, 200); assert.match(await html.text(), /studio\.js/)
  const projects = await request(path + '/mesh-studio/__studio/projects')
  assert.ok(projects.some(p => p.name === summary.editorProject && p.relativePath.startsWith('projects/')))
  const optional = await fetch(base + path + '/mesh-studio/miko-qipao/built/overlays/overlays.json')
  assert.equal(optional.status, 404, '官方角色没有可选叠加层时正常返回 404')
})

test('汐音：新站姿的独立绑定、眼嘴分层与完整作品包往返', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-shion-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const app = await createHost({ port: 0, dataDir: dir, locationRoot: dir, initialApplication: 'novel' }); t.after(() => app.close())
  const base = 'http://127.0.0.1:' + app.server.address().port
  const headers = { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }
  const request = async (path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data
  }
  const read = async url => { const r = await fetch(base + url, { headers }); assert.equal(r.status, 200, url); return new Uint8Array(await r.arrayBuffer()) }
  const p = await request('/api/novel/shion-demo', 'POST'), summary = p.models[0]
  assert.equal(p.title, '月下听潮 · 汐音')
  assert.equal(p.cast[0].modelId, summary.id)
  assert.equal(p.scenes.filter(s => s.ending).length, 2)
  const path = '/api/novel/projects/' + p.id, model = await request(path + '/models/' + summary.id)
  assert.deepEqual(model.nativeRig.image, { width: 1024, height: 1536 })
  assert.equal(model.nativeRig.hand, undefined, '自然垂臂不带入 Miko 托脸绑定')
  assert.ok(model.nativeRig.arms.left.wrist[1] > model.nativeRig.arms.left.elbow[1])
  assert.ok(model.nativeRig.strands.some(s => s.name === 'ribbon'))
  const files = unpackAvatar(await read(path + '/models/' + summary.id + '/archive.mavatar'))
  for (const name of ['avatar.json', 'source.png', 'rig.json', 'built/base.png', 'built/hairmask.png', 'built/sprites/eyes_closed_0.png', 'built/sprites/eyes_half_1.png', 'built/sprites/eyes_smile_0.png', 'built/sprites/mouth_a.png', 'built/sprites/mouth_o.png', 'variants/eyes_closed.png']) assert.ok(files[name]?.length, name)
  const bytes = await packageBytes(p, read), copy = await importPackage(new File([bytes], 'Shion.novel.zip'), request)
  assert.notEqual(copy.models[0].id, model.id)
  assert.equal(copy.cast[0].modelId, copy.models[0].id)
  const copyPath = '/api/novel/projects/' + copy.id
  const copyFiles = unpackAvatar(await read(copyPath + '/models/' + copy.models[0].id + '/archive.mavatar'))
  for (const name of ['source.png', 'rig.json', 'variants/eyes_closed.png', 'built/sprites/mouth_a.png']) assert.deepEqual(copyFiles[name], files[name], name)
})
