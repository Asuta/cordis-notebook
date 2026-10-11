/** 「阅读时长」的纯计算逻辑：不触碰 DOM，便于独立验证。 */

export const DEFAULT_CHARS_PER_MINUTE = 300

/** 与字数统计插件一致：只看非空白字符，按码点计数（表情等算一个字符）。 */
export function countReadableCharacters(content) {
  if (typeof content !== 'string' || !content) return 0
  return Array.from(content.replace(/\s/g, '')).length
}

/** 正文非空时至少给出 1 分钟，避免出现「约 0 分钟」。 */
export function estimateReadingMinutes(characters, charsPerMinute = DEFAULT_CHARS_PER_MINUTE) {
  const rate = Number.isFinite(charsPerMinute) && charsPerMinute > 0 ? charsPerMinute : DEFAULT_CHARS_PER_MINUTE
  return characters > 0 ? Math.max(1, Math.ceil(characters / rate)) : 0
}

export function formatReadingTime(minutes) {
  const total = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  if (total < 60) return `约 ${total} 分钟`
  const hours = Math.floor(total / 60), rest = total % 60
  return rest ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`
}

/**
 * 把当前笔记收敛成界面需要的状态。
 * note.content 由各格式插件派生：普通笔记是正文，Markdown 已去掉标记，自由页面是文字块文本。
 */
export function readingSummary(note, charsPerMinute = DEFAULT_CHARS_PER_MINUTE) {
  if (!note) return { state: 'no-note', value: '未选择笔记', minutes: 0, characters: 0 }
  const characters = countReadableCharacters(note.content)
  if (!characters) return { state: 'empty', value: '正文为空', minutes: 0, characters: 0 }
  const minutes = estimateReadingMinutes(characters, charsPerMinute)
  return { state: 'ready', value: formatReadingTime(minutes), minutes, characters }
}
