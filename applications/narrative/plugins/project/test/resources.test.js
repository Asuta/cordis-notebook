import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setup, owner } from './helpers.js'

test('资源插件在试玩、切换和导出前保存；导入资源先恢复且不进入作品草稿', async t => {
  const f = await setup(t), plugin = owner(), calls = []
  t.after(() => plugin.dispose())
  const resource = {
    id: 'test-resource',
    prepare(project) { calls.push('prepare:' + project.id); project.description = '角色已保存' },
    async export(project) { calls.push('export:' + project.id); return { bytes: 'some-archive' } },
    async import(project, bundle) { calls.push('import:' + bundle.bytes); project.description = '导入的角色工程' },
  }
  f.engine.registerResources(plugin, resource)
  const bundle = await f.engine.exportBundle()
  assert.equal(f.engine.project.description, '角色已保存')
  assert.deepEqual(bundle.resourceBundles, { 'test-resource': { bytes: 'some-archive' } })
  assert.equal(f.engine.project.resourceBundles, undefined)
  await f.engine.importProject(bundle)
  assert.equal(f.engine.project.description, '导入的角色工程')
  assert.equal(f.engine.project.resourceBundles, undefined)
  assert.ok(calls.includes('import:some-archive'))
  assert.equal(f.records.get(f.engine.project.id).resourceBundles, undefined)
  await f.engine.open('second')
  assert.ok(calls.some(c => c.startsWith('prepare:imported-')))
  await plugin.dispose()
  await assert.rejects(f.engine.importProject(bundle), /启用资源插件/)
})
test('资源保存失败阻止切换并保留原作品，恢复后可重试', async t => {
  const f = await setup(t), plugin = owner(); let fail = true
  t.after(() => plugin.dispose())
  f.engine.registerResources(plugin, { id: 'broken', prepare() { if (fail) throw Error('模型保存失败') }, async import() {} })
  await assert.rejects(f.engine.open('second'), /模型保存失败/)
  assert.equal(f.engine.project.id, 'first')
  fail = false; await f.engine.open('second'); assert.equal(f.engine.project.id, 'second')
})
