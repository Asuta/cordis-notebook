import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute, extname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import sharp from 'sharp'
import { IMAGE_LIMITS } from './attachments.js'

const fail = (status, message) => Object.assign(Error(message), { status })
const inside = (root, file) => { const path = relative(root, file); return path && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path) }
const mimeTypes = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

// Local image URLs never expose arbitrary files or follow links outside the project.
export async function workspaceImage(root, path) {
  if (typeof path !== 'string' || !path || path.includes('\0')) throw fail(400, '图片路径无效')
  let file = path
  if (file.startsWith('file:')) {
    try { file = fileURLToPath(file) } catch { throw fail(400, '图片路径无效') }
  }
  if (!/\.(png|jpe?g|webp|gif)$/i.test(extname(file))) throw fail(400, '仅支持 PNG、JPEG、WebP、GIF 图片')
  const base = await realpath(root)
  const target = await realpath(resolve(base, file)).catch(() => { throw fail(404, '图片文件不存在') })
  if (!inside(base, target)) throw fail(403, '只能预览当前项目内的图片')
  const info = await stat(target)
  if (!info.isFile()) throw fail(400, '图片路径不是文件')
  if (info.size > IMAGE_LIMITS.fileBytes) throw fail(413, '图片预览不能超过 8 MB')
  const bytes = await readFile(target)
  let metadata
  try {
    metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata()
    if (!mimeTypes[metadata.format] || Math.max(metadata.width, metadata.height) > IMAGE_LIMITS.maxDimension) throw Error('format')
  } catch { throw fail(400, '图片文件无效') }
  return { bytes, mimeType: mimeTypes[metadata.format] }
}

export async function saveToolImages(store, content = []) {
  const images = [], errors = []
  for (const part of content.filter(part => part.type === 'image').slice(0, IMAGE_LIMITS.count)) {
    try {
      if (typeof part.data !== 'string' || part.data.length > Math.ceil(IMAGE_LIMITS.fileBytes / 3) * 4) throw Error('图片数据无效或超过 8 MB')
      images.push(await store.upload(Readable.from([Buffer.from(part.data, 'base64')])))
    } catch (error) { errors.push(error.message) }
  }
  return { images, errors }
}

// Recover images discarded by older workbench versions from Pi's original log.
export async function recoverToolImages(thread, dataDir, store) {
  const pending = new Map((thread.turns || []).flatMap(turn => turn.events || [])
    .filter(event => event.kind === 'tool' && !event.images && event.output?.includes('[工具返回图片]')).map(event => [event.id, event]))
  if (!pending.size || !thread.sessionFile) return false
  const base = await realpath(join(dataDir, 'pi')).catch(() => null)
  const file = await realpath(thread.sessionFile).catch(() => null)
  if (!base || !file || !inside(base, file)) return false
  const input = createReadStream(file), lines = createInterface({ input, crlfDelay: Infinity })
  let changed = false
  try {
    for await (const line of lines) {
      let message
      try { message = JSON.parse(line).message } catch { continue }
      const event = message?.role === 'toolResult' && pending.get(message.toolCallId)
      if (!event) continue
      const result = await saveToolImages(store, message.content)
      if (result.images.length) { event.images = result.images; changed = true }
      pending.delete(message.toolCallId)
      if (!pending.size) break
    }
  } finally { lines.close(); input.destroy() }
  return changed
}
