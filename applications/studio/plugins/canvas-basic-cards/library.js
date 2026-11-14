import { randomUUID } from 'node:crypto'

const fail = (message, status = 400) => { throw Object.assign(Error(message), { status }) }
const title = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) fail('名称需为 1–120 个字符')
  return value.trim()
}
const empty = favorites => ({ folders: [], collections: [{ id: 'favorites', name: '收藏', assetIds: favorites }], items: {} })
const copy = value => structuredClone(value)
const folder = (data, id) => {
  if (id === null) return null
  const found = data.folders.find(item => item.id === id && !item.trashedAt)
  if (!found) fail('文件夹不存在或已在回收站')
  return found
}
function descendants(data, id) {
  const ids = new Set([id])
  for (let changed = true; changed;) {
    changed = false
    for (const item of data.folders) if (ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true }
  }
  return ids
}

export function createAssetLibrary(documents, legacyFavorites = () => []) {
  const records = documents.records('asset-library')
  const initial = () => ({ revision: 0, data: empty(legacyFavorites()), undo: [], redo: [] })
  const current = () => records.read()[0] || initial()
  const expose = value => ({ ...copy(value.data), revision: value.revision, undoLabel: value.undo.at(-1)?.label || '', redoLabel: value.redo.at(-1)?.label || '' })
  function apply(data, op, assets) {
    if (!op || typeof op !== 'object') fail('素材库操作无效')
    if (op.type === 'batch') {
      if (!Array.isArray(op.operations) || !op.operations.length || op.operations.length > 200 || op.operations.some(item => item.type === 'batch')) fail('批量操作无效或超过 200 项')
      for (const item of op.operations) apply(data, item, assets)
      return '批量整理'
    }
    const assetsFor = () => {
      if (!Array.isArray(op.ids) || !op.ids.length || op.ids.length > 10000 || new Set(op.ids).size !== op.ids.length) fail('请选择 1–10000 份素材')
      for (const id of op.ids) if (typeof id !== 'string' || !Object.hasOwn(assets, id)) fail('素材不存在，请刷新后重试')
      return op.ids
    }
    const collection = id => { const item = data.collections.find(item => item.id === id); if (!item) fail('收藏集不存在'); return item }
    const label = { mkdir: '新建文件夹', renameFolder: '重命名文件夹', moveFolder: '移动文件夹', trashFolder: '删除文件夹', restoreFolder: '恢复文件夹', createCollection: '新建收藏集', renameCollection: '重命名收藏集', deleteCollection: '删除收藏集', collect: '加入收藏集', uncollect: '移出收藏集', move: '移动素材', rename: '重命名素材', trash: '移入回收站', restore: '恢复素材' }[op.type]
    if (!label) fail('未知素材库操作')
    if (op.type === 'mkdir') {
      const parentId = op.parentId ?? null; folder(data, parentId)
      if (data.folders.length >= 2000) fail('最多创建 2000 个文件夹')
      data.folders.push({ id: randomUUID(), parentId, name: title(op.name) })
    } else if (op.type === 'renameFolder') folder(data, op.id).name = title(op.name)
    else if (op.type === 'moveFolder') {
      const item = folder(data, op.id), parentId = op.parentId ?? null; folder(data, parentId)
      if (descendants(data, item.id).has(parentId)) fail('不能把文件夹移入自身或子文件夹')
      item.parentId = parentId
    } else if (op.type === 'trashFolder') {
      const item = folder(data, op.id), ids = descendants(data, item.id), now = Date.now(), group = randomUUID()
      for (const entry of data.folders) if (ids.has(entry.id) && !entry.trashedAt) { entry.trashedAt = now; entry.trashGroup = group }
      for (const asset of Object.values(data.items)) if (ids.has(asset.folderId) && !asset.trashedAt) { asset.trashedAt = now; asset.trashGroup = group }
    } else if (op.type === 'restoreFolder') {
      const item = data.folders.find(item => item.id === op.id && item.trashedAt)
      if (!item) fail('回收站文件夹不存在')
      const group = item.trashGroup
      for (const entry of [...data.folders, ...Object.values(data.items)]) if (entry.trashGroup === group) { delete entry.trashedAt; delete entry.trashGroup }
      for (const entry of data.folders) if (!entry.trashedAt && entry.parentId && !data.folders.some(parent => parent.id === entry.parentId && !parent.trashedAt)) entry.parentId = null
    } else if (op.type === 'createCollection') {
      if (data.collections.length >= 1000) fail('最多创建 1000 个收藏集')
      data.collections.push({ id: randomUUID(), name: title(op.name), assetIds: [] })
    } else if (op.type === 'renameCollection') collection(op.id).name = title(op.name)
    else if (op.type === 'deleteCollection') {
      if (op.id === 'favorites') fail('默认收藏集不能删除')
      collection(op.id); data.collections = data.collections.filter(item => item.id !== op.id)
    } else if (op.type === 'collect' || op.type === 'uncollect') {
      const item = collection(op.collectionId), ids = assetsFor()
      item.assetIds = op.type === 'collect' ? [...new Set([...ids, ...item.assetIds])] : item.assetIds.filter(id => !ids.includes(id))
    } else {
      const ids = assetsFor()
      if (op.type === 'move') folder(data, op.folderId ?? null)
      if (op.type === 'rename' && ids.length !== 1) fail('请只选择一份素材进行重命名')
      for (const id of ids) {
        const entry = data.items[id] ||= { folderId: null }
        if (op.type === 'move') { if (entry.trashedAt) fail('请先恢复素材'); entry.folderId = op.folderId ?? null }
        if (op.type === 'rename') entry.name = title(op.name)
        if (op.type === 'trash' && !entry.trashedAt) entry.trashedAt = Date.now()
        if (op.type === 'restore') {
          delete entry.trashedAt; delete entry.trashGroup
          if (entry.folderId && !data.folders.some(item => item.id === entry.folderId && !item.trashedAt)) entry.folderId = null
        }
      }
    }
    return label
  }
  async function mutate(input, legacy = false) {
    if (!input || typeof input !== 'object') fail('素材库请求无效')
    return records.change(tx => {
      const value = copy(tx.records[0] || initial())
      if (!legacy && input.revision !== value.revision) fail('素材库已在其他窗口更新，请重试；本次操作未写入', 409)
      if (input.type === 'undo' || input.type === 'redo') {
        const source = value[input.type], target = value[input.type === 'undo' ? 'redo' : 'undo'], entry = source.pop()
        if (!entry) fail('没有可撤销或重做的素材整理操作')
        target.push({ label: entry.label, data: value.data }); value.data = entry.data
      } else {
        const previous = copy(value.data), label = apply(value.data, input, documents.read().assets)
        value.undo.push({ label, data: previous }); value.undo = value.undo.slice(-20); value.redo = []
      }
      value.revision++; tx.records.splice(0, tx.records.length, value)
      return expose(value)
    })
  }
  return {
    read: () => expose(current()), mutate,
    favorites: () => {
      const assets = documents.read().assets
      return { assetIds: current().data.collections.find(item => item.id === 'favorites').assetIds.filter(id => Object.hasOwn(assets, id)) }
    },
    async favorite(input) {
      if (!input || typeof input.favorite !== 'boolean') fail('收藏状态无效')
      await mutate({ type: input.favorite ? 'collect' : 'uncollect', collectionId: 'favorites', ids: [input.assetId] }, true)
      return this.favorites()
    },
  }
}
