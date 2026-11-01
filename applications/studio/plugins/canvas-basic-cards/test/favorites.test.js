import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAssetFavorites } from '../favorites.js'

const first = '11111111-1111-1111-1111-111111111111'
const second = '22222222-2222-2222-2222-222222222222'
const missing = '33333333-3333-3333-3333-333333333333'

function fakeDocuments() {
  const assets = { [first]: { id: first }, [second]: { id: second } }, saved = []
  return {
    saved,
    read: () => ({ assets: structuredClone(assets) }),
    records() {
      return {
        read: () => structuredClone(saved),
        async change(callback) { callback({ records: saved }) },
      }
    },
  }
}

test('收藏素材并保持最近收藏在前', async () => {
  const documents = fakeDocuments(), favorites = createAssetFavorites(documents)
  assert.deepEqual((await favorites.save({ assetId: first, favorite: true })).assetIds, [first])
  assert.deepEqual((await favorites.save({ assetId: second, favorite: true })).assetIds, [second, first])
  assert.deepEqual(favorites.read().assetIds, [second, first])
})

test('重复收藏不产生重复记录，取消收藏只移除目标素材', async () => {
  const documents = fakeDocuments(), favorites = createAssetFavorites(documents)
  await favorites.save({ assetId: first, favorite: true })
  await favorites.save({ assetId: second, favorite: true })
  await favorites.save({ assetId: first, favorite: true })
  assert.equal(documents.saved.length, 2)
  assert.deepEqual((await favorites.save({ assetId: first, favorite: false })).assetIds, [second])
  assert.equal(documents.saved.length, 1)
})

test('读取时忽略已不存在的素材和重复记录', () => {
  const documents = fakeDocuments()
  documents.saved.push({ assetId: missing }, { assetId: first }, { assetId: first }, { assetId: 'not-an-asset' })
  assert.deepEqual(createAssetFavorites(documents).read().assetIds, [first])
})

test('拒绝不存在的素材、无效 id 和缺失的收藏状态', async () => {
  const favorites = createAssetFavorites(fakeDocuments())
  await assert.rejects(favorites.save({ assetId: missing, favorite: true }), /素材不存在/)
  await assert.rejects(favorites.save({ assetId: 'bad', favorite: true }), /素材无效/)
  await assert.rejects(favorites.save({ assetId: first }), /收藏状态无效/)
  await assert.rejects(favorites.save(null), /收藏请求无效/)
})
