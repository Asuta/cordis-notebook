import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { renderMarkdown } from '../workbench/markdown.js'
import { createTurn, updateTurn, finalAnswer, developmentStatus } from '../workbench/public/timeline.js'

test('模型请求显示首段等待与持续输出，保留没有计时的旧记录', async () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const element = createTurn(), turn = { status: 'done', startedAt: 100, endedAt: 4100, events: [
      { id: 'model', kind: 'model', name: '模型请求', status: 'done', startedAt: 100, endedAt: 4100,
        timing: { preparationMs: 100, responseWaitMs: 300, waitMs: 1200, streamingMs: 2700 } },
      { id: 'old-model', kind: 'model', status: 'done', startedAt: 100, endedAt: 4100 },
    ] }
    updateTurn(element, turn)
    assert.match(element.textContent, /首段等待 1.2 秒/); assert.match(element.textContent, /持续输出 2.7 秒/)
    assert.match(element.textContent, /响应头等待包含在首段等待中/); assert.doesNotMatch(element.textContent, /NaN|undefined/)
  } finally { globalThis.document = previous; await window.happyDOM.abort() }
})

test('浏览器验收区分用户关闭、未执行和失败，展示本地截图与报告', () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const element = createTurn(), turn = { status: 'done', startedAt: 1, events: [], browserVerification: { status: 'disabled' } }
    updateTurn(element, turn)
    const panel = element.querySelector('.browser-report')
    assert.match(panel.textContent, /用户关闭，未执行/)
    const id = '00000000-0000-0000-0000-000000000001'
    turn.browserVerification = { status: 'failed', errors: ['控件不可见'], reportUrl: `/api/browser-artifacts/${id}/report.json`, screenshots: [{ url: `/api/browser-artifacts/${id}/1.jpg` }, { url: 'https://example.com/tracker' }] }
    panel.open = true; updateTurn(element, turn)
    assert.equal(panel.open, true); assert.match(panel.textContent, /失败.*控件不可见/)
    assert.equal(panel.querySelectorAll('img').length, 1)
    assert.equal(panel.querySelectorAll('a').length, 2)
    turn.browserVerification = { status: 'incomplete', gaps: ['尚无成功断言'], steps: [{ errorKind: 'usage', error: '缺少 target' }] }
    updateTurn(element, turn)
    assert.match(panel.textContent, /未完成.*尚无成功断言.*1 次调用参数错误/)
    assert.match(panel.textContent, /未计为产品验收失败/)
  } finally { globalThis.document = previous; window.happyDOM.abort() }
})

test('热更新状态展示等待阶段和错误，尚未响应不能写成正在保存', () => {
  const waiting = developmentStatus({ blocked: { clients: [{ id: 'one-page', application: '笔记', phase: 'unresponsive', elapsedMs: 16000 },
    { id: 'two-page', application: '笔记', phase: 'saving', elapsedMs: 16000 }] } })
  assert.match(waiting.details, /one-page.*尚未响应.*16 秒/)
  assert.match(waiting.details, /two-page.*正在保存/); assert.equal(waiting.attention, true)
  const retrying = developmentStatus({ pending: true, blocked: null, saving: null })
  assert.equal(retrying.label, '正在处理更新'); assert.equal(retrying.details, '')
  const failed = developmentStatus({ saving: { status: 'failed', message: '磁盘写入失败', clients: [] } })
  assert.equal(failed.label, '热更新未完成'); assert.match(failed.details, /磁盘写入失败/)
})

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

test('Agent 回复结束后命令仍显示运行中，增量渲染保留卡片并可单独停止服务', async () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const element = createTurn(), turn = { id: 'turn', status: 'done', startedAt: Date.now(), endedAt: Date.now(), events: [] }
    const command = { session_id: 'session', command: 'node service.cjs', workdir: 'C:/project', background: true, status: 'running', startedAt: Date.now(), output: 'ready' }
    let stopped
    const options = { commands: [command], onTerminate: async id => { stopped = id } }
    updateTurn(element, turn, options)
    const card = element.querySelector('.command-session'); card.open = true
    assert.match(card.textContent, /后台服务/); assert.match(card.textContent, /运行中/)
    assert.equal(card.querySelector('button').hidden, false)
    command.output += '\nnext'; updateTurn(element, turn, options)
    assert.equal(element.querySelector('.command-session'), card); assert.equal(card.open, true)
    await card.querySelector('button').onclick(); assert.equal(stopped, 'session')
    command.status = 'terminated'; command.endedAt = Date.now(); updateTurn(element, turn, options)
    assert.match(card.textContent, /已终止/); assert.equal(card.querySelector('button').hidden, true)
  } finally { globalThis.document = previous; await window.happyDOM.abort() }
})

test('历史命令卡片替换原启动调用并按执行顺序排列，最终总结后不重复追加命令', async () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const turn = { status: 'done', startedAt: 10, events: [
      { id: 'thinking', kind: 'thinking', startedAt: 10, status: 'done', text: '准备搜索' },
      { id: 'launch-a', kind: 'tool', name: 'exec_command', startedAt: 20, status: 'done', output: '{"session_id":"a","status":"running"}' },
      { id: 'read', kind: 'tool', name: 'read', startedAt: 20, status: 'done' },
      { id: 'launch-b', kind: 'tool', name: 'workspace_build', startedAt: 30, status: 'done', output: '{"session_id":"b"}' },
      { id: 'poll', kind: 'tool', name: 'write_stdin', startedAt: 40, status: 'done', output: '{"session_id":"b"}' },
      { id: 'final', kind: 'text', startedAt: 50, status: 'done', text: '最终总结' },
    ] }
    const commands = [
      { session_id: 'b', command: 'node build.js', startedAt: 31, endedAt: 39, status: 'exited', exit_code: 0 },
      { session_id: 'a', command: 'rg --files', startedAt: 21, endedAt: 25, status: 'exited', exit_code: 0 },
    ]
    for (const element of [createTurn(), createTurn()]) { // New render and history replay use the same ordering.
      updateTurn(element, turn, { commands })
      const rows = [...element.querySelector('.trace-list').children]
      assert.equal(rows.length, 6)
      assert.match(rows[1].textContent, /rg --files/)
      assert.match(rows[2].textContent, /read/)
      assert.match(rows[3].textContent, /node build.js/)
      assert.match(rows[4].textContent, /write_stdin/)
      assert.equal(rows.at(-1).textContent.trim(), '最终总结')
      assert.equal(rows.at(-1).hidden, true)
      assert.equal(element.querySelector('.turn-answer').textContent.trim(), '最终总结')
      assert.equal(element.querySelector('.turn-header').getAttribute('aria-expanded'), 'false')
      assert.equal(element.querySelectorAll('.command-session').length, 2)
      assert.equal(element.querySelector('.command-list'), null)
    }
  } finally { globalThis.document = previous; await window.happyDOM.abort() }
})

test('命令快照先到、启动结果迟到及后台输出更新均保持顺序、展开状态和停止入口', async () => {
  const window = new Window(), previous = globalThis.document
  globalThis.document = window.document
  try {
    const element = createTurn(), launch = { id: 'launch', kind: 'tool', name: 'exec_command', startedAt: 20, status: 'running' }
    const turn = { status: 'running', startedAt: 10, events: [launch] }
    const command = { session_id: 'service', command: 'node server.js', background: true, status: 'running', startedAt: 21, output: 'ready' }
    let stopped
    const options = { commands: [command], onTerminate: async id => { stopped = id } }
    updateTurn(element, turn, options)
    const card = element.querySelector('.command-session'), output = card.querySelector('.trace-output')
    card.open = true; output.scrollTop = 20
    turn.events.push({ id: 'final', kind: 'text', startedAt: 30, status: 'done', text: '后台服务已启动' })
    turn.status = 'done'
    updateTurn(element, turn, options)
    assert.equal(element.querySelector('.trace-list').lastChild.textContent.trim(), '后台服务已启动')
    launch.output = '{"session_id":"service"}'; launch.status = 'done'; command.output += '\nstill running'
    updateTurn(element, turn, options)
    assert.equal(element.querySelectorAll('.trace-event').length, 1)
    assert.equal(element.querySelector('.command-session'), card); assert.equal(card.open, true)
    assert.equal(element.querySelector('.trace-list').lastChild.textContent.trim(), '后台服务已启动')
    assert.equal(card.querySelector('button').hidden, false)
    await card.querySelector('button').onclick(); assert.equal(stopped, 'service')
    command.status = 'terminated'; command.endedAt = 40; updateTurn(element, turn, options)
    assert.equal(element.querySelector('.trace-list').lastChild.textContent.trim(), '后台服务已启动')
    assert.equal(card.querySelector('button').hidden, true)
  } finally { globalThis.document = previous; await window.happyDOM.abort() }
})
