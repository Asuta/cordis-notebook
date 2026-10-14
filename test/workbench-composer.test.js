import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { Window } from 'happy-dom'

const bundle = await build({ entryPoints: ['workbench/public/app.js'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const html = (await readFile('workbench/public/index.html', 'utf8')).replace(/<script[\s\S]*?<\/script>/g, '')
const response = (value, ok = true) => ({ ok, json: async () => value })
async function fixture(t) {
  const window = new Window({ url: 'http://127.0.0.1:9999/chat', settings: { disableCSSFileLoading: true, disableIframePageLoading: true } })
  t.after(() => window.happyDOM.close())
  window.document.write(html)
  window.setInterval = () => 0
  window.EventSource = class {}
  window.Option = function (text, value) { const option = window.document.createElement('option'); option.textContent = text; option.value = value; return option }
  const calls = [], pending = [], removed = [], preferences = []
  let imageId = 0
  window.fetch = async (path, options = {}) => {
    const data = options.headers?.['Content-Type'] === 'application/json' ? JSON.parse(options.body) : undefined
    calls.push({ path, data })
    if (path === '/api/config') return response({ model: 'deepseek-flash', thinking: true, reasoningEffort: 'high', models: [{ id: 'deepseek-flash', name: 'Flash', images: true }], compaction: { threshold: 128000 } })
    if (path === '/api/state?summary=1') return response({ applications: [{ id: 'notebook', name: '笔记' }, { id: 'drawing', name: '画图', error: '清单解析失败' }], application: { online: false, logs: [] }, appUrl: 'http://127.0.0.1:9998', threads: [{ id: 'history', appId: 'notebook', title: '历史对话', messages: [], turns: [] }] })
    if (path.startsWith('/api/threads/')) return response({ id: 'history', appId: 'notebook', title: '历史对话', messages: [], turns: [], revision: 0, history: { before: 0, end: 0, total: 0 } })
    if (path === '/api/run' || path === '/api/compact') return new Promise(resolve => pending.push({ resolve, data }))
    if (path === '/api/thread-preferences') return new Promise(resolve => preferences.push({ resolve, data }))
    if (path === '/api/images') return response({ id: 'image-' + ++imageId, bytes: 10, width: 1, height: 1, mimeType: 'image/png' })
    if (path === '/api/images/remove') { removed.push(data.id); return response({ removed: true }) }
    throw Error('意外的请求：' + path)
  }
  await window.eval('(async () => {' + bundle.outputFiles[0].text + '\n})()')
  const $ = id => window.document.getElementById(id)
  const type = text => { $('prompt').value = text; $('prompt').dispatchEvent(new window.Event('input')) }
  const send = () => $('composer').onsubmit({ preventDefault() {} })
  const finish = (ok = true) => pending.at(-1).resolve(response(ok ? { id: 'sent', appId: pending.at(-1).data.appId, title: '已发送', messages: [{ role: 'user', text: pending.at(-1).data.prompt }], turns: [], revision: 1, running: false } : { error: '模拟发送失败' }, ok))
  const upload = async () => {
    const event = new window.Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [new window.File(['image'], 'test.png', { type: 'image/png' })] } })
    $('chat').dispatchEvent(event)
    await new Promise(resolve => setImmediate(resolve))
  }
  return { window, $, type, send, finish, upload, calls, pending, removed, preferences }
}

test('输入区和设置页只有 Flash，图片直接发送并保留思考强度', async t => {
  const { $, type, send, finish, upload, pending } = await fixture(t)
  for (const id of ['model', 'compose-model']) {
    assert.deepEqual([...$(id).options].map(option => option.value), ['deepseek-flash'])
    assert.equal($(id).value, 'deepseek-flash')
  }
  assert.equal($('vision-hint'), null)
  assert.equal($('switch-flash'), null)
  $('compose-effort').value = 'max'
  await upload(); type('检查这张图片')
  assert.equal($('send').disabled, false)
  const sending = send()
  assert.equal(pending[0].data.model, 'deepseek-flash')
  assert.equal(pending[0].data.reasoningEffort, 'max')
  assert.equal(pending[0].data.images.length, 1)
  finish(); await sending
})

test('等待验收偏好保存时切换应用，仍发送原应用的消息和开关快照', async t => {
  const { $, type, send, finish, preferences, pending } = await fixture(t)
  $('threads').value = 'history'; $('threads').onchange()
  $('browser-verification').checked = true; $('browser-verification').onchange()
  type('原应用验收'); const sending = send()
  $('app-select').value = 'drawing'; $('app-select').onchange(); type('新应用草稿')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending.length, 0)
  preferences[0].resolve(response({ id: 'history', appId: 'notebook', title: '历史对话', browserVerificationEnabled: true, messages: [], turns: [], revision: 1 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pending[0].data.appId, 'notebook'); assert.equal(pending[0].data.threadId, 'history')
  assert.equal(pending[0].data.browserVerificationEnabled, true)
  finish(); await sending
  assert.equal($('prompt').value, '新应用草稿')
  assert.equal($('browser-verification').checked, false)
})

test('快速开关再开启时，旧响应不覆盖最新选择或发送快照', async t => {
  const { $, type, send, finish, preferences, pending } = await fixture(t)
  $('threads').value = 'history'; $('threads').onchange()
  for (const enabled of [true, false, true]) {
    $('browser-verification').checked = enabled; $('browser-verification').onchange()
  }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  const saved = index => preferences[index].resolve(response({ id: 'history', appId: 'notebook', title: '历史对话',
    browserVerificationEnabled: preferences[index].data.browserVerificationEnabled, messages: [], turns: [], revision: index + 1 }))
  await settle()
  saved(0); await settle()
  saved(1); await settle()
  assert.equal($('browser-verification').checked, true, '旧的关闭响应不能覆盖最后一次开启')
  type('按最后一次选择验收'); const sending = send()
  assert.equal(pending.length, 0, '发送等待最后一次偏好保存')
  saved(2); await settle()
  assert.equal($('browser-verification').checked, true)
  assert.equal(pending[0].data.browserVerificationEnabled, true)
  finish(); await sending
})

for (const destination of ['application', 'history', 'new']) test('发送响应不覆盖切换后的草稿：' + destination, async t => {
  const { window, $, type, send, finish } = await fixture(t)
  type('原笔记消息'); const sending = send()
  if (destination === 'application') { $('app-select').value = 'drawing'; $('app-select').onchange() }
  if (destination === 'history') { $('threads').value = 'history'; $('threads').onchange() }
  if (destination === 'new') $('new-thread').onclick()
  type('切换后的草稿'); finish(); await sending
  assert.equal($('prompt').value, '切换后的草稿')
  assert.equal(window.sessionStorage.getItem('agent-thread'), destination === 'history' ? 'history' : '')
  assert.equal($('messages').textContent.includes('原笔记消息'), false)
  if (destination === 'application') {
    assert.equal(window.sessionStorage.getItem('agent-app'), 'drawing')
    assert.match($('app-select').selectedOptions[0].textContent, /清单错误/)
    assert.equal($('app-select').selectedOptions[0].title, '清单解析失败')
  } else assert.ok([...$('threads').options].some(option => option.value === 'sent'))
})

test('同一对话发送期间继续输入和上传图片，响应只移除已发送附件', async t => {
  const { window, $, type, send, finish, upload } = await fixture(t)
  type('旧消息'); await upload(); const sending = send()
  type('下一条草稿'); await upload(); finish(); await sending
  assert.equal(window.sessionStorage.getItem('agent-thread'), 'sent')
  assert.equal($('prompt').value, '下一条草稿')
  const previews = $('image-previews').querySelectorAll('img')
  assert.equal(previews.length, 1); assert.match(previews[0].src, /image-2$/)
})

test('正常发送清空已发草稿；发送失败保留原草稿与图片', async t => {
  const { $, type, send, finish, upload, removed } = await fixture(t)
  type('成功消息'); const success = send(); finish(); await success
  assert.equal($('prompt').value, '')
  type('失败消息'); await upload(); const failure = send(); finish(false); await failure
  assert.equal($('prompt').value, '失败消息')
  assert.equal($('image-previews').querySelectorAll('img').length, 1)
  assert.deepEqual(removed, [])
})

for (const ok of [true, false]) test('切换页面不提前删除发送中的图片，失败才清理遗留附件：' + ok, async t => {
  const { $, type, send, finish, upload, removed } = await fixture(t)
  type('图片消息'); await upload(); const sending = send()
  $('app-select').value = 'drawing'; $('app-select').onchange()
  assert.deepEqual(removed, [])
  finish(ok); await sending
  assert.deepEqual(removed, ok ? [] : ['image-1'])
})
