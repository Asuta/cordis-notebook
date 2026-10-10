import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createStore } from '../applications/studio/plugins/canvas/store.js'
import { createNodeRegistry } from '../applications/studio/plugins/canvas/registry.js'
import { definitions } from '../applications/studio/plugins/canvas-basic-cards/definitions.js'
import { definition, generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { createJobs } from '../applications/studio/plugins/image-generation/jobs.js'
import { createConfig } from '../applications/studio/plugins/image-provider-pixel/pixel.js'
import { owner } from './helpers/studio-fixture.js'

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-plugins-')), types = createNodeRegistry(), base = owner()
  for (const item of [...definitions, definition]) types.register(base, item)
  const store = await createStore(directory, types)
  const cleanup = []
  t.after(async () => { for (const fn of cleanup.reverse()) await fn(); await base.dispose(); await rm(directory, { recursive: true, force: true }) })
  const boardId = store.read().boards[0].id
  const edit = operations => store.edit(boardId, store.read().boards[0].revision, operations)
  return { directory, store, types, boardId, edit, cleanup }
}
const until = async predicate => { const deadline = Date.now() + 5000; while (!predicate()) { if (Date.now() > deadline) assert.fail('等待任务超时'); await new Promise(r => setTimeout(r, 10)) } }
const png = () => sharp({ create: { width: 12, height: 8, channels: 3, background: '#557744' } }).png().toBuffer()

test('新增卡片通过注册输出文字；卸载后保留内容、连线、布局与历史，重新注册恢复', async t => {
  const { store, types, directory, edit } = await setup(t), plugin = owner()
  const template = { id: 'prompt-template', label: '提示词模板', fields: ['template'], output: 'text', defaults: () => ({ template: '模板内容' }), validate(node) { if (typeof node.template !== 'string') throw Error('模板内容无效') }, resolve: node => ({ text: node.template }) }
  types.register(plugin, template)
  await edit([{ type: 'add', node: { id: 'custom', type: template.id } }, { type: 'add', node: { id: 'g', type: 'generator', prompt: '补充要求' } }, { type: 'connect', id: 'edge', from: 'custom', to: 'g' }])
  assert.equal(generationInput(store.read().boards[0], 'g', types).prompt, '模板内容\n\n补充要求')
  await plugin.dispose()
  await edit([{ type: 'update', id: 'custom', patch: { x: 120 } }])
  await assert.rejects(edit([{ type: 'update', id: 'custom', patch: { template: '不能覆盖未知内容' } }]), /不能修改/)
  assert.throws(() => generationInput(store.read().boards[0], 'g', types), /不可用/)
  const removed = await edit([{ type: 'remove', ids: ['custom'] }])
  await edit(removed.inverse)
  const reopened = await createStore(directory)
  assert.equal(reopened.read().boards[0].nodes[0].template, '模板内容')
  assert.equal(reopened.read().boards[0].edges.length, 1)
  types.register(owner(), template)
  assert.match(generationInput(store.read().boards[0], 'g', types).prompt, /模板内容/)
  assert.throws(() => types.register(owner(), { ...template, id: 'bad', fields: ['id'] }), /字段/)
})

test('任意插件的可选字段可跨 JSON 撤销删除，保留 null 值并遵守卸载保护', async t => {
  const { types, edit, store, directory } = await setup(t), plugin = owner()
  types.register(plugin, { id: 'optional-card', label: '扩展卡片', fields: ['option'], defaults: () => ({}), validate() {} })
  const wire = value => JSON.parse(JSON.stringify(value))
  const send = async operations => wire(await edit(wire(operations)))
  const added = await send([{ type: 'add', node: { id: 'custom', type: 'optional-card' } }])
  const changed = await send([{ type: 'update', id: 'custom', patch: { option: null } }])
  assert.equal(changed.board.nodes[0].option, null)
  const undone = await send(changed.inverse)
  assert.deepEqual(undone.board.nodes, added.board.nodes)
  await send(undone.inverse)
  const removed = await send([{ type: 'update', id: 'custom', patch: {}, unset: ['option'] }])
  assert.equal(Object.hasOwn(removed.board.nodes[0], 'option'), false)
  await send(removed.inverse)
  assert.equal((await createStore(directory, types)).read().boards[0].nodes[0].option, null)
  await plugin.dispose()
  const before = store.read()
  await assert.rejects(send(changed.inverse), /不能修改/)
  assert.deepEqual(store.read(), before)
})

test('扩展记录与结果卡片同一事务提交，失败回滚且不泄露可变状态引用', async t => {
  const { store, boardId } = await setup(t), records = store.records('image-generation')
  await records.change(tx => tx.records.push({ id: 'one', status: 'running' }))
  await assert.rejects(records.change(tx => {
    tx.records[0].status = 'succeeded'
    tx.edit(boardId, [{ type: 'add', node: { id: 'result', type: 'image', assetId: 'missing' } }])
  }), /素材不存在/)
  assert.equal(records.read()[0].status, 'running')
  assert.equal(store.read().boards[0].nodes.length, 0)
  let retained
  await records.change(tx => { retained = tx.records; tx.records[0].status = 'interrupted' })
  retained[0].status = 'succeeded'
  assert.equal(records.read()[0].status, 'interrupted')
})

test('图片服务可替换；任务固定提供者和参数快照，重复 ID 不重复请求', async t => {
  const { store, edit, boardId, cleanup } = await setup(t), jobs = await createJobs(store), provider = owner()
  cleanup.push(() => jobs.close())
  let model = 'first-model', captured, calls = 0
  jobs.register(provider, { id: 'mock-provider', label: '模拟图片服务', public: () => ({ model }), prepare(input) {
    const snapshot = model; captured = structuredClone(input)
    return { model: snapshot, async generate() { calls++; return png() } }
  } })
  const result = await edit([{ type: 'add', node: { id: 'g', type: 'generator', provider: 'mock-provider', prompt: '原要求' } }])
  const request = { boardId, nodeId: 'g', revision: result.board.revision, requestId: randomUUID() }
  const job = await jobs.start(request)
  model = 'second-model'
  await until(() => jobs.read()[0].status === 'succeeded')
  await jobs.start(request)
  assert.equal(calls, 1); assert.equal(job.model, 'first-model'); assert.equal(captured.prompt, '原要求')
  const image = store.read().boards[0].nodes.find(n => n.type === 'image')
  assert.equal(image.jobId, job.id); assert.equal(image.sourceNodeId, 'g')
  await provider.dispose()
  await assert.rejects(jobs.start({ ...request, requestId: randomUUID(), revision: store.read().boards[0].revision }), /图片服务不可用/)
})

test('停用提供者中断运行和排队任务；忽略取消后迟到图片，恢复不自动重试', async t => {
  const { store, edit, boardId, cleanup } = await setup(t), jobs = await createJobs(store), provider = owner(), releases = []
  cleanup.push(() => jobs.close())
  let calls = 0
  const registration = { id: 'slow', label: '延迟服务', public: () => ({}), prepare: () => ({ model: 'mock', generate(images, signal) {
    calls++; return new Promise(resolve => { releases.push(() => png().then(resolve)); signal.addEventListener('abort', () => png().then(resolve), { once: true }) })
  } }) }
  jobs.register(provider, registration)
  await edit([0, 1, 2].map(i => ({ type: 'add', node: { id: 'g' + i, type: 'generator', prompt: '测试', provider: 'slow' } })))
  for (let i = 0; i < 3; i++) await jobs.start({ boardId, nodeId: 'g' + i, revision: store.read().boards[0].revision, requestId: randomUUID() })
  await until(() => calls === 2)
  await provider.dispose()
  assert.deepEqual(jobs.read().map(j => j.status), ['interrupted', 'interrupted', 'interrupted'])
  assert.equal(store.read().boards[0].nodes.length, 3)
  jobs.register(owner(), registration)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(calls, 2)
})

test('Pixel 私有配置只迁移一次，旧备份保留且新配置优先', async t => {
  const { directory } = await setup(t), legacy = { apiKey: 'legacy-secret', model: 'old-model', baseUrl: 'https://example.com' }
  const legacyPath = join(directory, 'old-private.json'), target = join(directory, 'provider')
  await writeFile(legacyPath, JSON.stringify(legacy))
  const config = await createConfig(target, { env: {}, configPath: 'missing', legacy: async () => JSON.parse(await readFile(legacyPath, 'utf8')) })
  await config.save({ model: 'new-model' })
  const reopened = await createConfig(target, { legacy: () => { throw Error('不能再次迁移') } })
  assert.equal(reopened.public().model, 'new-model')
  assert.equal(reopened.private().apiKey, legacy.apiKey)
  assert.doesNotMatch(JSON.stringify(reopened.public()), /legacy-secret/)
  assert.deepEqual(JSON.parse(await readFile(legacyPath, 'utf8')), legacy)
})
