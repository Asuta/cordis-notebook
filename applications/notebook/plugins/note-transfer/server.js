import { assetReferences, maxBackupBytes, readBackup } from './backup.js'
import MarkdownIt from 'markdown-it'
const fail = message => Object.assign(Error(message), { status: 400 })
const markdown = new MarkdownIt({ html: false })
const references = value => assetReferences(value, source => {
  const images = [], stack = [...markdown.parse(source, {})]
  while (stack.length) {
    const token = stack.pop()
    if (token.type === 'image') images.push(token.attrGet('src'))
    if (token.type === 'link_open') images.push(token.attrGet('href'))
    if (token.children) stack.push(...token.children)
  }
  return images
})
export default { inject: ['http', 'notes', 'noteAssets'], apply(ctx) {
  ctx.http.route(ctx, 'GET', /^\/api\/notebook-backup$/, async () => {
    const notes = ctx.notes.list()
    if (!notes.length) throw fail('还没有可备份的笔记')
    if (notes.length > 1000) throw fail('一次最多备份 1000 篇笔记')
    const result = { format: 'cordis-notebook-backup', version: 1, createdAt: new Date().toISOString(), notes, assets: [] }
    let bytes = Buffer.byteLength(JSON.stringify(result))
    for (const src of references(notes)) {
      const asset = await ctx.noteAssets.read(src)
      ctx.noteAssets.validate(asset.data, src)
      bytes += Buffer.byteLength(JSON.stringify(asset)) + 1
      if (bytes > maxBackupBytes) throw fail('备份超过 32 MB，请减少笔记或图片后重试')
      result.assets.push(asset)
    }
    if (bytes > maxBackupBytes) throw fail('备份超过 32 MB')
    return result
  })
  ctx.http.route(ctx, 'POST', /^\/api\/notebook-restore$/, async ({ req }) => {
    // Only this bulk endpoint accepts a larger body; normal note/image APIs
    // retain their existing limits and the host's same-origin/session guards.
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > maxBackupBytes) throw Object.assign(Error('备份不能超过 32 MB'), { status: 413 }); chunks.push(chunk) }
    let input; try { input = readBackup(JSON.parse(Buffer.concat(chunks).toString())) } catch (error) { throw fail(error.message) }
    const bySrc = new Map()
    for (const asset of input.assets) {
      if (!asset || typeof asset.src !== 'string' || bySrc.has(asset.src)) throw fail('备份图片地址无效或重复')
      ctx.noteAssets.validate(asset.data, asset.src); bySrc.set(asset.src, asset)
    }
    const refs = references(input.notes)
    for (const src of refs) if (!bySrc.has(src)) {
      if (!input.legacy) throw fail('备份缺少本地图片：' + src)
      await ctx.noteAssets.read(src) // Old JSON restores only when its images still exist locally.
    }
    if ([...bySrc.keys()].some(src => !refs.includes(src))) throw fail('备份包含未被笔记引用的图片')
    const notes = await ctx.notes.importMany(input.notes, async () => {
      for (const asset of bySrc.values()) await ctx.noteAssets.write(asset.data, asset.src)
    })
    return { notes, restored: notes.length }
  })
} }
