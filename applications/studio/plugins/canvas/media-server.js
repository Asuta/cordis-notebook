import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { videoLimit } from './video.js'
import { invalid } from './model.js'

export async function installMediaRoutes(ctx, store) {
  const directory = await mkdtemp(join(tmpdir(), 'cordis-media-')), uploads = new Map()
  const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
  const discard = async id => { const item = uploads.get(id); if (!item) return; uploads.delete(id); await item.file.close(); await rm(item.path, { force: true }) }
  const timer = setInterval(() => { for (const [id, item] of uploads) if (!item.busy && Date.now() - item.updated > 3600000) void discard(id).catch(() => {}) }, 60000)
  timer.unref?.()
  ctx.effect(() => async () => { clearInterval(timer); for (const id of [...uploads.keys()]) await discard(id).catch(() => {}); await rm(directory, { recursive: true, force: true }) })
  route('POST', /^\/api\/studio\/media\/uploads$/, async ({ req }) => {
    const input = await ctx.http.body(req)
    if (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > videoLimit) invalid('视频需小于 200 MB')
    if (uploads.size >= 3 || [...uploads.values()].reduce((sum, item) => sum + item.size, input.size) > videoLimit * 2) invalid('请等待当前视频上传完成')
    const id = randomUUID(), path = join(directory, id)
    uploads.set(id, { path, file: await open(path, 'wx+'), name: String(input.name || '视频').slice(0, 120), size: input.size, offset: 0, updated: Date.now(), busy: false })
    return { id }
  })
  route('POST', /^\/api\/studio\/media\/uploads\/([a-f0-9-]{36})(?:\/(finish|abort))?$/, async ({ req, match }) => {
    const [ , id, action ] = match, item = uploads.get(id)
    if (!item) invalid('上传已过期，请重新选择视频')
    if (item.busy) throw Object.assign(Error('此文件正在写入，请稍后重试'), { status: 409 })
    item.busy = true; item.updated = Date.now()
    try {
      const input = await ctx.http.body(req)
      if (action === 'abort') { await discard(id); return { ok: true } }
      if (action === 'finish') {
        if (item.offset !== item.size) invalid('视频尚未完整上传')
        const asset = await store.addVideo(await readFile(item.path), item.name)
        await discard(id); return asset
      }
      if (input.offset !== item.offset || typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) invalid('视频分块顺序或内容无效')
      const bytes = Buffer.from(input.base64, 'base64')
      if (!bytes.length || bytes.length > 1024 * 1024 || item.offset + bytes.length > item.size) invalid('视频分块大小无效')
      let written = 0
      while (written < bytes.length) { const result = await item.file.write(bytes, written, bytes.length - written, item.offset + written); if (!result.bytesWritten) throw Error('视频写入失败'); written += result.bytesWritten }
      item.offset += written; return { offset: item.offset }
    } finally { item.busy = false }
  })
  const serve = async ({ req, res, match }) => {
    const asset = store.read().assets[match[1]]
    if (asset?.kind !== 'video') throw Object.assign(Error('视频不存在'), { status: 404 })
    const file = store.mediaFile(asset.id), { size } = await stat(file.path), range = req.headers.range
    let start = 0, end = size - 1, status = 200
    if (range) {
      const parts = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (parts && (parts[1] || parts[2])) {
        start = parts[1] ? Number(parts[1]) : Math.max(0, size - Number(parts[2]))
        end = parts[1] && parts[2] ? Math.min(size - 1, Number(parts[2])) : size - 1
      } else start = size
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return }
      status = 206
    }
    res.writeHead(status, { 'Content-Type': file.mimeType, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) })
    if (req.method === 'HEAD') res.end()
    else await pipeline(createReadStream(file.path, { start, end }), res).catch(error => { if (!res.destroyed) throw error })
  }
  for (const method of ['GET', 'HEAD']) route(method, /^\/api\/studio\/videos\/([a-f0-9-]{36})$/, serve)
}
