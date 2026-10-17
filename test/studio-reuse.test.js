import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copySelection } from '../applications/studio/plugins/canvas/copy.js'
import { createLibrary } from '../applications/studio/plugins/image-generation/library.js'
import { generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { createCatalog } from '../applications/studio/plugins/image-provider-wavespeed/catalog.js'
import { createConfig } from '../applications/studio/plugins/image-provider-wavespeed/config.js'
import { createStore } from './helpers/studio-fixture.js'
import { imageFixture, row } from './helpers/studio-wavespeed.js'
import { writeSnapshot } from '../shared/persistence.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-reuse-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const store = await createStore(dir), first = store.read().boards[0], image = await store.addImage(await imageFixture())
  const key = 'wavespeed:mock/video'
  const result = await store.edit(first.id, 0, [
    ...['one', 'two', 'three'].map((id, i) => ({ type: 'add', node: { id, type: 'text', text: '文字' + i } })),
    { type: 'add', node: { id: 'image', type: 'image', assetId: image.id } },
    { type: 'add', node: { id: 'g', type: 'generator', provider: 'wavespeed', model: 'mock/video', prompt: '主提示词', modelParameters: { [key]: { duration: 5 } }, references: [{ id: 'inside', assetId: image.id }], referenceOrder: ['edge:media', 'direct:inside'], referenceBindings: { [key]: { 'edge:media': '/start_image', 'direct:inside': '/end_image' } }, cardHeight: 1800, collapsedParameters: { [key]: ['/duration'] } } },
    ...['one', 'two', 'three'].map(id => ({ type: 'connect', id: 'text-' + id, from: id, to: 'g' })),
    { type: 'connect', id: 'media', from: 'image', to: 'g' },
  ])
  return { store, dir, key, board: result.board }
}
const input = (store, board, nodeId) => generationInput(board, nodeId, store.types, store.read().assets)

test('单独复制生成卡片冻结外部文字与素材，保持参数、顺序、绑定和布局，副本互相独立', async t => {
  const { store, board, key } = await fixture(t), original = input(store, board, 'g')
  const copy = copySelection(board, ['g'], store.types, store.read().assets)
  assert.equal(copy.operations.length, 1)
  const result = await store.edit(board.id, board.revision, copy.operations), id = copy.nodeIds[0], node = result.board.nodes.find(node => node.id === id), snapshot = input(store, result.board, id)
  assert.equal(snapshot.prompt, original.prompt); assert.deepEqual(snapshot.assetIds, original.assetIds)
  assert.deepEqual(snapshot.references.map(ref => snapshot.bindings[ref.key]), ['/start_image', '/end_image'])
  assert.deepEqual(snapshot.parameters, { duration: 5 }); assert.equal(node.cardHeight, 1800); assert.deepEqual(node.collapsedParameters[key], ['/duration'])
  assert.equal(result.board.edges.some(edge => edge.to === id), false)
  const changed = await store.edit(board.id, result.board.revision, [{ type: 'update', id: 'two', patch: { text: '上游已修改' } }])
  assert.equal(input(store, changed.board, id).prompt, original.prompt)
  assert.match(input(store, changed.board, 'g').prompt, /上游已修改/)
  assert.notEqual(node.references[0].id, 'inside')
})

test('部分连线随多选复制，外部输入冻结并保序，内部引用映射正确且整组可以撤销重做', async t => {
  const { store, board } = await fixture(t), copy = copySelection(board, ['two', 'image', 'g'], store.types, store.read().assets)
  const result = await store.edit(board.id, board.revision, copy.operations), [textId, imageId, id] = copy.nodeIds
  const incoming = result.board.edges.filter(edge => edge.to === id)
  assert.deepEqual(incoming.map(edge => edge.from), [textId, imageId])
  let snapshot = input(store, result.board, id)
  assert.equal(snapshot.prompt, '文字0\n\n文字1\n\n文字2\n\n主提示词')
  assert.deepEqual(snapshot.references.map(ref => ref.source), ['edge', 'direct'])
  assert.deepEqual(snapshot.references.map(ref => snapshot.bindings[ref.key]), ['/start_image', '/end_image'])
  const undone = await store.edit(board.id, result.board.revision, result.inverse)
  assert.deepEqual(undone.board.nodes, board.nodes); assert.deepEqual(undone.board.edges, board.edges)
  const redone = await store.edit(board.id, undone.board.revision, undone.inverse)
  assert.equal(input(store, redone.board, id).prompt, snapshot.prompt)
  const updated = await store.edit(board.id, redone.board.revision, [{ type: 'update', id: textId, patch: { text: '独立副本的新文字' } }])
  snapshot = input(store, updated.board, id)
  assert.match(snapshot.prompt, /文字0\n\n独立副本的新文字\n\n文字2/); assert.doesNotMatch(input(store, updated.board, 'g').prompt, /独立副本/)
  const recopy = copySelection(updated.board, [id], store.types, store.read().assets)
  const copiedAgain = await store.edit(board.id, updated.board.revision, recopy.operations)
  assert.equal(input(store, copiedAgain.board, recopy.nodeIds[0]).prompt, snapshot.prompt)
})

test('收藏快照跨画板恢复且重启保留，提示词可编辑并防止覆盖其他页面，历史只来自真实任务并去重', async t => {
  const { store, board, dir } = await fixture(t), generated = []
  const library = createLibrary(store, { read: () => generated })
  assert.equal(library.read().history.length, 0)
  generated.push({ id: 'job-1', createdAt: 1, promptText: '生成过的提示词', input: { prompt: '合并后的内容' } }, { id: 'job-2', createdAt: 2, promptText: '生成过的提示词', input: { prompt: '另一个输入' } }, { id: 'blank', createdAt: 3, promptText: '', input: { prompt: '连线内容' } })
  assert.deepEqual(library.read().history.map(item => [item.id, item.prompt]), [['job-2', '生成过的提示词']])
  let saved = await library.save({ kind: 'prompt', title: '人物提示词', prompt: '原提示词' }), prompt = saved.prompts[0]
  saved = await library.save({ kind: 'prompt', id: prompt.id, updatedAt: prompt.updatedAt, title: '修改后的名称', prompt: '编辑后的提示词' })
  await assert.rejects(library.save({ kind: 'prompt', id: prompt.id, updatedAt: prompt.updatedAt, title: '旧页面', prompt: '不能覆盖' }), error => error.status === 409)
  saved = await library.save({ kind: 'card', title: '视频模板', boardId: board.id, nodeId: 'g', revision: board.revision })
  const template = saved.cards[0]; assert.equal(Object.hasOwn(template.node, 'id'), false); assert.equal(template.node.textReferences.length, 3)
  const another = await store.addBoard('另一个画板')
  const restored = await store.edit(another.id, 0, [{ type: 'add', node: { ...template.node, id: 'restored' } }])
  assert.equal(input(store, restored.board, 'restored').prompt, input(store, board, 'g').prompt)
  assert.deepEqual(input(store, restored.board, 'restored').assetIds, input(store, board, 'g').assetIds)
  await library.save({ kind: 'model', provider: 'wavespeed', model: 'mock/video', title: '视频模型' })
  const reopened = await createStore(dir), persisted = createLibrary(reopened, { read: () => generated }).read()
  assert.equal(persisted.cards[0].node.cardHeight, 1800); assert.equal(persisted.prompts[0].prompt, '编辑后的提示词'); assert.equal(persisted.models[0].model, 'mock/video')
  await library.save({ action: 'delete', id: template.id }); assert.equal(library.read().cards.length, 0)
})

test('模型搜索忽略大小写、空格与分隔符，支持多词、相关名称优先，收藏筛选先于分页', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'studio-search-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const config = await createConfig(dir, { writeSnapshot, env: { WAVESPEED_API_KEY: 'mock' } })
  const rows = [row('bytedance/seedream-v5.0-flash/edit', 'image-to-image', { prompt: { type: 'string' } }), row('other/unrelated', 'text-to-image', { prompt: { type: 'string' } }), ...Array.from({ length: 60 }, (_, i) => row('extra/image-' + i, 'text-to-image', { prompt: { type: 'string' } }))]
  const catalog = await createCatalog(dir, config, { api: async () => rows }, writeSnapshot)
  for (const query of ['Seedream 5', 'SEEDREAM5', '5 SEEDREAM', 'Seedream-v5.0 Flash', 'seedream v5 0 flash edit']) assert.equal((await catalog.list({ query })).items[0]?.id, rows[0].model_id)
  assert.equal((await catalog.list({ ids: ['extra/image-59'], limit: 1 })).items[0].id, 'extra/image-59')
  assert.equal((await catalog.list({ ids: [] })).total, 0)
})
