/** Applications may return one bounded image alongside their JSON result. */
export function appToolResult(result) {
  const image = result?.image
  if (!image || image.type !== 'image') return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || typeof image.data !== 'string' || image.data.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw Error('应用返回的预览图片格式或大小无效')
  const { image: ignored, ...text } = result
  return { content: [{ type: 'text', text: JSON.stringify(text) }, { type: 'image', mimeType: image.mimeType, data: image.data }], details: {} }
}
