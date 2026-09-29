import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createAgentBridge } from '../client/host/agent-bridge.js'
import { StopCoordinator } from '../client/host/stop-coordinator.js'
import agentTools, { revision } from '../applications/notebook/plugins/agent-tools/client.js'

test('选区桥接传递富文本能力并拒绝不支持的格式，失败可重试且成功后失效', async t => {
  const window = new Window(), sent = [], disposals = [], peer = { postMessage: message => sent.push(message) }
  Object.defineProperty(window, 'parent', { value: peer })
  const owner = { effect: fn => disposals.push(fn()) }
  const bridge = createAgentBridge({ application: { id: 'notebook' }, session: 's', window, document: window.document })
  t.after(async () => { bridge.dispose(); await window.happyDOM.close() })
  window.dispatchEvent(new window.MessageEvent('message', { source: peer, origin: 'http://127.0.0.1:3211', data: { channel: 'cordis-agent', type: 'connect' } }))
  const target = window.document.createElement('div'); window.document.body.append(target)
  let applied, reject = false, rich = true
  bridge.forOwner(owner).selection(target, () => ({
    text: '旧文', formats: rich ? ['text', 'richtext'] : ['text'], richText: { version: 1, elements: [] },
    apply: text => { applied = text },
    applyContent: value => { if (reject) throw Error('选区内容已变化'); applied = value },
  }))
  const capture = () => {
    target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true }))
    window.document.querySelector('button').click()
    return sent.at(-1).attachment
  }
  const attachment = capture(), content = { version: 1, elements: [{ kind: 'paragraph', runs: [{ text: '新文', format: { bold: true } }] }] }
  assert.deepEqual(attachment.formats, ['text', 'richtext'])
  assert.equal(attachment.richText.version, 1)
  await assert.rejects(bridge.call('replace_selection', { id: attachment.id, format: 'html', content }), /不支持/)
  reject = true
  await assert.rejects(bridge.call('replace_selection', { id: attachment.id, format: 'richtext', content }), /变化/)
  reject = false
  await bridge.call('replace_selection', { id: attachment.id, format: 'richtext', content })
  assert.deepEqual(applied, { format: 'richtext', content })
  await assert.rejects(bridge.call('replace_selection', { id: attachment.id, text: '重复' }), /过期/)
  rich = false
  const plain = capture()
  await assert.rejects(bridge.call('replace_selection', { id: plain.id, format: 'richtext', content }), /不支持/)
  await bridge.call('replace_selection', { id: plain.id, text: '<b>字面量</b>' })
  assert.equal(applied, '<b>字面量</b>')
  const disposed = capture(); disposals.forEach(fn => fn())
  await assert.rejects(bridge.call('replace_selection', { id: disposed.id, text: '覆盖' }), /过期/)
})

test('页面工具跟随插件释放，停止准备持有编辑器直到取消重启', async t => {
  const window = new Window(), disposals = [], owner = { effect(fn) { disposals.push(fn()) } }
  let held = false
  const stopping = new StopCoordinator({ async serial(name, request) { held = true; request.hold(() => { held = false }) } })
  const bridge = createAgentBridge({ application: { id: 'notebook' }, session: 's', stopping, window, document: window.document })
  t.after(async () => { bridge.dispose(); await window.happyDOM.close() })
  bridge.forOwner(owner).register({ name: 'test_read', inputSchema: {} }, () => '草稿')
  assert.equal(await bridge.call('test_read'), '草稿')
  assert.deepEqual(await bridge.call('workspace_prepare_reload'), { ready: true }); assert.equal(held, true)
  await assert.rejects(bridge.call('workspace_prepare_reload'), /已经在准备/)
  await bridge.call('workspace_release_reload'); await new Promise(r => setImmediate(r)); assert.equal(held, false)
  disposals.forEach(fn => fn()); assert.equal(bridge.describe().length, 0)
  await assert.rejects(bridge.call('test_read'), /工具不可用/)
  await assert.rejects(bridge.call('replace_selection', { id: 'stale', text: '新内容' }), /选区已过期/)
})

test('笔记工具读取草稿，拒绝旧 revision 和异步校验期间的用户修改', async () => {
  const tools = new Map(), note = { id: 'n', type: 'plain', title: '测试', content: '未保存草稿' }
  const model = { selected: 'n', notes: [note], busy: false, editable: true, dirty: true, current: () => structuredClone(note), edit: patch => Object.assign(note, patch), flush: async () => {} }
  agentTools({ notebook: model }, { agent: { register(def, execute) { tools.set(def.name, execute) } } })
  const read = await tools.get('notebook_read')({}); assert.equal(read.note.content, '未保存草稿')
  note.content = '用户继续输入'
  await assert.rejects(tools.get('notebook_update')({ id: 'n', revision: read.revision, patch: { content: '覆盖' } }), /笔记已变化/)
  assert.equal(note.content, '用户继续输入')
  const fresh = await revision(note), updating = tools.get('notebook_update')({ id: 'n', revision: fresh, patch: { content: '覆盖' } })
  note.content = '校验时编辑'; await assert.rejects(updating, /笔记已变化/)
  await tools.get('notebook_update')({ id: 'n', revision: await revision(note), patch: { content: '成功修改' } })
  assert.equal(note.content, '成功修改')
  model.busy = true; await assert.rejects(tools.get('notebook_update')({}), /不可修改/)
})
