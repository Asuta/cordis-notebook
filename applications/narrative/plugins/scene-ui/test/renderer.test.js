import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { settle } from '../../project/test/helpers.js'
import { mountScene, applyLayout } from '../renderer.js'

test('两个聊天窗口实际提交到各自会话，按钮通过事件推进天数', async t => {
  const f = await setupScene(t), host = document.createElement('div')
  document.body.append(host)
  const view = mountScene(host, { scene: f.scene, engine: f.engine, ui: {} })
  t.after(() => view.dispose())
  await f.engine.play()
  const windows = host.querySelectorAll('.scene-chat')
  for (const [index, message] of ['第一窗口消息', '第二窗口消息'].entries()) {
    windows[index].querySelector('textarea').value = message
    windows[index].querySelector('form').dispatchEvent(new f.window.Event('submit', { cancelable: true }))
    await settle()
  }
  assert.match(windows[0].textContent, /第一窗口消息/)
  assert.doesNotMatch(windows[0].textContent, /第二窗口消息/)
  assert.match(windows[1].textContent, /第二窗口消息/)
  host.querySelector('[data-object-id="next-day"] button').click(); await settle()
  assert.equal(f.scene.runtime.state('day').value, 2)
  assert.equal(f.scene.runtime.state('relationship').value, 2)
  assert.deepEqual(f.toasts, [])
})

test('窄屏覆盖布局、叠层刷新与隐藏逻辑父对象保持正确', async t => {
  const f = await setupScene(t), host = document.createElement('div'), node = document.createElement('section')
  applyLayout(node, { mode: 'grid', columns: 2, compact: { mode: 'column' } }, false)
  assert.equal(node.style.gridTemplateColumns, 'repeat(2,minmax(0,1fr))')
  applyLayout(node, { mode: 'grid', columns: 2, compact: { mode: 'column' } }, true)
  assert.equal(node.style.flexDirection, 'column')
  assert.equal(node.style.gridTemplateColumns, '')
  f.scene.edit({ op: 'batch', commands: [
    { op: 'add', id: 'overlay', type: 'container', layout: { mode: 'overlay' } },
    { op: 'add', id: 'top', type: 'text', parent: 'overlay' },
    { op: 'add', id: 'logic', type: 'counter', parent: 'overlay' },
    { op: 'add', id: 'nested', type: 'text', parent: 'logic' },
  ] })
  document.body.append(host)
  const view = mountScene(host, { scene: f.scene, engine: f.engine, ui: {} }); t.after(() => view.dispose())
  assert.equal(host.querySelector('[data-object-id="top"]').style.gridArea, '1 / 1')
  view.refresh(); assert.equal(host.querySelector('[data-object-id="top"]').style.gridArea, '1 / 1')
  assert.equal(host.querySelector('[data-object-id="nested"]').parentElement.dataset.objectId, 'overlay')
  await f.engine.play(); f.scene.runtime.setFlags('logic', { visible: false })
  assert.equal(host.querySelector('[data-object-id="nested"]').style.display, 'none')
})

test('取消按钮中止请求、保留草稿，并且不把正常取消显示成运行错误', async t => {
  const f = await setupScene(t), host = document.createElement('div')
  const props = f.scene.expanded().objects.find(o => o.id === 'lin-session').props
  f.scene.edit({ op: 'patch', id: 'lin-session', patch: { props: { ...props, source: 'ai' } } })
  f.scene.provide(f.typeOwner, 'ai', { reply: (_, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
  document.body.append(host)
  const view = mountScene(host, { scene: f.scene, engine: f.engine, ui: {} }); t.after(() => view.dispose())
  await f.engine.play()
  const chat = host.querySelector('[data-object-id="lin-window"]'), input = chat.querySelector('textarea')
  input.value = '取消后继续编辑这句话'
  chat.querySelector('form').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
  const cancel = Array.from(chat.querySelectorAll('button')).find(b => b.textContent === '取消回复')
  assert.equal(cancel.hidden, false); cancel.click(); await settle()
  assert.equal(input.value, '取消后继续编辑这句话')
  assert.equal(input.disabled, false)
  assert.equal(cancel.hidden, true)
  assert.equal(f.engine.runtime.error, '')
  assert.deepEqual(f.scene.runtime.state('lin-session').messages, [])
  assert.deepEqual(f.toasts, [])
})
