import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { capabilitiesOf, capabilityCatalog } from '../shared/capabilities.js'
import { discoverBuiltins } from '../server/plugin-discovery.js'
import { developmentInfo } from '../workbench/development-tools.js'
import { capabilityIndex } from '../scripts/capability-index.js'
import { createHost } from '../server/server.js'

test('能力索引来自提供者，笔记与画布契约不串应用', async () => {
  for (const [app, key, owner] of [['notebook', 'client:notebook', 'notebook'], ['studio', 'client:canvasUI', 'canvas-ui']]) {
    const info = await developmentInfo(resolve('.'), app, { capability: key })
    assert.deepEqual(info.warnings, [])
    assert.deepEqual(info.selectedCapabilities.map(c => c.provider), [owner])
    assert.ok(info.contracts.some(file => file.path.includes('/' + owner + '/types/client.d.ts') || file.path.includes('\\' + owner + '\\types\\client.d.ts')))
    assert.ok(info.patterns.length > 1)
    assert.ok(info.selectedCapabilities.every(c => c.contracts.every(path => path.startsWith('applications/' + app + '/'))))
    assert.ok(info.capabilities.every(c => c.key && c.provider && c.description && !c.contracts), '发现索引不重复展开能力详情')
  }
  await assert.rejects(developmentInfo(resolve('.'), 'studio', { capability: 'client:notebook' }), /能力不存在/)
  const generated = await capabilityIndex()
  assert.equal((await readFile('docs/插件能力索引.md', 'utf8')).replaceAll('\r\n', '\n'), generated, '运行 pnpm docs:capabilities 更新索引')
})

test('新插件只写自身能力声明即可发现，坏引用和越界引用不能通过检查', async t => {
  const root = await mkdtemp(resolve('capability-test-')), plugins = join(root, 'applications/sample/plugins'), provider = join(plugins, 'provider')
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(provider, { recursive: true }); await mkdir(join(root, 'packages/host'), { recursive: true })
  await writeFile(join(root, 'packages/host/index.d.ts'), 'export interface Example {}')
  await writeFile(join(root, 'applications/sample/package.json'), JSON.stringify({ cordisApp: { id: 'sample', name: '新应用' } }))
  await writeFile(join(provider, 'server.js'), 'export default () => {}')
  await writeFile(join(provider, 'contract.d.ts'), 'export interface Example { read(): string }')
  const capability = { service: 'example', side: 'server', description: '新能力', contracts: ['contract.d.ts'], examples: ['server.js'], lifecycle: ['使用 owner 管理清理'] }
  const pkg = { name: '@test/provider', type: 'module', version: '1.0.0', cordis: { schemaVersion: 1, id: 'provider', name: '提供者', requires: { client: [], server: [] }, provides: { client: [], server: ['example'] },
    server: { entry: 'server.js', export: 'default' }, public: [], build: [{ type: 'bundle', input: 'server.js', output: 'server.js', platform: 'node' }], capabilities: [capability] } }
  const save = () => writeFile(join(provider, 'package.json'), JSON.stringify(pkg))
  await save()
  const info = await developmentInfo(root, 'sample', { capability: 'server:example' })
  assert.equal(info.selectedCapabilities[0].description, '新能力')
  assert.equal(info.examples[0].content, 'export default () => {}')
  assert.equal((await discoverBuiltins(plugins, { mode: 'development' }))[0].manifest.capabilities.length, 1)
  capability.contracts = ['missing.d.ts']; await save()
  await assert.rejects(discoverBuiltins(plugins, { mode: 'development' }), /文件不存在/)
  await assert.rejects(developmentInfo(root, 'sample', { capability: 'server:example' }), /声明无效/)
  capability.contracts = ['../other/contract.d.ts']; await save()
  await assert.rejects(discoverBuiltins(plugins, { mode: 'development' }), /插件内/)
  capability.contracts = ['contract.d.ts']; capability.side = 'client'
  assert.throws(() => capabilitiesOf(pkg.cordis), /同侧服务/)
})

test('运行时能力返回提供者状态且不伪称前端已核对，应用切换后索引随之切换', async t => {
  const dir = await mkdtemp(resolve('capability-runtime-'))
  const app = await createHost({ port: 0, dataDir: dir, initialApplication: 'notebook' })
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }) })
  const base = 'http://127.0.0.1:' + app.server.address().port
  const before = await (await fetch(base + '/api/capabilities')).json()
  assert.equal(before.find(c => c.key === 'client:notebook').runtime.verified, false)
  assert.equal(before.find(c => c.key === 'server:notes').runtime.state, 'enabled')
  const oldSession = app.applications.session
  await app.applications.switch('studio', oldSession)
  const after = await (await fetch(base + '/api/capabilities')).json()
  assert.ok(after.some(c => c.key === 'server:canvasDocuments')); assert.ok(!after.some(c => c.key === 'server:notes'))
  assert.equal((await fetch(base + '/api/capabilities', { headers: { 'x-application-session': oldSession } })).status, 409)
  assert.equal(capabilityCatalog([{ id: 'test', enabled: false, provides: { client: ['test'] }, capabilities: [{ service: 'test', side: 'client', description: 'test', contracts: ['types.d.ts'] }] }])[0].runtime.state, 'disabled')
})
