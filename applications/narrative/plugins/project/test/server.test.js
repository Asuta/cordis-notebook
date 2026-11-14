import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../../../../../server/server.js'
import { diagnose, validateProject } from '../model.js'

// The plugin runner builds first. These tests use actual runtime discovery and
// built plugin artifacts, never substitute routes or start a concurrent build.
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cordis-narrative-http-'))
  const options = { port: 0, dataDir: directory, locationRoot: directory, initialApplication: 'narrative' }
  let host
  t.after(async () => {
    try { await host?.close() } finally { await rm(directory, { recursive: true, force: true }) }
  })
  async function start() {
    host = await createHost(options)
    assert.equal(host.applications.current?.app.id, 'narrative', host.applications.error)
  }
  await start()
  const url = path => 'http://127.0.0.1:' + host.server.address().port + path
  async function request(path, method = 'GET', body, { raw = false, session = host.applications.session } = {}) {
    const response = await fetch(url(path), {
      method, headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Application-Session': session } : {}) },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    })
    return { status: response.status, result: await response.json() }
  }
  return {
    directory, request, url, session: () => host.applications.session,
    async restart() { await host.close(); host = null; await start() },
  }
}

test('真实宿主 HTTP：模板、并发修订、独立导入、私有设置隔离和重启持久化', { timeout: 60000 }, async t => {
  const f = await setup(t), { request } = f
  const listed = await request('/api/narrative/projects')
  assert.equal(listed.status, 200)
  assert.equal(listed.result.length, 1)
  const original = (await request('/api/narrative/projects/' + listed.result[0].id)).result
  validateProject(original); assert.deepEqual(diagnose(original), [])
  assert.equal(original.revision, 0)
  for (const template of ['hybrid', 'galgame', 'tavern']) {
    const created = await request('/api/narrative/projects', 'POST', { template, title: '  新建 ' + template + '  ' })
    assert.equal(created.status, 200)
    validateProject(created.result); assert.deepEqual(diagnose(created.result), [])
    assert.notEqual(created.result.id, original.id)
    assert.equal(created.result.title, '新建 ' + template)
    assert.equal(created.result.template, template)
    assert.equal(created.result.revision, 0)
  }
  for (const asset of original.assets) {
    const response = await fetch(f.url(asset.url), { headers: { 'X-Application-Session': f.session() } })
    assert.equal(response.status, 200, asset.url)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (asset.kind === 'audio') {
      assert.equal(response.headers.get('content-type'), 'audio/wav')
      assert.deepEqual([...bytes.slice(0, 4)], [82, 73, 70, 70])
      assert.deepEqual([...bytes.slice(8, 12)], [87, 65, 86, 69])
    } else {
      assert.equal(response.headers.get('content-type'), 'image/png')
      assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
    }
  }

  const secret = 'narrative-test-private-key-never-export'
  const configured = await request('/api/narrative/ai/settings', 'PUT', {
    protocol: 'responses', baseUrl: 'https://provider.example.test/v1', model: 'test-model', apiKey: secret,
  })
  assert.equal(configured.status, 200)
  assert.equal(configured.result.hasApiKey, true)
  assert.equal(Object.hasOwn(configured.result, 'apiKey'), false)
  assert.equal(JSON.stringify(configured.result).includes(secret), false)

  const modified = structuredClone(original)
  modified.assets.push({ id: 'custom-image', name: '内嵌图片', kind: 'image', url: 'data:image/png;base64,iVBORw0KGgo=' })
  const contenders = ['页面 A 的修改', '页面 B 的修改'].map(description => ({ ...structuredClone(modified), description }))
  const responses = await Promise.all(contenders.map(value => request('/api/narrative/projects/' + original.id, 'PUT', value)))
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409], '相同修订的竞争写入必须只成功一次')
  const saved = responses.find(response => response.status === 200).result
  assert.equal(saved.revision, 1)
  assert.ok(contenders.some(value => value.description === saved.description))
  assert.deepEqual((await request('/api/narrative/projects/' + original.id)).result, saved)
  assert.equal((await request('/api/narrative/projects/' + original.id, 'PUT', modified)).status, 409)
  assert.equal((await request('/api/narrative/projects/' + original.id, 'PUT', { ...saved, id: 'another-project' })).status, 409)

  const imported = await request('/api/narrative/import', 'POST', saved)
  assert.equal(imported.status, 200)
  assert.notEqual(imported.result.id, saved.id)
  assert.equal(imported.result.revision, 0)
  assert.deepEqual({ ...imported.result, id: saved.id, revision: saved.revision }, saved)
  const changedImport = await request('/api/narrative/projects/' + imported.result.id, 'PUT', { ...imported.result, title: '独立导入的作品' })
  assert.equal(changedImport.status, 200)
  assert.equal((await request('/api/narrative/projects/' + original.id)).result.title, original.title)
  const all = (await request('/api/narrative/projects')).result
  assert.equal(all.length, 5)
  assert.equal(new Set(all.map(value => value.id)).size, all.length)
  assert.equal(all.find(value => value.id === original.id).revision, 1)

  const projectDir = join(f.directory, 'apps/narrative/plugin-data/project')
  const persisted = JSON.parse(await readFile(join(projectDir, 'projects', original.id + '.json'), 'utf8'))
  assert.deepEqual(persisted, saved)
  const privateSettings = JSON.parse(await readFile(join(f.directory, 'apps/narrative/plugin-data/ai-dialogue/settings-private.json'), 'utf8'))
  assert.equal(privateSettings.apiKey, secret)
  for (const file of await readdir(join(projectDir, 'projects'))) {
    assert.equal((await readFile(join(projectDir, 'projects', file), 'utf8')).includes(secret), false, '作品 JSON 不能包含连接密钥')
  }
  assert.equal((await readFile(join(projectDir, 'index.json'), 'utf8')).includes(secret), false)
  for (const path of ['/api/plugins', '/api/narrative/ai/settings', '/api/narrative/projects', '/api/narrative/projects/' + saved.id]) {
    const response = await request(path)
    assert.equal(response.status, 200)
    assert.equal(JSON.stringify(response.result).includes(secret), false, path)
  }
  for (const path of [
    '/builtin/project/assets/unknown.png', '/builtin/project/server.js', '/builtin/project/model.js',
    '/builtin/ai-dialogue/settings-private.json', '/builtin/project/projects/' + saved.id + '.json',
    '/apps/narrative/plugin-data/ai-dialogue/settings-private.json',
  ]) assert.equal((await request(path)).status, 404, path)

  await f.restart()
  assert.deepEqual((await request('/api/narrative/projects/' + original.id)).result, saved)
  assert.deepEqual((await request('/api/narrative/projects/' + imported.result.id)).result, changedImport.result)
  assert.equal((await request('/api/narrative/projects')).result.length, 5)
  const restoredSettings = (await request('/api/narrative/ai/settings')).result
  assert.equal(restoredSettings.hasApiKey, true)
  assert.equal(restoredSettings.protocol, 'responses')
  assert.equal(JSON.stringify(restoredSettings).includes(secret), false)
})

test('真实宿主 HTTP：拒绝坏 JSON、无效模板及导入，失败后作品和写入队列可继续使用', { timeout: 60000 }, async t => {
  const { request } = await setup(t)
  const initial = (await request('/api/narrative/projects')).result
  const original = (await request('/api/narrative/projects/' + initial[0].id)).result
  assert.equal((await request('/api/narrative/import', 'POST', '{damaged', { raw: true })).status, 400)
  for (const input of [{ template: 'unknown' }, { template: 'hybrid', title: '  ' }, { template: 'hybrid', title: 'A'.repeat(121) }]) {
    assert.equal((await request('/api/narrative/projects', 'POST', input)).status, 400)
  }
  for (const input of [null, { ...original, id: '../outside' }, { ...original, nodes: [] }, { ...original, assets: [...original.assets, { id: 'unsafe', name: '恶意素材', kind: 'image', url: 'javascript:alert(1)' }] }]) {
    assert.equal((await request('/api/narrative/import', 'POST', input)).status, 400)
  }
  const invalid = structuredClone(original); invalid.nodes[0].stage.scale = 0
  assert.equal((await request('/api/narrative/projects/' + original.id, 'PUT', invalid)).status, 400)
  assert.equal((await request('/api/narrative/projects/missing')).status, 404)
  assert.equal((await request('/api/narrative/projects/missing', 'PUT', original)).status, 404)
  assert.equal((await request('/api/narrative/projects', 'POST', { template: 'hybrid' }, { session: null })).status, 409)
  assert.deepEqual((await request('/api/narrative/projects')).result, initial)
  assert.deepEqual((await request('/api/narrative/projects/' + original.id)).result, original)
  const valid = await request('/api/narrative/projects/' + original.id, 'PUT', { ...original, title: '失败后仍可保存' })
  assert.equal(valid.status, 200)
  assert.equal(valid.result.revision, 1)
})

test('真实宿主 HTTP：并发创建在作品上限处串行检查，满额导入不会覆盖原作品', { timeout: 60000 }, async t => {
  const { request } = await setup(t)
  const initial = (await request('/api/narrative/projects')).result
  const original = (await request('/api/narrative/projects/' + initial[0].id)).result
  const creates = await Promise.all(Array.from({ length: 51 }, (_, index) => request('/api/narrative/projects', 'POST', { template: 'tavern', title: '并发作品 ' + index })))
  assert.equal(creates.filter(response => response.status === 200).length, 49)
  assert.equal(creates.filter(response => response.status === 400).length, 2)
  const imported = await request('/api/narrative/import', 'POST', original)
  assert.equal(imported.status, 400); assert.match(imported.result.error, /50/)
  assert.equal((await request('/api/narrative/projects')).result.length, 50)
  assert.deepEqual((await request('/api/narrative/projects/' + original.id)).result, original)
})
