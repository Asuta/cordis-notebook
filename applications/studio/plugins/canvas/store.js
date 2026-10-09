import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { applyOperation, validateBoard, invalid, string } from './model.js'

export async function atomic(file, value) {
  const temporary = file + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, file); break }
      catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 6) throw error; await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt)) }
    }
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}
export const newBoard = title => ({ id: randomUUID(), title, revision: 0, viewport: { x: 60, y: 60, zoom: 1 }, nodes: [], edges: [] })
export async function createStore(directory) {
  await mkdir(join(directory, 'images'), { recursive: true })
  const file = join(directory, 'studio.json')
  let state
  try { state = JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, boards: [newBoard('我的灵感画板')], assets: {}, jobs: [] } }
  if (state.version !== 1 || !Array.isArray(state.boards) || !state.assets || !Array.isArray(state.jobs)) throw Error('画布数据无效，原文件已保留')
  for (const board of state.boards) validateBoard(board, state.assets)
  for (const job of state.jobs) if (['queued', 'running'].includes(job.status)) { job.status = 'interrupted'; job.error = '应用已退出，生成被中断；请手动重试'; job.endedAt = Date.now() }
  await atomic(file, state)
  let queue = Promise.resolve()
  const store = {
    directory,
    read: () => structuredClone(state),
    change(fn) {
      const task = queue.then(async () => { const next = structuredClone(state), result = await fn(next); await atomic(file, next); state = next; return result })
      queue = task.catch(() => {}); return task
    },
    flush: () => queue,
    async edit(boardId, revision, operations) {
      if (!Array.isArray(operations) || !operations.length || operations.length > 100) invalid('一次需要 1–100 个操作')
      return store.change(state => {
        const index = state.boards.findIndex(b => b.id === boardId)
        if (index < 0) invalid('画板不存在')
        if (state.boards[index].revision !== revision) throw Object.assign(Error('画布已变化，请重新读取；本次操作未写入'), { status: 409 })
        let board = state.boards[index]; const inverse = []
        for (const op of operations) { const result = applyOperation(board, op, state.assets); board = result.board; inverse.unshift(result.inverse) }
        state.boards[index] = board; return { board: structuredClone(board), inverse }
      })
    },
    async addBoard(title) {
      string(title, 120, '画板名称')
      return store.change(state => { if (state.boards.length >= 50) invalid('最多创建 50 个画板'); const board = newBoard(title || '新的画板'); state.boards.push(board); return structuredClone(board) })
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
      const asset = { id, name: String(name).slice(0, 120), width: encoded.info.width, height: encoded.info.height, createdAt: Date.now() }
      await store.change(state => { state.assets[id] = asset }); return asset
    },
    async image(id, thumbnail = false) {
      if (!state.assets[id] || !/^[a-f0-9-]{36}$/.test(id)) throw Object.assign(Error('图片不存在'), { status: 404 })
      return readFile(join(directory, 'images', id + (thumbnail ? '.webp' : '.png')))
    },
  }
  return store
}
