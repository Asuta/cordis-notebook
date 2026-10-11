import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countParagraphs, paragraphSource, paragraphSummary } from '../paragraph.js'

test('按空行分段，只统计非空段落', () => {
  assert.equal(countParagraphs(''), 0)
  assert.equal(countParagraphs('   \n\t '), 0)
  assert.equal(countParagraphs('单段正文'), 1)
  assert.equal(countParagraphs('第一段\n第二行'), 1, '段内换行不算新段落')
  assert.equal(countParagraphs('第一段\n\n第二段'), 2)
  assert.equal(countParagraphs('第一段\r\n\r\n第二段\r\n'), 2, 'CRLF 空行同样分段')
})

test('连续空行与只含空白的行不会产生多余段落', () => {
  assert.equal(countParagraphs('a\n\n\n\nb'), 2)
  assert.equal(countParagraphs('a\n \n \nb'), 2)
  assert.equal(countParagraphs('\n\na\n\n'), 1, '首尾空行不计入')
  assert.equal(countParagraphs('a\n   \nb'), 2, '只含空白的行视为空行，仍然分段')
})

test('没有选中笔记与正文为空是两种清楚的空状态', () => {
  assert.deepEqual(paragraphSummary(undefined), { state: 'no-note', value: '未选择笔记', paragraphs: 0 })
  const blank = paragraphSummary({ content: ' \n\t ' })
  assert.equal(blank.state, 'empty')
  assert.equal(blank.value, '正文为空')
})

test('有正文时给出段落数与状态', () => {
  const summary = paragraphSummary({ content: '一\n\n二\n\n三' })
  assert.deepEqual(summary, { state: 'ready', value: '3 段', paragraphs: 3 })
})

test('Markdown 笔记用源码分段，不受派生正文单换行的限制', () => {
  // markdown 格式的 toText 会把段落用单换行连接，所以计数必须用 markdown 源码。
  const note = { type: 'markdown', markdown: '# 标题\n\n正文一\n\n正文二', content: '标题\n正文一\n正文二' }
  assert.equal(paragraphSource(note), '# 标题\n\n正文一\n\n正文二')
  assert.deepEqual(paragraphSummary(note), { state: 'ready', value: '3 段', paragraphs: 3 })
})

test('Markdown 笔记缺少源码时回退到派生正文', () => {
  assert.equal(paragraphSource({ type: 'markdown', content: 'a\n\nb' }), 'a\n\nb')
})

test('普通笔记的 content 字段直接计数', () => {
  const summary = paragraphSummary({ type: 'plain', content: '第一段\n\n第二段' })
  assert.equal(summary.paragraphs, 2)
})
