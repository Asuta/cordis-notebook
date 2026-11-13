import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/roleplay/plugins/chat/client.js'
import { demoProject, emptyMemory, normalizeSession } from '../applications/roleplay/plugins/chat/model.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settle = () => new Promise(resolve => setImmediate(resolve))

async function setup(t, { hangingStream = false, stream = true } = {}) {
  const window = new Window()
  const previous = Object.fromEntries(['window', 'document', 'Node', 'requestAnimationFrame'].map(key => [key, globalThis[key]]))
  Object.assign(globalThis, { window, document: window.document, Node: window.Node, requestAnimationFrame: callback => window.requestAnimationFrame(callback) })
  let project = demoProject()
  const now = new Date().toISOString()
  let session = normalizeSession({ id: 'session-one', revision: 0, title: '雨天初见', createdAt: now, updatedAt: now, messages: [{ id: 'greeting', role: 'assistant', content: project.character.greeting, createdAt: now }] }, project)
  const hooks = new Map(), agentTools = new Map(), cleanups = [], requests = []
  const gate = { entered: deferred(), wait: deferred() }
  let streamCalls = 0
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    mount: (_slot, node) => window.document.body.append(node),
    agent: { register: (definition, callback) => agentTools.set(definition.name, callback) },
    async stream(path, method, body, onEvent, signal) {
      streamCalls++
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
      if (path === '/api/roleplay/settings') return { protocol: 'chat', baseUrl: 'http://localhost/v1', model: 'local-test-model', hasApiKey: true, reasoningEffort: 'default', timeoutSeconds: 120, stream }
      if (path === '/api/roleplay/sessions') {
        if (method === 'POST') {
          session = normalizeSession({ ...session, id: 'new-story', revision: 0, title: body.title, messages: [{ id: 'new-greeting', role: 'assistant', content: project.character.greeting, createdAt: now }], player: body.player || structuredClone(project.player), opening: body.opening || structuredClone(project.opening), memory: emptyMemory() }, project)
          return structuredClone(session)
        }
        return [{ id: session.id, title: session.title }]
      }
      if (path.endsWith('/suggestions')) return { revision: session.revision, suggestions: ['「这张唱片有什么故事？」', '*走到窗边听雨。*', '「我也喜欢安静的地方。」'] }
      if (path.endsWith('/memory-draft')) return { revision: session.revision, memory: { summary: '一起听过唱片', scene: '窗边', relationship: '渐渐熟悉', facts: [{ id: 'promise', content: '约好周六见', enabled: true }] } }
      if (path.endsWith('/state')) {
        assert.equal(body.revision, session.revision)
        session = { ...session, ...structuredClone(body), revision: session.revision + 1 }
        return structuredClone(session)
      }
      if (path === '/api/roleplay/playtest') return { messages: [...body.messages, { id: 'trial-user', role: 'user', content: body.message, createdAt: now }, { id: 'trial-reply', role: 'assistant', content: '*她笑了笑。*「这是试聊回复。」', createdAt: now }] }
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
  return { window, root, hooks, gate, requests, click, input, streamCalls: () => streamCalls, project: () => project, call: (name, args = {}) => agentTools.get(name)(args) }
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

test('关闭流式输出后改用一次性请求并隐藏停止按钮', async t => {
  const f = await setup(t, { stream: false })
  f.input(f.root.querySelector('.rp-composer-input'), '你好')
  f.click('发送消息 →')
  await settle()
  const button = f.root.querySelector('.rp-send-button')
  assert.equal(button.textContent, '正在回复…')
  assert.equal(button.disabled, true)
  f.gate.wait.resolve()
  await settle()
  await settle()
  assert.equal(f.streamCalls(), 0, '关闭流式后不应调用流式接口')
  assert.ok(f.requests.some(request => request.path.endsWith('/reply')))
  const current = await f.call('roleplay_read')
  assert.equal(current.session.messages.length, 3)
  assert.equal(current.settings.stream, false)
})

test('接话灵感先填入草稿，由玩家修改后决定是否发送', async t => {
  const f = await setup(t)
  const before = (await f.call('roleplay_read')).session
  f.click('✧ 接话灵感')
  await settle(); await settle()
  assert.equal(f.root.querySelectorAll('.rp-suggestion').length, 3)
  f.root.querySelector('.rp-suggestion').click()
  assert.equal(f.root.querySelector('.rp-composer-input').value, '「这张唱片有什么故事？」')
  f.input(f.root.querySelector('.rp-composer-input'), '我想问自己的问题。')
  assert.equal(f.requests.some(request => request.path.endsWith('/reply')), false)
  assert.deepEqual((await f.call('roleplay_read')).session, before)
})

test('故事身份独立保存，AI候选记忆经确认才生效且可取消', async t => {
  const f = await setup(t)
  f.click('◈ 旅人')
  f.input(f.root.querySelector('[role="dialog"] input'), '阿舟')
  f.click('保存并生效')
  await settle(); await settle()
  assert.equal((await f.call('roleplay_read')).session.player.name, '阿舟')
  assert.equal(f.project().player.name, '旅人')
  const before = (await f.call('roleplay_read')).session
  f.click('≋ 剧情记忆')
  f.click('✧ 从对话整理候选记忆')
  await settle(); await settle()
  assert.equal(f.root.querySelector('.rp-memory-fields textarea').value, '一起听过唱片')
  assert.match(f.root.querySelector('.rp-dialog-intro').textContent, /尚未保存/)
  assert.deepEqual((await f.call('roleplay_read')).session, before)
  f.click('取消')
  assert.equal(f.root.querySelector('[role="dialog"]'), null)
  f.click('≋ 剧情记忆')
  assert.equal(f.root.querySelector('.rp-memory-fields textarea').value, '')
  f.click('✧ 从对话整理候选记忆')
  await settle(); await settle()
  f.input(f.root.querySelector('.rp-memory-fact textarea'), '约好下周六见')
  const enabled = f.root.querySelector('.rp-memory-fact input[type="checkbox"]')
  enabled.checked = false; enabled.dispatchEvent(new f.window.Event('change'))
  f.click('保存并生效')
  await settle(); await settle()
  const current = (await f.call('roleplay_read')).session
  assert.equal(current.memory.facts[0].content, '约好下周六见')
  assert.equal(current.memory.facts[0].enabled, false)
  assert.deepEqual(current.messages, before.messages)
  assert.equal(f.requests.filter(request => request.path.endsWith('/state')).length, 2)
})

test('编辑器实时预览与试聊使用当前草稿，正式故事保持独立', async t => {
  const f = await setup(t)
  const before = (await f.call('roleplay_read')).session
  f.click('人物卡')
  const name = [...f.root.querySelectorAll('.rp-editor-page .rp-field')].find(label => label.querySelector('.rp-label')?.textContent === '姓名').querySelector('input')
  f.input(name, '林小澄')
  assert.equal(f.root.querySelector('.rp-live-preview .rp-chat-heading strong').textContent, '林小澄')
  f.click('试聊')
  f.input(f.root.querySelector('.rp-live-preview .rp-composer-input'), '试试当前草稿')
  f.root.querySelector('.rp-live-preview .rp-send-button').click()
  await settle(); await settle()
  const trialRequest = f.requests.find(request => request.path === '/api/roleplay/playtest')
  assert.equal(trialRequest.body.project.character.name, '林小澄')
  assert.match(f.root.querySelector('.rp-live-preview .rp-messages').textContent, /这是试聊回复/)
  assert.equal(f.requests.some(request => /\/(reply|stream)$/.test(request.path)), false)
  assert.deepEqual((await f.call('roleplay_read')).session, before)
  f.click('重新试聊')
  assert.doesNotMatch(f.root.querySelector('.rp-live-preview .rp-messages').textContent, /这是试聊回复/)
})

test('新故事可选择独立身份和开场，移动导航可返回故事与记忆', async t => {
  const f = await setup(t)
  f.click('＋ 新故事')
  const panel = f.root.querySelector('[role="dialog"]')
  const control = label => [...panel.querySelectorAll('.rp-field')].find(node => node.querySelector('.rp-label')?.textContent === label).querySelector('input,textarea')
  f.input(control('玩家姓名'), '摄影师')
  f.input(control('章节标题'), '茶凉之前')
  f.click('进入故事 →')
  await settle(); await settle()
  const current = await f.call('roleplay_read')
  assert.equal(current.session.player.name, '摄影师')
  assert.equal(current.session.opening.title, '茶凉之前')
  assert.equal(f.project().player.name, '旅人')
  f.click('◈ 创作')
  assert.equal(f.root.dataset.view, 'edit')
  f.click('⚙ 设置')
  f.click('◈ 创作')
  assert.equal(f.root.querySelector('.rp-editor-heading h1').textContent, '人物卡', '访问设置后创作入口仍应回到上次创作页面')
  f.click('◉ 故事')
  assert.equal(f.root.dataset.view, 'play')
  f.click('打开导航')
  assert.ok(f.root.classList.contains('is-menu-open'))
  f.root.querySelector('.rp-session-button').click()
  await settle(); await settle()
  assert.equal(f.root.classList.contains('is-menu-open'), false, '打开故事后应收起导航抽屉')
  f.click('≋ 记忆')
  assert.equal(f.root.querySelector('[role="dialog"]').getAttribute('aria-label'), '剧情记忆')
  f.click('取消')
  f.click('打开导航')
  f.click('新建对话')
  assert.equal(f.root.classList.contains('is-menu-open'), false, '从抽屉打开弹窗时应先收起抽屉')
  assert.equal(f.root.querySelector('[role="dialog"]').getAttribute('aria-label'), '开始新的故事')
})

test('工作台Agent可分别编辑作品默认设定与当前故事，拒绝陈旧或越界写入', async t => {
  const f = await setup(t)
  let current = await f.call('roleplay_read')
  await f.call('roleplay_edit', { projectId: current.project.id, localVersion: current.localVersion, operations: [
    { type: 'set_player', patch: { name: '新故事默认玩家' } },
    { type: 'set_opening', patch: { title: '夜航' } },
    { type: 'set_presentation', patch: { theme: 'midnight' } },
  ] })
  current = await f.call('roleplay_read')
  assert.equal(current.project.player.name, '新故事默认玩家')
  assert.equal(current.project.opening.title, '夜航')
  assert.equal(current.project.presentation.theme, 'midnight')
  assert.equal(current.session.player.name, '旅人')
  const edit = { sessionId: current.session.id, revision: current.session.revision, patch: { memory: { ...emptyMemory(), summary: '已经一起听过雨声' } } }
  await f.call('roleplay_edit_session', edit)
  assert.equal((await f.call('roleplay_read')).session.memory.summary, '已经一起听过雨声')
  await assert.rejects(f.call('roleplay_edit_session', edit), /会话已变化/)
  current = await f.call('roleplay_read')
  await assert.rejects(f.call('roleplay_edit_session', { sessionId: current.session.id, revision: current.session.revision, patch: { apiKey: 'invalid' } }), /字段无效/)
  f.click('≋ 剧情记忆')
  await assert.rejects(f.call('roleplay_edit_session', { ...edit, revision: current.session.revision }), /正在编辑/)
})
