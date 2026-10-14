import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const fail = (message, status = 400) => Object.assign(Error(message), { status })
export const fileLimit = 16 * 1024 * 1024
export const filePattern = /^\/api\/note-files\/([a-f0-9]{64}\.(pdf|mp4|webm|mp3|ogg|wav|bin))$/
const mime = { pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', bin: 'application/octet-stream' }
export function decodeFile(data, extension = 'bin', expected) {
  if (!Object.hasOwn(mime, extension) || typeof data !== 'string' || data.length > Math.ceil(fileLimit / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw fail('附件类型无效或超过 16 MB')
  const bytes = Buffer.from(data, 'base64')
  if (!bytes.length || bytes.length > fileLimit || bytes.toString('base64') !== data) throw fail('附件内容无效或超过 16 MB')
  const header = bytes.subarray(0, 16)
  const valid = extension === 'bin'
    || extension === 'pdf' && header.subarray(0, 5).toString() === '%PDF-'
    || extension === 'mp4' && header.subarray(4, 8).toString() === 'ftyp'
    || extension === 'webm' && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    || extension === 'mp3' && (header.subarray(0, 3).toString() === 'ID3' || header[0] === 255 && (header[1] & 0xe0) === 0xe0)
    || extension === 'ogg' && header.subarray(0, 4).toString() === 'OggS'
    || extension === 'wav' && header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE'
  if (!valid) throw fail('文件内容与所选格式不匹配')
  const name = createHash('sha256').update(bytes).digest('hex') + '.' + extension, src = '/api/note-files/' + name
  if (expected !== undefined && expected !== src) throw fail('附件校验失败：地址与内容哈希不一致')
  return { bytes, name, src }
}
export function createFiles(ctx, dir) {
  const read = async src => {
    const match = filePattern.exec(src)
    if (!match) throw fail('附件地址无效')
    try { return { bytes: await readFile(join(dir, match[1])), extension: match[2] } }
    catch (error) { if (error.code === 'ENOENT') throw fail('附件不存在', 404); throw error }
  }
  const write = async (data, extension, expected) => {
    const decoded = decodeFile(data, extension, expected)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, decoded.name), decoded.bytes, { flag: 'wx' }).catch(async error => {
      if (error.code !== 'EEXIST') throw error
      if (!(await readFile(join(dir, decoded.name))).equals(decoded.bytes)) throw fail('本地附件损坏，原文件已保留', 409)
    })
    return { src: decoded.src }
  }
  ctx.http.route(ctx, 'POST', /^\/api\/note-files$/, async ({ req }) => {
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > Math.ceil(fileLimit / 3) * 4 + 1024) throw fail('附件不能超过 16 MB', 413); chunks.push(chunk) }
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw fail('附件请求格式无效') }
    return write(body?.data, body?.extension)
  })
  for (const method of ['GET', 'HEAD']) ctx.http.route(ctx, method, filePattern, async ({ req, res, match }) => {
    const { bytes, extension } = await read('/api/note-files/' + match[1])
    const headers = { 'Content-Type': mime[extension], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'bytes',
      ...(extension === 'bin' ? { 'Content-Disposition': 'attachment' } : {}) }
    let start = 0, end = bytes.length - 1
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
      if (!range || !range[1] && !range[2]) { res.writeHead(416, { 'Content-Range': 'bytes */' + bytes.length }); res.end(); return }
      start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]))
      end = range[1] && range[2] ? Math.min(Number(range[2]), end) : end
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) { res.writeHead(416, { 'Content-Range': 'bytes */' + bytes.length }); res.end(); return }
      headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + bytes.length
    }
    res.writeHead(req.headers.range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 })
    res.end(method === 'HEAD' ? undefined : bytes.subarray(start, end + 1))
  })
  return { read, write }
}
