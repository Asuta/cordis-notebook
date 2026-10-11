/** 「段落计数」的纯计算逻辑：不触碰 DOM，便于独立验证。 */

/**
 * 按空行（只含空白的行）分段，只统计去空白后非空的段落。
 * 连续空行、行尾空格都不会产生空段落。
 */
export function countParagraphs(content) {
  if (typeof content !== 'string' || !content.trim()) return 0
  return content.split(/\n\s*\n/).filter(paragraph => paragraph.trim()).length
}

/**
 * 取用于分段的正文：Markdown 用源码保留段落之间的空行；
 * 其他格式（含普通笔记）用 note.content，即格式插件派生的正文。
 */
export function paragraphSource(note) {
  if (!note) return ''
  if (note.type === 'markdown') return typeof note.markdown === 'string' ? note.markdown : note.content
  return note.content
}

/**
 * 把当前笔记收敛成界面需要的状态。
 */
export function paragraphSummary(note) {
  if (!note) return { state: 'no-note', value: '未选择笔记', paragraphs: 0 }
  const paragraphs = countParagraphs(paragraphSource(note))
  if (!paragraphs) return { state: 'empty', value: '正文为空', paragraphs: 0 }
  return { state: 'ready', value: `${paragraphs} 段`, paragraphs }
}
