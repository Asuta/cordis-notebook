import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countParagraphs, paragraphSummary } from '../paragraphs.js'

test('按空行分段统计非空段落', () => {
  assert.equal(countParagraphs('a'), 1)
  assert.equal(countParagraphs('a\nb'), 1, '单换行不分段')
  assert.equal(countParagraphs('- 项目一\n- 项目二'), 1)
  assert.equal(countParagraphs('a\n\nb'), 2)
  assert.equal(countParagraphs('a\n\n\n\nb'), 2, '连续空行仍只算一次分段')
  assert.equal(countParagraphs('# 标题\n\n正文一\n\n正文二'), 3)
})

test('空行可含空格或制表符，CRLF 与 LF 等价，首尾空行不影响计数', () => {
  assert.equal(countParagraphs('a\n  \nb'), 2)
  assert.equal(countParagraphs('a\n\t\nb'), 2)
  assert.equal(countParagraphs('a\r\n\r\nb'), 2)
  assert.equal(countParagraphs('\n\na\n\nb\n\n'), 2)
})

test('空白正文与非法输入都是 0 段', () => {
  assert.equal(countParagraphs(''), 0)
  assert.equal(countParagraphs('   \n\t\n  '), 0)
  assert.equal(countParagraphs('\r\n'), 0)
  assert.equal(countParagraphs(undefined), 0)
  assert.equal(countParagraphs(null), 0)
})

test('没有选中笔记时提示未选择', () => {
  assert.deepEqual(paragraphSummary(undefined), { state: 'no-note', value: '未选择笔记', paragraphs: 0 })
  assert.deepEqual(paragraphSummary(null), { state: 'no-note', value: '未选择笔记', paragraphs: 0 })
})

test('普通笔记按 content 统计，空正文提示为空', () => {
  assert.deepEqual(paragraphSummary({ type: 'plain', content: '一\n\n二' }), { state: 'ready', value: '2 段', paragraphs: 2 })
  // type 缺失按 plain 处理
  assert.deepEqual(paragraphSummary({ content: '一\n\n二\n\n三' }), { state: 'ready', value: '3 段', paragraphs: 3 })
  assert.deepEqual(paragraphSummary({ type: 'plain', content: '  \n\t' }), { state: 'empty', value: '正文为空', paragraphs: 0 })
  assert.deepEqual(paragraphSummary({ type: 'plain' }), { state: 'empty', value: '正文为空', paragraphs: 0 })
})

test('Markdown 用 markdown 源码，空源码不回退派生 content', () => {
  const note = { type: 'markdown', markdown: '# 标题\n\n正文', content: '标题 正文' }
  assert.deepEqual(paragraphSummary(note), { state: 'ready', value: '2 段', paragraphs: 2 })
  // 源码为空但派生 content 有内容时仍视为空正文
  assert.deepEqual(paragraphSummary({ type: 'markdown', markdown: '', content: '派生文本' }), { state: 'empty', value: '正文为空', paragraphs: 0 })
  assert.deepEqual(paragraphSummary({ type: 'markdown', content: '派生文本' }), { state: 'empty', value: '正文为空', paragraphs: 0 })
})

test('不支持的格式给出明确提示', () => {
  const summary = paragraphSummary({ type: 'freeform', blocks: [{ text: 'x' }], content: 'x' })
  assert.deepEqual(summary, { state: 'unsupported', value: '当前格式不支持段落计数', paragraphs: 0 })
})
