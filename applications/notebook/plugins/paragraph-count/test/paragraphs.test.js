import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paragraphCount, paragraphSource, paragraphSummary } from '../paragraphs.js'

test('按空行分段统计非空段落', () => {
  assert.equal(paragraphCount('# 标题\n\n正文一\n\n正文二'), 3)
  assert.equal(paragraphCount('- 项目一\n- 项目二'), 1, '没有空行的一段列表算 1 段')
  assert.equal(paragraphCount('第一段\n\n第二段'), 2)
})

test('空行可以含空格或制表符，连续空行不额外计数', () => {
  assert.equal(paragraphCount('甲\n   \n乙'), 2)
  assert.equal(paragraphCount('甲\n\t\n \n乙'), 2)
  assert.equal(paragraphCount('甲\n\n\n\n乙'), 2)
})

test('CRLF 与 LF 结果一致，空白正文为 0 段', () => {
  assert.equal(paragraphCount('甲\r\n\r\n乙\r\n\r\n丙'), 3)
  assert.equal(paragraphCount(''), 0)
  assert.equal(paragraphCount('   \n\t\n \r\n'), 0)
})

test('首尾空格与换行不影响段落数', () => {
  assert.equal(paragraphCount('\n\n  甲  \n\n乙\n\n'), 2)
})

test('按格式选择源码：plain 用 content，markdown 用 markdown，其他格式未支持', () => {
  assert.equal(paragraphSource({ content: '甲\n\n乙' }), '甲\n\n乙')
  assert.equal(paragraphSource({ type: 'plain', content: '甲' }), '甲')
  assert.equal(paragraphSource({ type: 'markdown', markdown: '甲\n\n乙', content: '甲\n乙' }), '甲\n\n乙',
    '不使用 Markdown 的派生 content')
  assert.equal(paragraphSource({ type: 'markdown', markdown: '', content: '旧派生文本' }), '',
    'Markdown 源码为空时不回退 content')
  assert.equal(paragraphSource({ type: 'freeform', content: '甲\n\n乙', blocks: [] }), null)
  assert.equal(paragraphSource(undefined), null)
})

test('状态摘要区分未选择、空正文、未支持格式与就绪', () => {
  assert.deepEqual(paragraphSummary(undefined), { state: 'no-note', count: 0 })
  assert.deepEqual(paragraphSummary({ type: 'plain', content: '  \n\t' }), { state: 'empty', count: 0 })
  assert.deepEqual(paragraphSummary({ type: 'freeform', blocks: [] }), { state: 'unsupported', count: 0 })
  assert.deepEqual(paragraphSummary({ type: 'markdown', markdown: '甲\n\n乙' }), { state: 'ready', count: 2 })
})
