import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createStudioController } from '../controller.js'

test('编辑器消息桥核对来源、保存未保存绑定、缓存快照并在重建后重新发布', async t => {
  const window = new Window({ url: 'http://localhost/' }), globals = new Map()
  for (const name of ['window', 'location']) { globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window.location }) }
  let count = 0, localVersion = 1, dirty = true, paused = false
  const controller = createStudioController(async () => ({ archiveId: (++count).toString().padStart(64, '0'), name: '模型', size: 1234 }))
  const frame = window.document.createElement('iframe'); window.document.body.append(frame)
  const send = (data, origin = window.location.origin, source = frame.contentWindow) => window.dispatchEvent(new window.MessageEvent('message', { data: { channel: 'narrative-mesh', ...data }, origin, source }))
  frame.contentWindow.postMessage = message => {
    if (paused) return
    queueMicrotask(() => {
      if (message.action === 'edit' && message.args.localVersion !== localVersion) { send({ requestId: message.requestId, error: '模型已改变，请重新读取' }); return }
      if (message.action === 'save') dirty = false
      send({ requestId: message.requestId, result: { projectName: 'avatar-1', localVersion, dirty } })
    })
  }
  t.after(async () => { controller.dispose(); await window.happyDOM.close(); for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] } })
  controller.attach(frame, { projectId: 'story-1', characterId: 'character-1', editorProject: 'avatar-1' })
  send({ state: { projectName: 'avatar-1', localVersion, dirty } }, 'http://evil.invalid')
  assert.equal(controller.snapshot().projectName, undefined)
  send({ state: { projectName: 'avatar-1', localVersion, dirty } })
  await assert.rejects(controller.command('edit', { localVersion: 0 }), /重新读取/)
  const project = { id: 'story-1', characters: [{ id: 'character-1' }] }
  await controller.flushInto(project); assert.equal(count, 1); assert.equal(project.characters[0].meshAvatar.size, 1234)
  await controller.flushInto(project); assert.equal(count, 1)
  send({ state: { projectName: 'avatar-1', localVersion, dirty: false, busy: true } })
  await assert.rejects(controller.flushInto(project), /正在处理/)
  send({ state: { projectName: 'avatar-1', localVersion, dirty: false, busy: false } })
  await controller.flushInto(project); assert.equal(count, 2, '分层重建不会改变绑定版本，也必须重新发布资源')
  paused = true
  const pending = controller.command('read'); await Promise.resolve(); controller.detach()
  await assert.rejects(pending, /已关闭/)
})
