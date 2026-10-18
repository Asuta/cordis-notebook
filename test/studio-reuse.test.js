import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copySelection } from '../applications/studio/plugins/canvas/copy.js'
import { createLibrary } from '../applications/studio/plugins/image-generation/library.js'
import { generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { snapshotGenerator } from '../applications/studio/plugins/image-generation/snapshot.js'
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

test('复制画板保留内容与内部连线，跳过未完成占位框并重映射结果来源', async t => {
  const { store } = await fixture(t), board = store.read().boards[0], image = Object.values(store.read().assets)[0]
  const updated = await store.edit(board.id, board.revision, [
    { type: 'add', node: { id: 'finished', type: 'image', assetId: image.id, sourceNodeId: 'g', title: '生成结果 1' } },
    { type: 'add', node: { id: 'pending', type: 'image', jobId: '0f0f0f0f-1111-4222-8333-444444444444', sourceNodeId: 'g', title: '生成结果 2' } },
  ])
  const copy = await store.duplicateBoard(board.id)
  assert.equal(copy.title, board.title + ' 副本')
  assert.equal(copy.nodes.length, updated.board.nodes.length - 1)
  assert.equal(copy.nodes.some(node => node.id === 'pending' || node.title === '生成结果 2'), false)
  assert.equal(copy.edges.length, updated.board.edges.length)
  const original = updated.board.nodes.find(node => node.id === 'g'), generator = copy.nodes.find(node => node.title === original.title)
  assert.ok(generator && generator.id !== original.id)
  for (const id of ['one', 'two', 'image', 'finished']) {
    const source = updated.board.nodes.find(node => node.id === id), cloned = copy.nodes.find(node => node.title === source.title || node.assetId === source.assetId)
    assert.ok(cloned && cloned.id !== source.id && cloned.x === source.x && cloned.y === source.y)
  }
  const finished = copy.nodes.find(node => node.title === '生成结果 1')
  assert.equal(finished.sourceNodeId, generator.id)
  assert.ok(copy.edges.every(edge => copy.nodes.some(node => node.id === edge.from) && copy.nodes.some(node => node.id === edge.to)))
  assert.equal(updated.board.nodes.some(node => node.title === generator.title && node.id !== original.id), false, '原画板不增加副本')
  assert.equal((await store.duplicateBoard(board.id)).title, board.title + ' 副本 2')
})

test('空画板也可以复制为独立空画板', async t => {
  const { store } = await fixture(t), empty = await store.addBoard('空白灵感')
  const copy = await store.duplicateBoard(empty.id)
  assert.equal(copy.title, '空白灵感 副本')
  assert.deepEqual(copy.nodes, [])
  assert.deepEqual(copy.edges, [])
  assert.notEqual(copy.id, empty.id)
  assert.ok(store.read().boards.some(board => board.id === empty.id))
  assert.ok(store.read().boards.some(board => board.id === copy.id))
})

test('固定尾缀接在卡片提示词之后，只拼接启用项，校验格式并随副本保留', async t => {
  const { store, board } = await fixture(t)
  const updated = await store.edit(board.id, board.revision, [{ type: 'update', id: 'g', patch: { promptSuffixes: [
    { id: 'suffix-camera', title: '固定镜头', text: '固定镜头，无bgm', enabled: true },
    { id: 'suffix-off', title: '不启用', text: '不应出现', enabled: false },
  ] } }])
  assert.equal(input(store, updated.board, 'g').prompt, '文字0\n\n文字1\n\n文字2\n\n主提示词\n\n固定镜头，无bgm')
  await assert.rejects(store.edit(updated.board.id, updated.board.revision, [{ type: 'update', id: 'g', patch: { promptSuffixes: [{ id: 'bad', title: '', text: 'x', enabled: true }] } }]), /固定尾缀/)
  const copy = copySelection(updated.board, ['g'], store.types, store.read().assets), copied = await store.edit(updated.board.id, updated.board.revision, copy.operations)
  assert.deepEqual(copied.board.nodes.find(node => node.id === copy.nodeIds[0]).promptSuffixes, updated.board.nodes.find(node => node.id === 'g').promptSuffixes)
  assert.equal(input(store, copied.board, copy.nodeIds[0]).prompt, '文字0\n\n文字1\n\n文字2\n\n主提示词\n\n固定镜头，无bgm')
})

test('结果收藏保存媒体与生成卡片快照，可以恢复参数卡并防止重复收藏', async t => {
  const { store, dir, board } = await fixture(t), image = Object.values(store.read().assets)[0]
  const updated = await store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'result', type: 'image', assetId: image.id, sourceNodeId: 'g', title: '生成结果 1' } }])
  const source = updated.board.nodes.find(node => node.id === 'g'), assets = store.read().assets
  const cardSnapshot = snapshotGenerator(source, { board: updated.board, types: store.types, assets }), generated = []
  generated.push({ id: 'job-result', createdAt: 1, nodeId: 'g', resultNodeId: 'result', resultAssetIds: [image.id], promptText: '主提示词', cardSnapshot })
  const library = createLibrary(store, { read: () => generated })
  const saved = await library.save({ kind: 'result', title: '结果收藏', boardId: board.id, nodeId: 'result', revision: updated.board.revision }), favorite = saved.results[0]
  assert.equal(favorite.assetId, image.id); assert.equal(favorite.node.model, 'mock/video'); assert.equal(favorite.node.prompt, '主提示词')
  assert.equal(favorite.node.cardHeight, 1800); assert.deepEqual(favorite.node.collapsedParameters, { 'wavespeed:mock/video': ['/duration'] })
  await assert.rejects(library.save({ kind: 'result', title: '旧页面', boardId: board.id, nodeId: 'result', revision: 0 }), /重新收藏/)
  const another = await store.addBoard('恢复结果'), restored = await store.edit(another.id, 0, [{ type: 'add', node: { ...favorite.node, id: 'restored' } }])
  const expected = input(store, updated.board, 'g'), actual = input(store, restored.board, 'restored')
  assert.equal(actual.prompt, expected.prompt); assert.deepEqual(actual.assetIds, expected.assetIds); assert.deepEqual(actual.parameters, expected.parameters)
  assert.equal((await library.save({ kind: 'result', title: '重复收藏', boardId: board.id, nodeId: 'result', revision: updated.board.revision })).results.length, 1)
  const reopened = await createStore(dir)
  assert.equal(createLibrary(reopened, { read: () => generated }).read().results[0].node.model, 'mock/video')
})

test('旧任务结果收藏可以把扁平输入绑定迁移到当前模型', async t => {
  const { store, board } = await fixture(t), image = Object.values(store.read().assets)[0]
  const updated = await store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'legacy-result', type: 'image', assetId: image.id, sourceNodeId: 'g', title: '旧生成结果' } }])
  const generated = [{
    id: 'legacy-job', createdAt: 1, nodeId: 'g', resultNodeId: 'legacy-result', resultAssetIds: [image.id],
    promptText: '主提示词', provider: 'wavespeed', model: 'mock/video',
    input: {
      prompt: '主提示词', parameters: { duration: 5 },
      references: [{ key: 'edge:media', assetId: image.id }, { key: 'direct:inside', assetId: image.id }],
      bindings: { 'edge:media': '/start_image', 'direct:inside': '/end_image' },
    },
  }]
  const library = createLibrary(store, { read: () => generated })
  const saved = await library.save({ kind: 'result', title: '旧结果收藏', boardId: board.id, nodeId: 'legacy-result', revision: updated.board.revision }), favorite = saved.results[0]
  const key = 'wavespeed:mock/video', paths = Object.values(favorite.node.referenceBindings[key])
  assert.deepEqual(paths, ['/start_image', '/end_image'])
  const another = await store.addBoard('恢复旧结果'), restored = await store.edit(another.id, 0, [{ type: 'add', node: { ...favorite.node, id: 'restored-legacy' } }]), actual = input(store, restored.board, 'restored-legacy')
  assert.deepEqual(actual.references.map(ref => actual.bindings[ref.key]), ['/start_image', '/end_image'])
})

test('未收藏结果直接恢复当次参数，不跟随源卡修改，源卡删除后仍可恢复', async t => {
  const { store, board } = await fixture(t), image = Object.values(store.read().assets)[0]
  const source = board.nodes.find(node => node.id === 'g')
  const cardSnapshot = snapshotGenerator(source, { board, types: store.types, assets: store.read().assets })
  const generated = [{ id: 'job-parameters', boardId: board.id, nodeId: 'g', resultNodeId: 'result-parameters', resultAssetIds: [image.id], cardSnapshot, createdAt: 1 }]
  const result = await store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'result-parameters', type: 'image', assetId: image.id, sourceNodeId: 'g' } }, { type: 'update', id: 'g', patch: { prompt: '后来的提示词', modelParameters: {} } }])
  const library = createLibrary(store, { read: () => generated }), before = store.read()
  const parameters = library.resultParameters({ boardId: board.id, nodeId: 'result-parameters' })
  assert.equal(parameters.node.prompt, '主提示词')
  assert.equal(parameters.node.modelParameters['wavespeed:mock/video'].duration, 5)
  assert.equal(parameters.node.references.length, 2)
  assert.equal(parameters.node.textReferences.length, 3)
  assert.equal(Object.hasOwn(parameters.node, 'id'), false)
  assert.deepEqual(store.read(), before, '读取参数不能自动收藏或修改画板')
  const removed = await store.edit(board.id, result.board.revision, [{ type: 'remove', ids: ['g'] }])
  const recovered = library.resultParameters({ boardId: board.id, nodeId: 'result-parameters' })
  const restored = await store.edit(board.id, removed.board.revision, [{ type: 'add', node: { ...recovered.node, id: 'restored-parameters' } }])
  assert.equal(input(store, restored.board, 'restored-parameters').prompt, input(store, board, 'g').prompt)
  assert.equal(library.read().results.length, 0)
})

test('全局尾缀编辑同步所有画板的卡片内容，保留独立开关和历史快照', async t => {
  const { store, board } = await fixture(t), generated = [], library = createLibrary(store, { read: () => generated })
  const template = (await library.save({ kind: 'suffix', title: '固定镜头', text: '旧尾缀内容' })).suffixes[0]
  const suffix = { id: template.id, title: template.title, text: template.text, enabled: true }
  const updated = await store.edit(board.id, board.revision, [{ type: 'update', id: 'g', patch: { promptSuffixes: [suffix] } }])
  const frozen = snapshotGenerator(updated.board.nodes.find(node => node.id === 'g'), { board: updated.board, types: store.types, assets: store.read().assets })
  generated.push({ id: 'historic', nodeId: 'g', cardSnapshot: structuredClone(frozen) })
  const favorite = (await library.save({ kind: 'card', title: '历史参数卡', boardId: board.id, nodeId: 'g', revision: updated.board.revision })).cards[0]
  const other = await store.addBoard('另一个画板')
  await store.edit(other.id, other.revision, [{ type: 'add', node: { id: 'other-g', type: 'generator', promptSuffixes: [{ ...suffix, enabled: false }] } }])
  const saved = await library.save({ kind: 'suffix', id: template.id, updatedAt: template.updatedAt, title: '新的镜头模板', text: '新尾缀内容' })
  assert.equal(saved.suffixes[0].text, '新尾缀内容')
  const state = store.read(), first = state.boards.find(item => item.id === board.id), second = state.boards.find(item => item.id === other.id)
  assert.deepEqual(first.nodes.find(node => node.id === 'g').promptSuffixes, [{ ...suffix, title: '新的镜头模板', text: '新尾缀内容' }])
  assert.equal(second.nodes[0].promptSuffixes[0].enabled, false)
  assert.equal(second.nodes[0].promptSuffixes[0].text, '新尾缀内容')
  assert.match(input(store, first, 'g').prompt, /新尾缀内容$/)
  assert.equal(generated[0].cardSnapshot.promptSuffixes[0].text, '旧尾缀内容')
  assert.equal(library.read().cards.find(item => item.id === favorite.id).node.promptSuffixes[0].text, '旧尾缀内容')
  const beforeConflict = store.read()
  await assert.rejects(library.save({ kind: 'suffix', id: template.id, updatedAt: template.updatedAt, title: '过期编辑', text: '不应保存' }), error => error.status === 409)
  assert.deepEqual(store.read(), beforeConflict)
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
  prompt = saved.prompts[0]
  saved = await library.save({ action: 'rename', id: prompt.id, updatedAt: prompt.updatedAt, title: '收藏库重命名' })
  assert.equal(saved.prompts[0].title, '收藏库重命名')
  saved = await library.save({ kind: 'card', title: '视频模板', boardId: board.id, nodeId: 'g', revision: board.revision })
  const template = saved.cards[0]; assert.equal(Object.hasOwn(template.node, 'id'), false); assert.equal(template.node.textReferences.length, 3)
  const another = await store.addBoard('另一个画板')
  const restored = await store.edit(another.id, 0, [{ type: 'add', node: { ...template.node, id: 'restored' } }])
  assert.equal(input(store, restored.board, 'restored').prompt, input(store, board, 'g').prompt)
  assert.deepEqual(input(store, restored.board, 'restored').assetIds, input(store, board, 'g').assetIds)
  await library.save({ kind: 'model', provider: 'wavespeed', model: 'mock/video', title: '视频模型' })
  const reopened = await createStore(dir), persisted = createLibrary(reopened, { read: () => generated }).read()
  assert.equal(persisted.cards[0].node.cardHeight, 1800); assert.equal(persisted.prompts[0].prompt, '编辑后的提示词'); assert.equal(persisted.prompts[0].title, '收藏库重命名'); assert.equal(persisted.models[0].model, 'mock/video')
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
