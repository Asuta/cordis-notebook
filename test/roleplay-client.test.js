import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/roleplay/plugins/chat/client.js'
import { demoProject } from '../applications/roleplay/plugins/chat/model.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settle = () => new Promise(resolve => setImmediate(resolve))

async function setup(t, { hangingStream = false } = {}) {
  const window = new Window()
  const previous = Object.fromEntries(['window', 'document', 'Node', 'requestAnimationFrame'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window, document: window.document, Node: window.Node, requestAnimationFrame: callback => window.requestAnimationFrame(callback) })
  let project = demoProject()
  const now = new Date().toISOString()
  let session = { id: 'session-one', revision: 0, title: '雨天初见', createdAt: now, updatedAt: now, messages: [{ id: 'greeting', role: 'assistant', content: project.character.greeting, createdAt: now }] }
  const hooks = new Map(), agentTools = new Map(), cleanups = [], requests = []
  const gate = { entered: deferred(), wait: deferred() }
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    mount: (_slot, node) => window.document.body.append(node),
    agent: { register: (definition, callback) => agentTools.set(definition.name, callback) },
    async stream(path, method, body, onEvent, signal) {
      if (hangingStream) {
        onEvent?.({ type: 'delta', text: '半句' })
        await new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(Error('已停止生成'), { name: 'AbortError' }))
          if (signal?.aborted) return abort()
          signal?.addEventListener('abort', abort, { once: true })
        })
      }
      const result = await sdk.request(path.replace(/\/stream$/, '') + '/reply', 'POST', { message: body.message, ...(body.images ? { images: body.images } : {}) })
      onEvent?.({ type: 'delta', text: '模拟回复' })
      return result
    },
    async request(path, method = 'GET', body) {
      requests.push({ path, method, body: structuredClone(body) })
      if (path === '/api/roleplay/project') {
        if (method === 'PUT') {
          assert.equal(body.revision, project.revision, '保存必须使用最新服务端版本')
          project = { ...structuredClone(body), revision: project.revision + 1 }
        }
        return structuredClone(project)
      }
      if (path === '/api/roleplay/settings') return { protocol: 'chat', baseUrl: 'http://localhost/v1', model: 'local-test-model', hasApiKey: true }
      if (path === '/api/roleplay/sessions') return [{ id: session.id, title: session.title }]
      if (path.endsWith('/reply')) {
        gate.entered.resolve()
        await gate.wait.promise
        session = { ...session, revision: session.revision + 1, messages: [...session.messages, { id: 'player', role: 'user', content: body.message, createdAt: now }, { id: 'reply', role: 'assistant', content: '模拟回复', createdAt: now }] }
      }
      if (path.startsWith('/api/roleplay/sessions/')) return structuredClone(session)
      throw Error('未预期的请求：' + path)
    },
  }
  t.after(async () => {
    gate.wait.resolve()
    for (const cleanup of cleanups.reverse()) await cleanup?.()
    Object.assign(globalThis, previous)
    await window.happyDOM.close()
  })
  await client(ctx, sdk)
  const root = window.document.querySelector('.rp-app')
  const click = label => { const node = [...root.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent.trim() === label); assert.ok(node, label); node.click() }
  const input = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input')) }
  return { window, root, hooks, gate, requests, click, input, project: () => project, call: (name, args = {}) => agentTools.get(name)(args) }
}

test('角色剧场 Agent 拒绝陈旧版本，合并手工草稿且不允许修改密钥', async t => {
  const f = await setup(t)
  assert.equal([...f.root.querySelectorAll('button')].some(button => button.textContent === '重新生成'), false)
  const before = await f.call('roleplay_read')
  f.click('人物卡')
  f.input(f.root.querySelector('.rp-editor-page input'), '手工修改的故事标题')
  const operations = [{ type: 'set_character', patch: { personality: '认真倾听，也会主动分享自己的想法。' } }]
  await assert.rejects(f.call('roleplay_edit', { projectId: before.project.id, localVersion: before.localVersion, operations }), /重新调用 roleplay_read/)
  const current = await f.call('roleplay_read')
  await f.call('roleplay_edit', { projectId: current.project.id, localVersion: current.localVersion, operations })
  assert.equal(f.project().title, '手工修改的故事标题')
  assert.equal(f.project().character.personality, operations[0].patch.personality)
  const updated = await f.call('roleplay_read')
  assert.equal(Object.hasOwn(updated.settings, 'apiKey'), false)
  await assert.rejects(f.call('roleplay_edit', { projectId: updated.project.id, localVersion: updated.localVersion, operations: [{ type: 'set_project', patch: { apiKey: 'invalid' } }] }), /未知操作或字段/)
  assert.equal(Object.hasOwn(f.project(), 'apiKey'), false)
})

test('角色剧场先保存设定再对话，锁定会话和 Agent 写入，热更新等待回复完成', async t => {
  const f = await setup(t)
  f.click('人物卡')
  f.input(f.root.querySelector('.rp-editor-page input'), '立即聊天前的新设定')
  f.click('对话')
  f.input(f.root.querySelector('.rp-composer-input'), '聊聊旧街吧。')
  f.click('发送消息 →')
  await f.gate.entered.promise
  assert.equal(f.project().title, '立即聊天前的新设定')
  const saveIndex = f.requests.findIndex(request => request.path.endsWith('/project') && request.method === 'PUT')
  const replyIndex = f.requests.findIndex(request => request.path.endsWith('/reply'))
  assert.ok(saveIndex >= 0 && saveIndex < replyIndex)
  assert.equal(f.root.querySelector('.rp-main').inert, false, '生成期间界面必须保留可点击的停止按钮')
  const stopButton = f.root.querySelector('.rp-send-button')
  assert.equal(stopButton.textContent, '■ 停止生成')
  assert.equal(stopButton.disabled, false)
  assert.ok([...f.root.querySelectorAll('.rp-sidebar button')].every(button => button.disabled))
  const current = await f.call('roleplay_read')
  await assert.rejects(f.call('roleplay_edit', { projectId: current.project.id, localVersion: current.localVersion, operations: [{ type: 'set_project', patch: { title: '不应在回复期间修改' } }] }), /正在处理对话/)
  let release, completed = false
  const stopping = f.hooks.get('plugins/before-stop')({ hold: callback => { release = callback } }).then(() => { completed = true })
  await settle()
  assert.equal(completed, false)
  f.gate.wait.resolve()
  await stopping
  await settle()
  assert.equal(f.root.inert, true)
  release()
  assert.equal(f.root.inert, false)
  assert.equal(f.root.querySelector('.rp-main').inert, false)
  assert.ok([...f.root.querySelectorAll('.rp-sidebar button')].every(button => !button.disabled))
  const after = await f.call('roleplay_read')
  assert.equal(after.session.messages.at(-1).content, '模拟回复')
  assert.equal(after.project.title, '立即聊天前的新设定')
})

test('角色剧场停止生成会取消请求、保留流式文本并还原草稿', async t => {
  const f = await setup(t, { hangingStream: true })
  f.input(f.root.querySelector('.rp-composer-input'), '讲一个很长的故事')
  f.click('发送消息 →')
  await settle()
  assert.equal(f.root.querySelector('.rp-stream-text')?.textContent, '半句')
  const stop = [...f.root.querySelectorAll('button')].find(button => button.textContent === '■ 停止生成')
  assert.ok(stop, '生成期间应显示停止按钮')
  stop.click()
  await settle()
  await settle()
  assert.equal(f.root.querySelector('.rp-composer-input').value, '讲一个很长的故事')
  assert.equal(f.root.querySelector('.rp-send-button').textContent, '发送消息 →')
  assert.equal(f.root.querySelector('.rp-stream-text'), null)
  const current = await f.call('roleplay_read')
  assert.equal(current.session.messages.length, 1, '停止后不应保存半截回复')
  assert.equal(current.session.messages[0].role, 'assistant')
})
