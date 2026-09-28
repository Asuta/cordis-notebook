import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import { createAgentBridge } from '../client/host/agent-bridge.js'
import { StopCoordinator } from '../client/host/stop-coordinator.js'
import agentTools, { revision } from '../applications/notebook/plugins/agent-tools/client.js'

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
