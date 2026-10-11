/** 「段落计数」的纯计算逻辑：不触碰 DOM，便于独立验证。 */

/** Markdown 源码字段与普通笔记的 content 不是同一份数据，按格式选择原文。 */
const SOURCE_FIELDS = { plain: 'content', markdown: 'markdown' }

/**
 * 按空行分段统计非空段落数。
 * 空行指只包含空格或制表符的行；CRLF 与 LF 均按换行处理；空白正文是 0 段。
 */
export function countParagraphs(source) {
  if (typeof source !== 'string' || !source) return 0
  let paragraphs = 0
  let inParagraph = false
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]*$/.test(line)) {
      inParagraph = false
      continue
    }
    if (!inParagraph) {
      paragraphs += 1
      inParagraph = true
    }
  }
  return paragraphs
}

/**
 * 把当前笔记收敛成界面需要的状态。
 * 普通笔记读 content，Markdown 读 markdown 源码（不回退派生 content），其他格式明确标记为不支持。
 */
export function paragraphSummary(note) {
  if (!note) return { state: 'no-note', value: '未选择笔记', paragraphs: 0 }
  const field = SOURCE_FIELDS[note.type || 'plain']
  if (!field) return { state: 'unsupported', value: '当前格式不支持段落计数', paragraphs: 0 }
  const paragraphs = countParagraphs(note[field])
  if (!paragraphs) return { state: 'empty', value: '正文为空', paragraphs: 0 }
  return { state: 'ready', value: `${paragraphs} 段`, paragraphs }
}
