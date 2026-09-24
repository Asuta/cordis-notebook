export function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length > 1000) throw new Error('自由页面最多包含 1000 个文字块')
  const ids = new Set()
  const result = blocks.map(block => {
    if (!block || typeof block.id !== 'string' || !block.id || block.id.length > 100 || ids.has(block.id)) throw new Error('文字块 ID 无效或重复')
    ids.add(block.id)
    for (const key of ['x', 'y', 'width']) if (!Number.isFinite(block[key])) throw new Error('文字块坐标或宽度无效')
    if (block.x < 0 || block.y < 0 || block.x > 10000000 || block.y > 10000000 || block.width < 120 || block.width > 4000) throw new Error('文字块位置或宽度超出范围')
    if (typeof block.text !== 'string') throw new Error('文字块内容必须是文本')
    return { id: block.id, x: block.x, y: block.y, width: block.width, text: block.text }
  })
  if (blocksText(result).length > 200000) throw new Error('笔记内容过长')
  return result
}
export const blocksText = blocks => [...blocks].sort((a, b) => a.y - b.y || a.x - b.x).map(block => block.text).join('\n')

export const freeformFormat = {
  type: 'freeform', label: '自由页面', icon: '▧', editor: 'freeform', editorClass: 'is-freeform',
  fields: ['blocks'], defaults: () => ({ blocks: [] }),
  normalize: data => ({ blocks: normalizeBlocks(data.blocks) }),
  toText: data => blocksText(data.blocks),
}
