import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { createHost } from '../server/server.js'
import { validateProject, diagnose, passes, followChoice } from '../applications/novel/plugins/game/model.js'
import { importPackage } from '../applications/novel/plugins/game/package.js'
const { zipSync, strToU8 } = createRequire(new URL('../applications/novel/plugins/game/package.json', import.meta.url))('fflate')

test('视觉小说条件选项与好感度效果', () => {
  const choice = { condition: { variableId: 'trust', op: 'gte', value: 2 }, effects: [{ variableId: 'trust', op: 'add', value: 1 }] }
  assert.equal(passes(choice.condition, { trust: 1 }), false)
  assert.equal(passes(choice.condition, { trust: 2 }), true)
  assert.deepEqual(followChoice(choice, { trust: 2 }, [{ id: 'trust', kind: 'affinity' }]), { trust: 3 })
  assert.throws(() => followChoice(choice, { trust: 1 }, [{ id: 'trust', kind: 'affinity' }]))
})

test('视觉小说 HTTP：示例、持久化、版本冲突、素材与作品包往返', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-novel-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let app = await createHost({ port: 0, dataDir: dir, locationRoot: dir, initialApplication: 'novel' })
  const request = async (path, method = 'GET', data) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + path, { method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) })
    const result = await response.json().catch(() => null)
    return { status: response.status, result }
  }
  try {
    assert.equal(app.applications.current.app.id, 'novel')
    let listed = await request('/api/novel/projects')
    assert.equal(listed.status, 200); assert.equal(listed.result.length, 1)
    const original = (await request('/api/novel/projects/rain-afterglow')).result
    validateProject(original); assert.deepEqual(diagnose(original), [])
    assert.equal(original.scenes.filter(s => s.ending).length, 3)
    const endings = new Set()
    function explore(id, values, depth = 0) {
      assert.ok(depth < 20, '示例剧情应能走到结局')
      const scene = original.scenes.find(s => s.id === id)
      if (scene.ending) { endings.add(id); return }
      const choices = scene.choices.filter(c => passes(c.condition, values))
      assert.ok(choices.length, '每条路径都有可用选项')
      for (const choice of choices) explore(choice.targetId, followChoice(choice, values, original.variables), depth + 1)
    }
    explore(original.startSceneId, Object.fromEntries(original.variables.map(v => [v.id, v.initial])))
    assert.deepEqual([...endings].sort(), ['ending-lin', 'ending-open', 'ending-yao'])
    const media = {}
    for (const asset of original.assets) {
      const response = await fetch('http://127.0.0.1:' + app.server.address().port + '/api/novel/projects/' + original.id + '/assets/' + asset.id)
      assert.equal(response.status, 200)
      media['media/' + asset.id] = new Uint8Array(await response.arrayBuffer())
      assert.equal(media['media/' + asset.id].length, asset.size)
    }
    const modified = structuredClone(original); modified.scenes[0].title = '雨后车站 · 已修改'
    const saved = await request('/api/novel/projects/' + original.id, 'PUT', modified)
    assert.equal(saved.status, 200); assert.equal(saved.result.revision, 1)
    assert.equal((await request('/api/novel/projects/' + original.id, 'PUT', modified)).status, 409)
    const packageBytes = zipSync({ 'project.json': strToU8(JSON.stringify(saved.result)), ...media }, { level: 0 })
    const packageRequest = async (path, method = 'GET', data) => {
      const response = await request(path, method, data)
      if (response.status !== 200) throw Error(JSON.stringify(response))
      return response.result
    }
    const imported = await importPackage(new File([packageBytes], 'story.novel.zip', { type: 'application/zip' }), packageRequest)
    assert.notEqual(imported.id, original.id)
    assert.equal(imported.scenes[0].title, '雨后车站 · 已修改')
    assert.equal(imported.assets.length, original.assets.length)
    assert.deepEqual(diagnose(imported), [])
    assert.equal((await request('/api/novel/projects')).result.length, 2)
    const damaged = zipSync({ 'project.json': strToU8(JSON.stringify(saved.result)), ...media, 'media/lin': new Uint8Array(media['media/lin'].length) }, { level: 0 })
    await assert.rejects(importPackage(new File([damaged], 'damaged.novel.zip'), packageRequest), /素材格式或内容无效/)
    assert.equal((await request('/api/novel/projects')).result.length, 2, '失败的导入应回滚已上传的素材和作品')
    await app.close()
    app = await createHost({ port: 0, dataDir: dir, locationRoot: dir, initialApplication: 'novel' })
    const persisted = await request('/api/novel/projects/' + imported.id)
    assert.equal(persisted.result.scenes[0].title, '雨后车站 · 已修改')
  } finally { await app.close() }
})
