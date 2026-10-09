import { Service } from 'cordis'
import { createStore } from './store.js'
import { createConfig, createPixel } from './pixel.js'
import { createJobs } from './jobs.js'
import { invalid } from './model.js'
import { readFile, stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'

async function uploadBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 28 * 1024 * 1024) throw Object.assign(Error('上传图片不能超过 20 MB'), { status: 413 }); chunks.push(chunk) }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { invalid('图片上传格式无效') }
}
export default async function (ctx, settings, runtime) {
  const store = await createStore(runtime.dataDir), config = await createConfig(runtime.dataDir), pixel = createPixel(), jobs = createJobs(store, config, pixel)
  Object.assign(new Service(ctx, 'imageStudio'), { store, jobs })
  ctx.effect(() => () => jobs.close())
  const route = (method, pattern, handler) => ctx.http.route(ctx, method, pattern, handler)
  route('GET', /^\/api\/studio$/, () => ({ ...store.read(), config: config.public() }))
  route('POST', /^\/api\/studio\/boards$/, async ({ req }) => store.addBoard((await ctx.http.body(req)).title))
  route('POST', /^\/api\/studio\/edit$/, async ({ req }) => {
    const input = await ctx.http.body(req), result = await store.edit(input.boardId, input.revision, input.operations)
    for (const job of store.read().jobs) if (job.boardId === input.boardId && ['queued', 'running'].includes(job.status) && !result.board.nodes.some(n => n.id === job.nodeId)) await jobs.cancel(job.id)
    return result
  })
  route('POST', /^\/api\/studio\/generate$/, async ({ req }) => jobs.start(await ctx.http.body(req)))
  route('POST', /^\/api\/studio\/cancel$/, async ({ req }) => { await jobs.cancel((await ctx.http.body(req)).id); return { ok: true } })
  route('POST', /^\/api\/studio\/config$/, async ({ req }) => config.save(await ctx.http.body(req)))
  route('POST', /^\/api\/studio\/upload$/, async ({ req }) => {
    const input = await uploadBody(req)
    if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(input.base64)) invalid('图片内容无效')
    return store.addImage(Buffer.from(input.base64, 'base64'), input.name)
  })
  route('POST', /^\/api\/studio\/import$/, async ({ req }) => {
    const { path } = await ctx.http.body(req)
    if (typeof path !== 'string' || !isAbsolute(path)) invalid('请提供用户指定图片的绝对路径')
    const info = await stat(path)
    if (!info.isFile() || info.size > 20 * 1024 * 1024) invalid('请提供小于 20 MB 的图片文件')
    return store.addImage(await readFile(path), basename(path))
  })
  route('GET', /^\/api\/studio\/inspect\/([a-f0-9-]{36})$/, async ({ match }) => ({ asset: store.read().assets[match[1]],
    image: { type: 'image', mimeType: 'image/webp', data: (await store.image(match[1], true)).toString('base64') } }))
  route('GET', /^\/api\/studio\/images\/([a-f0-9-]{36})\.(png|webp)$/, async ({ res, match }) => {
    const bytes = await store.image(match[1], match[2] === 'webp')
    res.writeHead(200, { 'Content-Type': match[2] === 'png' ? 'image/png' : 'image/webp', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes)
  })
}
