import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { renderMarkdown } from '../workbench/markdown.js'
import { createTurn, updateTurn, finalAnswer } from '../workbench/public/timeline.js'

test('每轮仅展示最终答复，过程默认收起且手动展开跨流式更新保留', () => {
  const window = new Window(), previous = globalThis.document, previousEvent = globalThis.CustomEvent
  globalThis.document = window.document; globalThis.CustomEvent = window.CustomEvent
  try {
    const element = createTurn(), turn = { id: 'one', status: 'running', startedAt: Date.now(), presentationVersion: 1, currentMessageId: 'final', events: [
      { id: 'progress', kind: 'text', text: '我先检查项目', messageId: 'first' },
      { id: 'tool', kind: 'tool', name: 'read', status: 'done' },
      { id: 'answer', kind: 'text', text: '**完成**', messageId: 'final' },
    ] }
    updateTurn(element, turn)
    const header = element.querySelector('.turn-header'), answer = element.querySelector('.turn-answer')
    assert.equal(header.getAttribute('aria-expanded'), 'false')
    assert.equal(element.querySelector('.turn-process').inert, true)
    assert.equal(answer.textContent.trim(), '完成')
    header.click()
    turn.status = 'done'; turn.finalAnswer = { text: '**完成**', eventIds: ['answer'] }
    updateTurn(element, turn)
    assert.equal(header.getAttribute('aria-expanded'), 'true')
    assert.equal(element._parts.events.get('progress').hidden, false)
    assert.equal(element._parts.events.get('answer').hidden, true)
    assert.equal(answer.querySelector('strong').textContent, '完成')
    const next = createTurn(); updateTurn(next, { ...turn, id: 'two', finalAnswer: { text: '第二轮完成', eventIds: [] } })
    assert.equal(answer.textContent.trim(), '完成')
    assert.equal(next.querySelector('.turn-answer').textContent.trim(), '第二轮完成')
    assert.equal(next.querySelector('.turn-header').getAttribute('aria-expanded'), 'false')
    turn.status = 'stopped'; updateTurn(element, turn)
    assert.equal(answer.hidden, true)
    assert.match(element.querySelector('.turn-notice').textContent, /已停止/)
  } finally { globalThis.document = previous; globalThis.CustomEvent = previousEvent; window.happyDOM.abort() }
})

test('旧记录匹配末条完整答复，工具前说明和失败输出不冒充最终答复', () => {
  const turn = { id: 'old', status: 'done', events: [
    { id: 'a', kind: 'text', text: '先检查' }, { id: 'b', kind: 'tool' },
    { id: 'c', kind: 'text', text: '修改' }, { id: 'd', kind: 'text', text: '完成' },
  ] }
  const messages = [{ role: 'assistant', turnId: 'old', text: '修改完成' }]
  assert.deepEqual(finalAnswer(turn, messages), { text: '修改完成', eventIds: ['c', 'd'] })
  assert.equal(finalAnswer({ ...turn, status: 'error' }, messages), null)
  assert.equal(finalAnswer({ ...turn, events: turn.events.slice(0, 2) }, messages), null)
  assert.equal(finalAnswer({ ...turn, presentationVersion: 1 }, messages), null)
})

test('Markdown 展示表格、列表、代码，阻止原始 HTML 和危险链接', () => {
  const html = renderMarkdown('## 标题\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- 项目\n\n```js\nconst a = 1\n```\n\n<script>alert(1)</script>\n\n[恶意](javascript:alert(1))\n\n![图片](https://example.com/tracker.png)')
  assert.match(html, /<h2>/); assert.match(html, /<table>/); assert.match(html, /<ul>/); assert.match(html, /language-js/)
  assert.equal(html.includes('<script>'), false); assert.equal(html.includes('href="javascript:'), false); assert.equal(html.includes('<img'), false)
})

test('流式更新保持工具展开和滚动位置，只重绘变化的正文', () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const element = createTurn(), turn = { id: 'one', status: 'running', startedAt: Date.now(), model: 'deepseek-flash', effort: 'low', events: [
      { id: 'read', kind: 'tool', name: 'read', status: 'running', startedAt: Date.now(), input: '{"path":"file.txt"}', output: '测试输出' },
      { id: 'text', kind: 'text', status: 'running', text: '## 第一步' },
    ] }
    updateTurn(element, turn)
    const detail = element.querySelector('details'), output = detail.querySelector('.trace-output'), text = element.querySelector('.trace-text')
    detail.open = true; output.scrollTop = 20
    turn.events[1].text += '\n\n更多内容'; updateTurn(element, turn)
    assert.equal(element.querySelector('details'), detail); assert.equal(detail.open, true); assert.equal(output.scrollTop, 20)
    assert.equal(element.querySelector('.trace-text'), text); assert.match(text.innerHTML, /<h2>/)
  } finally { globalThis.document = previous; window.happyDOM.abort() }
})
