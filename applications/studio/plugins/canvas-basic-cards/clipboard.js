const IMAGE_TYPE = /^image\/(png|jpeg|webp)$/i
const IMAGE_NAME = /\.(png|jpe?g|webp)$/i
const MAX_SOURCE = 30 * 1024 * 1024
const DEFAULT_NAME = '粘贴的图片'

const extension = type => type === 'image/jpeg' ? 'jpg' : type.split('/')[1]

function imageFile(file) {
  if (!file || typeof file.size !== 'number' || !file.size) return null
  if (IMAGE_TYPE.test(file.type)) return file
  return !file.type && IMAGE_NAME.test(file.name || '') ? file : null
}

/** 把 HTML/text 中常见的 data URL 还原成可上传的图片文件。 */
export function dataUrlFile(source, name = DEFAULT_NAME) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE) return null
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=\s]+)$/i.exec(source.trim())
  if (!match) return null
  try {
    const binary = atob(match[2].replace(/\s+/g, ''))
    if (!binary.length) return null
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    const type = match[1].toLowerCase()
    return new File([bytes], `${name}.${extension(type)}`, { type })
  } catch { return null }
}

/**
 * 收集系统剪贴板中的图片：优先文件项，其次富文本里的 data URL，
 * 最后是纯文本形式的 data URL。非图片内容返回空数组，交给页面默认粘贴。
 */
export function clipboardImages(data) {
  if (!data) return []
  const files = []
  const add = file => {
    const image = imageFile(file)
    if (!image) return
    files.push(image)
  }
  for (const file of data.files || []) add(file)
  if (files.length) return files
  for (const item of data.items || []) if (item?.kind === 'file') add(item.getAsFile())
  if (files.length) return files

  const getData = type => { try { return data.getData?.(type) || '' } catch { return '' } }
  const html = getData('text/html')
  if (html && typeof DOMParser === 'function') {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const sources = [...new Set([...document.querySelectorAll('img[src]')]
      .map(image => image.getAttribute('src') || '')
      .filter(source => /^data:image\//i.test(source.trim())))]
    for (const [index, source] of sources.entries()) {
      const file = dataUrlFile(source, index ? `${DEFAULT_NAME} ${index + 1}` : DEFAULT_NAME)
      if (file) add(file)
    }
    if (files.length) return files
  }
  const text = getData('text/plain').trim()
  if (/^data:image\//i.test(text)) {
    const file = dataUrlFile(text)
    if (file) add(file)
  }
  return files
}
