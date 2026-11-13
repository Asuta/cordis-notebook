export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function matchesImageType(url, mime) {
  const prefix = `data:${mime};base64,`
  if (!url.startsWith(prefix)) return false
  let bytes
  try { bytes = Array.from(atob(url.slice(prefix.length, prefix.length + 48)), char => char.charCodeAt(0)) } catch { return false }
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
}

/** 读取、校验签名并实际解码图片；中止后不会留下读取或图片监听。 */
export async function readImageFile(file, { signal } = {}) {
  if (!file || !TYPES.has(file.type)) throw Error('请选择 PNG、JPEG 或 WebP 图片。')
  if (!file.size) throw Error('图片文件为空，请重新选择。')
  if (file.size > MAX_IMAGE_BYTES) throw Error('图片不能超过 5 MB。')
  if (signal?.aborted) throw new DOMException('图片读取已取消', 'AbortError')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let image, settled = false
    const finish = (error, url) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      reader.onload = reader.onerror = reader.onabort = null
      if (image) { image.onload = image.onerror = null; image.removeAttribute('src') }
      if (error) reject(error)
      else resolve(url)
    }
    const abort = () => {
      finish(new DOMException('图片读取已取消', 'AbortError'))
      if (reader.readyState === 1) reader.abort()
    }
    reader.onerror = () => finish(Error('图片读取失败，请重新选择。'))
    reader.onabort = () => finish(new DOMException('图片读取已取消', 'AbortError'))
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      if (!matchesImageType(url, file.type)) { finish(Error('图片内容与文件类型不符，请选择有效图片。')); return }
      image = new Image()
      image.onload = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) finish(null, url)
        else finish(Error('图片无法解码，请选择有效图片。'))
      }
      image.onerror = () => finish(Error('图片无法解码，请选择有效图片。'))
      image.src = url
    }
    signal?.addEventListener('abort', abort, { once: true })
    try { reader.readAsDataURL(file) } catch { finish(Error('图片读取失败，请重新选择。')) }
  })
}
