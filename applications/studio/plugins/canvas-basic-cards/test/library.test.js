import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createStore } from '../../canvas/store.js'
import { definitions } from '../definitions.js'
import { createAssetLibrary } from '../library.js'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-library-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { writeSnapshot } = await import('../../../../../shared/persistence.js')
  const store = await createStore(dir, writeSnapshot)
  for (const type of definitions) store.types.register({ effect: fn => fn() }, type)
  const image = await sharp({ create: { width: 10, height: 8, channels: 4, background: '#889955' } }).png().toBuffer()
  const a = await store.addImage(image, 'A'), b = await store.addImage(image, 'B')
  const library = createAssetLibrary(store, () => [a.id])
  const edit = input => library.mutate({ revision: library.read().revision, ...input })
  return { dir, store, library, edit, a, b, writeSnapshot }
}

test('目录整理和多个收藏集共享素材 ID，旧收藏迁移且重启持久化', async t => {
  const { store, dir, library, edit, a, writeSnapshot } = await setup(t)
  assert.deepEqual(library.favorites().assetIds, [a.id])
  let result = await edit({ type: 'mkdir', name: '人物' }); const folderId = result.folders[0].id
  await edit({ type: 'move', ids: [a.id], folderId })
  result = await edit({ type: 'createCollection', name: '服装' }); const collectionId = result.collections[1].id
  await edit({ type: 'collect', ids: [a.id], collectionId })
  await edit({ type: 'rename', ids: [a.id], name: '新名称' })
  assert.equal(library.read().items[a.id].folderId, folderId)
  assert.deepEqual(library.read().collections.map(item => item.assetIds), [[a.id], [a.id]])
  assert.ok((await store.image(a.id)).length)
  const reopened = createAssetLibrary(await createStore(dir, writeSnapshot))
  assert.deepEqual(reopened.read(), library.read())
})

test('禁止目录循环，批量操作失败时全部回滚，陈旧版本不能覆盖', async t => {
  const { library, edit, a } = await setup(t)
  let result = await edit({ type: 'mkdir', name: '父' }); const parent = result.folders[0].id
  result = await edit({ type: 'mkdir', name: '子', parentId: parent }); const child = result.folders[1].id, before = library.read()
  await assert.rejects(edit({ type: 'moveFolder', id: parent, parentId: child }), /自身或子/)
  await assert.rejects(edit({ type: 'batch', operations: [{ type: 'move', ids: [a.id], folderId: parent }, { type: 'moveFolder', id: parent, parentId: child }] }), /自身或子/)
  assert.deepEqual(library.read(), before)
  await assert.rejects(library.mutate({ revision: 0, type: 'renameFolder', id: parent, name: '覆盖' }), /其他窗口更新/)
})

test('删除和恢复文件夹带上子目录，但不恢复之前独立删除的素材', async t => {
  const { library, edit, a, b, store } = await setup(t)
  let result = await edit({ type: 'mkdir', name: '父' }); const parent = result.folders[0].id
  result = await edit({ type: 'mkdir', name: '子', parentId: parent }); const child = result.folders[1].id
  await edit({ type: 'move', ids: [a.id, b.id], folderId: child })
  await edit({ type: 'trash', ids: [b.id] })
  await edit({ type: 'trashFolder', id: parent })
  assert.ok(library.read().items[a.id].trashedAt)
  assert.ok((await store.image(a.id)).length)
  await edit({ type: 'restoreFolder', id: parent })
  assert.equal(library.read().items[a.id].trashedAt, undefined)
  assert.ok(library.read().items[b.id].trashedAt)
  assert.equal(library.read().items[a.id].folderId, child)
})

test('整理的撤销重做独立于画板，收藏集移除不影响主目录', async t => {
  const { library, edit, a, store } = await setup(t)
  const board = store.read().boards[0]
  const first = await edit({ type: 'mkdir', name: '人物' }), folderId = first.folders[0].id
  await edit({ type: 'move', ids: [a.id], folderId })
  await edit({ type: 'undo' }); assert.equal(library.read().items[a.id], undefined)
  await edit({ type: 'redo' }); assert.equal(library.read().items[a.id].folderId, folderId)
  await edit({ type: 'uncollect', ids: [a.id], collectionId: 'favorites' })
  assert.equal(library.read().items[a.id].folderId, folderId)
  assert.deepEqual(store.read().boards[0], board)
})

test('永久删除检查画板引用且只清理回收站中无引用素材', async t => {
  const { store, edit, library, a, b, dir } = await setup(t)
  const board = store.read().boards[0]
  await store.edit(board.id, board.revision, [{ type: 'add', node: { id: 'card', type: 'image', assetId: a.id } }])
  await edit({ type: 'trash', ids: [a.id, b.id] })
  await assert.rejects(store.purgeAssets([a.id, b.id], library.read().revision), /仍被/)
  assert.ok(store.read().assets[b.id], '整批拒绝，不删除未引用项')
  const result = await store.purgeAssets([b.id], library.read().revision)
  assert.deepEqual(result.removed, [b.id]); assert.deepEqual(result.warnings, [])
  assert.ok(store.read().assets[a.id]); assert.equal(store.read().assets[b.id], undefined)
  await assert.rejects(readFile(join(dir, 'images', b.id + '.png')), { code: 'ENOENT' })
  assert.equal(library.read().undoLabel, '')
})

test('永久删除同样保护生成历史和其他插件的素材引用', async t => {
  const { store, edit, library, a, b } = await setup(t)
  await store.records('image-generation').change(tx => tx.records.push({ reference: a.id }))
  await store.records('test-extension').change(tx => tx.records.push({ nested: { assetId: b.id } }))
  await edit({ type: 'trash', ids: [a.id, b.id] })
  await assert.rejects(store.purgeAssets([a.id], library.read().revision), /仍被/)
  await assert.rejects(store.purgeAssets([b.id], library.read().revision), /仍被/)
})
