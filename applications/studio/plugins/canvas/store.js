import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { createNodeRegistry } from './registry.js'
import { applyOperation, validateBoard, invalid, string } from './model.js'
import { videoMetadata } from './video.js'
import { copySelection } from './copy.js'

export const newBoard = title => ({ id: randomUUID(), title, revision: 0, viewport: { x: 60, y: 60, zoom: 1 }, nodes: [], edges: [] })
export async function createStore(directory, writeSnapshot, types = createNodeRegistry()) {
  await mkdir(join(directory, 'images'), { recursive: true })
  await mkdir(join(directory, 'videos'), { recursive: true })
  const file = join(directory, 'studio.json')
  let state
  try { state = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, boards: [newBoard('我的灵感画板')], assets: {}, jobs: [] } }
  if (state.version !== 1 || !Array.isArray(state.boards) || !state.assets || !Array.isArray(state.jobs)) throw Error('画布数据无效，原文件已保留')
  for (const board of state.boards) validateBoard(board, state.assets, types)
  await writeSnapshot(file, JSON.stringify(state, null, 2))
  let queue = Promise.resolve()
  const store = {
    directory, types,
    read: () => structuredClone(state),
    change(fn) {
      const task = queue.then(async () => { const next = structuredClone(state), result = await fn(next); await writeSnapshot(file, JSON.stringify(next, null, 2)); state = structuredClone(next); return result })
      queue = task.catch(() => {}); return task
    },
    flush: () => queue,
    records(namespace) {
      if (!/^[a-z][a-z0-9-]*$/.test(namespace)) throw Error('记录空间无效')
      const records = value => namespace === 'image-generation' ? value.jobs : ((value.extensions ||= {})[namespace] ||= [])
      return {
        read: () => structuredClone(namespace === 'image-generation' ? state.jobs : state.extensions?.[namespace] || []),
        change: callback => store.change(next => {
          const tx = {
            records: records(next),
            board: id => structuredClone(next.boards.find(b => b.id === id)),
            edit(id, operations) {
              const index = next.boards.findIndex(b => b.id === id)
              if (index < 0) invalid('画板不存在')
              let board = next.boards[index]
              for (const op of operations) board = applyOperation(board, op, next.assets, types).board
              next.boards[index] = board
            },
          }
          const result = callback(tx)
          if (result?.then) throw Error('文档事务不能执行异步操作')
          return structuredClone(result)
        }),
      }
    },
    async edit(boardId, revision, operations) {
      if (!Array.isArray(operations) || !operations.length || operations.length > 100) invalid('一次需要 1–100 个操作')
      return store.change(state => {
        const index = state.boards.findIndex(b => b.id === boardId)
        if (index < 0) invalid('画板不存在')
        if (state.boards[index].revision !== revision) throw Object.assign(Error('画布已变化，请重新读取；本次操作未写入'), { status: 409 })
        let board = state.boards[index]; const inverse = []
        for (const op of operations) { const result = applyOperation(board, op, state.assets, types); board = result.board; inverse.unshift(result.inverse) }
        state.boards[index] = board; return { board: structuredClone(board), inverse }
      })
    },
    async addBoard(title) {
      string(title, 120, '画板名称')
      return store.change(state => { if (state.boards.length >= 50) invalid('最多创建 50 个画板'); const board = newBoard(title || '新的画板'); state.boards.push(board); return structuredClone(board) })
    },
    async duplicateBoard(boardId) {
      return store.change(state => {
        if (state.boards.length >= 50) invalid('最多创建 50 个画板')
        const source = state.boards.find(board => board.id === boardId)
        if (!source) invalid('画板不存在')
        const nodes = source.nodes.filter(node => !(node.sourceNodeId && !node.assetId))
        const operations = nodes.length ? copySelection(source, nodes.map(node => node.id), types, state.assets, { offset: 0, limit: 3000 }).operations : []
        let title = (source.title + ' 副本').slice(0, 120), suffix = 2
        while (state.boards.some(board => board.title === title)) {
          const ending = ' 副本 ' + suffix++
          title = source.title.slice(0, 120 - ending.length) + ending
        }
        let board = newBoard(title)
        for (const operation of operations) board = applyOperation(board, operation, state.assets, types).board
        state.boards.push(board)
        return structuredClone(board)
      })
    },
    async addImage(bytes, name = '图片') {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 20 * 1024 * 1024) invalid('图片需小于 20 MB')
      const input = sharp(bytes, { limitInputPixels: 50_000_000 })
      const meta = await input.metadata().catch(() => invalid('无法读取图片，仅支持 PNG、JPEG、WebP'))
      if (!['png', 'jpeg', 'webp'].includes(meta.format)) invalid('仅支持 PNG、JPEG、WebP 图片')
      const id = randomUUID(), encoded = await input.rotate().png().toBuffer({ resolveWithObject: true })
      if (encoded.data.length > 40 * 1024 * 1024) invalid('解码后的图片过大')
      await writeFile(join(directory, 'images', id + '.png'), encoded.data)
      await sharp(encoded.data).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(join(directory, 'images', id + '.webp'))
      const asset = { id, kind: 'image', mimeType: 'image/png', name: String(name).slice(0, 120), width: encoded.info.width, height: encoded.info.height, createdAt: Date.now() }
      await store.change(state => { state.assets[id] = asset }); return asset
    },
    async image(id, thumbnail = false) {
      if (!state.assets[id] || state.assets[id].kind === 'video' || !/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(Error('图片不存在'), { status: 404 })
      return readFile(join(directory, 'images', id + (thumbnail ? '.webp' : '.png')))
    },
    async addVideo(bytes, name = '视频') {
      const info = videoMetadata(bytes), id = randomUUID()
      await writeFile(join(directory, 'videos', id + '.' + info.extension), bytes)
      const asset = { id, kind: 'video', name: String(name).slice(0, 120), ...info, size: bytes.length, createdAt: Date.now() }
      await store.change(state => { state.assets[id] = asset }); return asset
    },
    mediaFile(id) {
      const asset = state.assets[id]
      if (!asset || !/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(Error('素材不存在'), { status: 404 })
      if (asset.kind !== 'video') return { path: join(directory, 'images', id + '.png'), mimeType: 'image/png' }
      if (!['mp4', 'webm'].includes(asset.extension)) invalid('视频格式无效')
      return { path: join(directory, 'videos', id + '.' + asset.extension), mimeType: asset.mimeType }
    },
    async media(id) { return readFile(store.mediaFile(id).path) },
  }
  return store
}
