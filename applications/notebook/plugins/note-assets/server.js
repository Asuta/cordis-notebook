import { Service } from 'cordis'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
const types = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
function decode(data, expected) {
  if (typeof data !== 'string' || data.length > 1400000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw Object.assign(Error('图片不能超过 1 MB'), { status: 400 })
  const bytes = Buffer.from(data, 'base64')
  const type = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
    : /^GIF8[79]a/.test(bytes.subarray(0,6).toString()) ? 'gif'
    : bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP' ? 'webp' : null
  if (!type || bytes.length > 1048576 || bytes.toString('base64') !== data) throw Object.assign(Error('仅支持 1 MB 以内的 PNG、JPEG、GIF、WebP 图片'), { status: 400 })
  const name = createHash('sha256').update(bytes).digest('hex') + '.' + type, src = '/api/note-assets/' + name
  if (expected !== undefined && expected !== src) throw Object.assign(Error('备份图片校验失败：地址与内容哈希不一致'), { status: 400 })
  return { bytes, name, src, type }
}
export const noteAssets = {
  inject: ['http'],
  apply(ctx, config, runtime) {
    const dir = runtime.dataDir
    // New writes belong to this plugin. Keep old URLs readable without moving files
    // or asking the current note storage implementation for a filesystem path.
    const directories = [...new Set([
      dir,
      ...(runtime.legacyFile ? [join(dirname(resolve(runtime.legacyFile)), 'note-assets')] : []),
      join(runtime.appDataDir, 'note-assets'),
    ].map(path => resolve(path)))]
    const read = async src => {
      const match = /^\/api\/note-assets\/([a-f0-9]{64}\.(png|jpg|gif|webp))$/.exec(src)
      if (!match) throw Object.assign(Error('本地图片地址无效'), { status: 400 })
      for (const directory of directories) {
        try { return { bytes: await readFile(join(directory, match[1])), type: match[2] } }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      throw Object.assign(Error('图片不存在：' + match[1]), { status: 404 })
    }
    const write = async (data, expected) => {
      const { bytes, name, src } = decode(data, expected)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, name), bytes, { flag: 'wx' }).catch(async (e) => {
        if (e.code !== 'EEXIST') throw e
        if (!(await readFile(join(dir, name))).equals(bytes)) throw Object.assign(Error('已存在的本地图片损坏，原文件已保留：' + name), { status: 409 })
      })
      return { src }
    }
    Object.assign(new Service(ctx, 'noteAssets'), { directory: dir,
      validate: (data, src) => decode(data, src).src,
      read: async src => ({ src, data: (await read(src)).bytes.toString('base64') }), write,
    })
    ctx.http.route(ctx, 'POST', /^\/api\/note-assets$/, async ({ req }) => write((await ctx.http.body(req)).data))
    ctx.http.route(ctx, 'GET', /^\/api\/note-assets\/([a-f0-9]{64}\.(png|jpg|gif|webp))$/, async ({ res, match }) => {
      const { bytes } = await read('/api/note-assets/' + match[1])
      res.writeHead(200, {
        'Content-Type': types[match[2]],
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
      })
      res.end(bytes)
    })
  },
}
