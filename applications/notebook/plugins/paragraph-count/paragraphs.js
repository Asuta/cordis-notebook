/**
 * 段落统计按「源码空行分段」这一规则理解：
 * 一段由连续的非空白行组成，空行（可含空格或制表符）分隔段落。
 * 不用 note.content 的统一派生文本，因为它不保留空行或块结构。
 */

/** 统计非空段落数：空白正文为 0 段，LF 与 CRLF 都适用。 */
export function paragraphCount(source) {
  if (typeof source !== 'string') return 0
  let count = 0
  let inside = false
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === '') inside = false
    else if (!inside) {
      inside = true
      count += 1
    }
  }
  return count
}

/** 本插件支持的源码字段：plain 为 content，markdown 为 markdown；null 表示格式未支持。 */
export function paragraphSource(note) {
  if (!note) return null
  const type = note.type || 'plain'
  if (type === 'plain') return typeof note.content === 'string' ? note.content : ''
  if (type === 'markdown') return typeof note.markdown === 'string' ? note.markdown : ''
  return null
}

/** 供底栏渲染的状态摘要。 */
export function paragraphSummary(note) {
  if (!note) return { state: 'no-note', count: 0 }
  const source = paragraphSource(note)
  if (source === null) return { state: 'unsupported', count: 0 }
  const count = paragraphCount(source)
  return count > 0 ? { state: 'ready', count } : { state: 'empty', count: 0 }
}
