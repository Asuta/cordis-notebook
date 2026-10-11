import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  countReadableCharacters,
  DEFAULT_CHARS_PER_MINUTE,
  estimateReadingMinutes,
  formatReadingTime,
  readingSummary,
} from '../reading.js'

test('非空白字符计数忽略空白与换行，按码点计算表情', () => {
  assert.equal(DEFAULT_CHARS_PER_MINUTE, 300)
  assert.equal(countReadableCharacters(''), 0)
  assert.equal(countReadableCharacters('   \n\t '), 0)
  assert.equal(countReadableCharacters('abc def'), 6)
  assert.equal(countReadableCharacters('你好 世界\n'), 4)
  assert.equal(countReadableCharacters('全角\u3000空格'), 4, '全角空格也不算字符')
  assert.equal(countReadableCharacters('📖📖'), 2, '码点计数，不拆分代理对')
  assert.equal(countReadableCharacters(undefined), 0, '非字符串输入按空处理')
})

test('按每分钟字符数向上取整，非空正文至少 1 分钟', () => {
  assert.equal(estimateReadingMinutes(0), 0)
  assert.equal(estimateReadingMinutes(1), 1)
  assert.equal(estimateReadingMinutes(300), 1)
  assert.equal(estimateReadingMinutes(301), 2)
  assert.equal(estimateReadingMinutes(900, 100), 9)
  assert.equal(estimateReadingMinutes(250, 100), 3)
  assert.equal(estimateReadingMinutes(50, 0), 1, '非法速率回退到默认值')
  assert.equal(estimateReadingMinutes(50, Number.NaN), 1)
})

test('分钟数以中文可读形式展示，超过一小时显示小时', () => {
  assert.equal(formatReadingTime(1), '约 1 分钟')
  assert.equal(formatReadingTime(59), '约 59 分钟')
  assert.equal(formatReadingTime(60), '约 1 小时')
  assert.equal(formatReadingTime(90), '约 1 小时 30 分钟')
  assert.equal(formatReadingTime(0), '约 0 分钟')
  assert.equal(formatReadingTime(-5), '约 0 分钟')
})

test('没有选中笔记与正文为空是两种清楚的空状态', () => {
  assert.deepEqual(readingSummary(undefined), { state: 'no-note', value: '未选择笔记', minutes: 0, characters: 0 })
  const blank = readingSummary({ content: ' \n\t ' })
  assert.equal(blank.state, 'empty')
  assert.equal(blank.value, '正文为空')
})

test('有正文时给出预计分钟数与非空白字符数', () => {
  const summary = readingSummary({ content: 'x'.repeat(900) })
  assert.deepEqual(summary, { state: 'ready', value: '约 3 分钟', minutes: 3, characters: 900 })
})

test('可为每篇笔记传入不同的阅读速率', () => {
  const note = { content: 'x'.repeat(500) }
  assert.equal(readingSummary(note).minutes, 2, '默认每分钟 300 个字符')
  assert.equal(readingSummary(note, 500).minutes, 1)
  assert.equal(readingSummary(note, 100).value, '约 5 分钟')
})

test('Markdown 笔记使用格式派生的纯文本正文', () => {
  // note.content 由 markdown 格式插件派生，标记已经去掉，这里模拟派生结果。
  const note = { type: 'markdown', markdown: '# 标题\n\n正文内容', content: '标题\n正文内容' }
  const summary = readingSummary(note)
  assert.equal(summary.state, 'ready')
  assert.equal(summary.characters, 6)
})
