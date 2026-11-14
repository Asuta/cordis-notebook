import { Service } from 'cordis'
import { createStore } from './store.js'
import { createRegistry } from './registry.js'
import { invalid } from './model.js'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { installMediaRoutes } from './media-server.js'
import { copySelection } from './copy.js'
import { clientStateRevision, serializeClientBoard, serializeClientState } from './client-state.js'

async function uploadBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 28 * 1024 * 1024) throw Object.assign(Error('上传图片不能超过 20 MB'), { status: 413 }); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { invalid('图片上传格式无效') }
}
export default async function (ctx, settings, runtime) {
  const store = await createStore(runtime.dataDir, runtime.writeSnapshot), snapshots = createRegistry(), changes = new Set()
  const service = Object.assign(new Service(ctx, 'canvasDocuments'), {
    types: store.types, snapshots,
    read: store.read, addBoard: store.addBoard, addImage: store.addImage, image: store.image, addVideo: store.addVideo, media: store.media,
    records: store.records, purgeAssets: store.purgeAssets,
    observe(owner, fn) { return owner.effect(() => { changes.add(fn); return () => changes.delete(fn) }) },
    async edit(...args) { const result = await store.edit(...args); if (!result.replayed) for (const fn of changes) await fn(result.board); return result },
    async legacyPixelConfig() {
      try { return JSON.parse(await readFile(join(runtime.dataDir, 'pixel-private.json'), 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    },
  })
  ctx.effect(() => () => store.flush())
  await installMediaRoutes(ctx, store)
  const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
  route('GET', /^\/api\/studio$/, () => serializeClientState(store, snapshots))
  route('GET', /^\/api\/studio\/summary$/, () => ({ revision: clientStateRevision(store, snapshots) }))
  route('POST', /^\/api\/studio\/boards$/, async ({ req }) => serializeClientBoard(await store.addBoard((await ctx.http.body(req)).title), store.types))
  route('POST', /^\/api\/studio\/boards\/([\w-]{1,80})\/copy$/, async ({ match }) => serializeClientBoard(await store.duplicateBoard(match[1]), store.types))
  route('POST', /^\/api\/studio\/edit$/, async ({ req }) => {
    const input = await ctx.http.body(req)
    const result = await service.edit(input.boardId, input.revision, input.operations, input.requestId)
    return { ...result, board: serializeClientBoard(result.board, store.types) }
  })
  route('POST', /^\/api\/studio\/copy$/, async ({ req }) => {
    const input = await ctx.http.body(req), state = store.read(), board = state.boards.find(board => board.id === input.boardId)
    if (!board || board.revision !== input.revision) throw Object.assign(Error('画布已变化，请重新读取后复制'), { status: 409 })
    return copySelection(board, input.nodeIds, store.types, state.assets)
  })
  route('POST', /^\/api\/studio\/upload$/, async ({ req }) => {
    const input = await uploadBody(req)
    if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(input.base64)) invalid('图片内容无效')
    return store.addImage(Buffer.from(input.base64, 'base64'), input.name)
  })
  route('POST', /^\/api\/studio\/import$/, async ({ req }) => {
    const { path } = await ctx.http.body(req)
    if (typeof path !== 'string' || !isAbsolute(path)) invalid('请提供用户指定素材的绝对路径')
    const info = await stat(path)
    const video = /\.(mp4|webm)$/i.test(path)
    if (!info.isFile() || info.size > (video ? 200 : 20) * 1024 * 1024) invalid(video ? '请提供小于 200 MB 的视频文件' : '请提供小于 20 MB 的图片文件')
    return (video ? store.addVideo : store.addImage)(await readFile(path), basename(path))
  })
  route('GET', /^\/api\/studio\/inspect\/([a-f0-9-]{36})$/, async ({ match }) => ({ asset: store.read().assets[match[1]],
    image: { type: 'image', mimeType: 'image/webp', data: (await store.image(match[1], true)).toString('base64') } }))
  route('GET', /^\/api\/studio\/images\/([a-f0-9-]{36})\.(png|webp)$/, async ({ res, match }) => {
    const bytes = await store.image(match[1], match[2] === 'webp')
    res.writeHead(200, { 'Content-Type': match[2] === 'png' ? 'image/png' : 'image/webp', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes)
  })
  route('GET', /^\/api\/studio\/images\/([a-f0-9-]{36})\.small\.webp$/, async ({ res, match }) => {
    const bytes = await store.image(match[1], 'small')
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes)
  })
}
