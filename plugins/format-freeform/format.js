export function normalizeBlocks(blocks, richText) {
  if (!Array.isArray(blocks) || blocks.length > 1000) throw new Error('自由页面最多包含 1000 个文字块')
  const ids = new Set()
  const result = blocks.map((block) => {
    if (!block || typeof block.id !== 'string' || !block.id || block.id.length > 100 || ids.has(block.id))
      throw new Error('文字块 ID 无效或重复')
    ids.add(block.id)
    for (const key of ['x', 'y', 'width']) if (!Number.isFinite(block[key])) throw new Error('文字块坐标或宽度无效')
    if (
      block.x < 0 ||
      block.y < 0 ||
      block.x > 10000000 ||
      block.y > 10000000 ||
      block.width < 120 ||
      block.width > 4000
    )
      throw new Error('文字块位置或宽度超出范围')
    if (block.outline) {
      if (!richText) throw new Error('富文本能力尚未启用')
      const outline = richText.normalize(block.outline)
      return { id: block.id, x: block.x, y: block.y, width: block.width, text: richText.text(outline), outline }
    }
    if (typeof block.text !== 'string') throw new Error('文字块内容必须是文本')
    return { id: block.id, x: block.x, y: block.y, width: block.width, text: block.text }
  })
  if (blocksText(result).length > 200000) throw new Error('笔记内容过长')
  // Keep a full normalized patch below the HTTP host's 2 MiB body limit.
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 1750000)
    throw new Error('页面格式数据过多，请拆分为多篇笔记')
  return result
}
export const blocksText = (blocks) =>
  [...blocks]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((block) => block.text)
    .join('\n')

export const createFreeformFormat = (richText) => ({
  type: 'freeform',
  label: '自由页面',
  icon: 'LayoutDashboard',
  editor: 'freeform',
  editorLayout: 'wide',
  fields: ['blocks', 'page', 'version'],
  defaults: () => ({ blocks: [], version: 2, page: { color: '#ffffff', rule: 'none' } }),
  normalize(data) {
    if (data.version != null && ![1, 2].includes(data.version)) throw new Error('自由页面版本不受支持')
    const page = data.page || {}
    return {
      blocks: normalizeBlocks(data.blocks, richText),
      version: 2,
      page: {
        color: /^#[a-f0-9]{6}$/i.test(page.color) ? page.color : '#ffffff',
        rule: ['none', 'lines', 'grid', 'dots'].includes(page.rule) ? page.rule : 'none',
      },
    }
  },
  toText: (data) => blocksText(data.blocks),
})
// Legacy plain-block callers do not need the rich-text service.
export const freeformFormat = createFreeformFormat()
