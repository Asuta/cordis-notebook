import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Window } from 'happy-dom'
import { createWorkbench } from '../workbench/server.js'
import { createTurn, updateTurn } from '../workbench/public/timeline.js'

test('真实 Pi 输出达到长度限制后保留正文和截断提示，重启后仍可显示', { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-truncation-'))
  const replies = [
    { text: '这是被截断前已经生成的**有效答复**。', reason: 'length' },
    { text: '这是下一轮完整答复。', reason: 'stop' },
    { text: '', reason: 'length' },
  ]
  let requests = 0, wb, window
  const previousDocument = globalThis.document
  const endpoint = createServer(async (req, res) => {
    for await (const chunk of req) {}
    const reply = replies[requests++]
    if (!reply) { res.writeHead(500); res.end('意外的模型重试'); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const payload of [
      { choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: reply.reason }], usage: { prompt_tokens: 100, completion_tokens: reply.reason === 'length' ? 16384 : 20, total_tokens: reply.reason === 'length' ? 16484 : 120 } },
    ]) res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'fixture', ...payload }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  try {
    await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve))
    await writeFile(join(dir, 'config.json'), JSON.stringify({
      apiKey: 'fixture-only', baseUrl: `http://127.0.0.1:${endpoint.address().port}/v1`, model: 'fixture', thinking: false, compaction: { enabled: false },
    }))
    const options = { root: resolve('.'), port: 0, appPort: 0, dataDir: dir, autoStart: false }
    wb = await createWorkbench(options)
    let url = `http://127.0.0.1:${wb.server.address().port}`, threadId
    const completed = async () => {
      let state
      for (let i = 0; i < 600; i++) {
        state = await (await fetch(url + '/api/state')).json()
        if (!state.activeThreadId) return state.threads.find(thread => thread.id === threadId)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw Error('等待模型结束超时：' + JSON.stringify({ requests, turn: state.threads.find(thread => thread.id === threadId)?.turns.at(-1) }))
    }
    const check = (thread, index) => {
      const turn = thread.turns[index], reply = replies[index]
      assert.equal(turn.status, 'done')
      assert.equal(turn.finalAnswer.text, reply.text)
      assert.equal(turn.finalAnswer.truncated, reply.reason === 'length')
      const element = createTurn(); updateTurn(element, turn, thread.messages)
      assert.equal(element._parts.answer.hidden, !reply.text)
      assert.equal(element._parts.notice.hidden, reply.reason !== 'length')
      if (reply.reason === 'length') assert.match(element._parts.notice.textContent, /单次输出长度限制/)
      if (reply.text) {
        assert.match(element._parts.answer.textContent, index === 0 ? /有效答复/ : /完整答复/)
        assert.ok(turn.finalAnswer.eventIds.length)
        for (const id of turn.finalAnswer.eventIds) assert.equal(element._parts.events.get(id).hidden, true)
      }
      assert.equal(element._parts.header.getAttribute('aria-expanded'), 'false')
    }
    window = new Window(); globalThis.document = window.document
    for (let index = 0; index < replies.length; index++) {
      const response = await fetch(url + '/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'notebook', threadId, prompt: index ? '继续' : '生成长答复' }),
      })
      assert.equal(response.status, 200)
      threadId = (await response.json()).id
      const thread = await completed()
      for (let previous = 0; previous <= index; previous++) check(thread, previous)
    }
    assert.equal(requests, replies.length)
    await wb.close(); wb = null
    wb = await createWorkbench(options)
    url = `http://127.0.0.1:${wb.server.address().port}`
    const restored = await completed()
    for (let index = 0; index < replies.length; index++) check(restored, index)
  } finally {
    globalThis.document = previousDocument
    await window?.happyDOM.close()
    await wb?.close()
    endpoint.closeAllConnections(); await new Promise(resolve => endpoint.close(resolve))
    await rm(dir, { recursive: true, force: true })
  }
})
