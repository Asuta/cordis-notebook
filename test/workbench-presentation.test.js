import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { renderMarkdown } from '../workbench/markdown.js'
import { createTurn, updateTurn } from '../workbench/public/timeline.js'

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
