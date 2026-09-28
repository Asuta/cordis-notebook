import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'

export const IMAGE_LIMITS = { count: 10, fileBytes: 8 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, maxDimension: 8192 }
const fail = (status, message) => Object.assign(Error(message), { status })
const idPattern = /^[a-f0-9-]{36}$/
const mimeTypes = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }
export class AttachmentStore {
  constructor(dataDir) { this.dir = join(dataDir, 'attachments') }
  async upload(req) {
    let size = 0; const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > IMAGE_LIMITS.fileBytes) throw fail(413, '单张图片不能超过 8 MB')
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    let metadata
    try {
      const decoder = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' })
      metadata = await decoder.metadata()
      if (!mimeTypes[metadata.format] || !metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > IMAGE_LIMITS.maxDimension) throw Error('format')
      await decoder.stats() // Reject broken image bytes, not just a plausible header.
    } catch { throw fail(400, '图片无效：支持 PNG、JPEG、WebP、GIF，最长边 8192 像素，最多 4000 万像素') }
    const id = randomUUID(), image = { id, mimeType: mimeTypes[metadata.format], bytes: size, width: metadata.width, height: metadata.height }
    await mkdir(this.dir, { recursive: true })
    await writeFile(join(this.dir, id), buffer, { mode: 0o600 })
    await writeFile(join(this.dir, id + '.json'), JSON.stringify(image), { mode: 0o600 })
    return image
  }
  async get(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) throw fail(400, '图片附件标识无效')
    try { return JSON.parse(await readFile(join(this.dir, id + '.json'), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') throw fail(404, '图片附件不存在，请重新上传'); throw error }
  }
  async bytes(id) { await this.get(id); return readFile(join(this.dir, id)) }
  async remove(id) { await this.get(id); await unlink(join(this.dir, id)); await unlink(join(this.dir, id + '.json')) }
  async select(ids = []) {
    if (!Array.isArray(ids) || ids.length > IMAGE_LIMITS.count || new Set(ids).size !== ids.length) throw fail(400, '每条消息最多 10 张不同图片')
    const images = await Promise.all(ids.map(id => this.get(id)))
    if (images.reduce((sum, image) => sum + image.bytes, 0) > IMAGE_LIMITS.totalBytes) throw fail(413, '每条消息的图片总大小不能超过 20 MB')
    return images
  }
}
