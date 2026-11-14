import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEditQueue } from '../applications/studio/plugins/canvas/edit-queue.js'
import { applyOperations } from '../applications/studio/plugins/canvas/model.js'
import { createStore, createTypes, applyOperation } from './helpers/studio-fixture.js'
import { newBoard } from '../applications/studio/plugins/canvas/store.js'
import { serializeClientBoard } from '../applications/studio/plugins/canvas/client-state.js'

const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
const turn = () => new Promise(resolve => setImmediate(resolve))
function fixture({ storage = new Map(), api, board, clientTypes, retryDelays, busy = () => false } = {}) {
  const types = createTypes(), server = board || newBoard('测试')
  if (!board) server.nodes = [{ id: 'a', type: 'text', x: 0, y: 0, title: '文字', text: '原文' }]
  const state = { boards: [structuredClone(server)], assets: {}, types: clientTypes || types.list().map(({ id,label,fields,accepts,output,defaults }) => ({ id,label,fields,accepts,output,defaults:defaults() })) }
  const calls = [], receipts = new Map(), statuses = [], messages = [], undo = new Map(), redo = new Map()
  let remote = server
  const save = async (path, input) => {
    if (path === '') return { boards: [serializeClientBoard(remote, types)], assets: {}, jobs: [] }
    calls.push(structuredClone(input))
    if (receipts.has(input.requestId)) return receipts.get(input.requestId)
    if (input.revision !== remote.revision) throw Object.assign(Error('画布已变化'), { status: 409, code: 'CANVAS_REVISION_CONFLICT' })
    const applied = applyOperations(remote, input.operations, {}, types, { validateEach: true })
    remote = applied.board
    const inverse = applied.inverse
    const result = { board: serializeClientBoard(remote,types), inverse }; receipts.set(input.requestId,result); return result
  }
  const queue = createEditQueue({ state: () => state, api: api ? (...args) => api(save,...args) : save, storage: {getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}, undo,redo,changed:value=>{if(value)statuses.push(value)},report:message=>messages.push(message),busy,retryDelays })
  const edit = (operations,options={}) => queue.edit(operations,{targetBoard:server.id,waitForSave:false,...options})
  return {queue,state,storage,calls,statuses,messages,undo,redo,edit,remote:()=>remote, external: operations => { remote = applyOperations(remote, operations, {}, types).board }}
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.fail('等待自动恢复超时')
}

test('网络与暂时服务故障自动重试同一请求，恢复后等待者完成且新操作继续保存', async t => {
  let offline = true, attempts = 0
  const f = fixture({ retryDelays: [5, 10, 20], api: async (save, ...args) => {
    attempts++
    if (offline) throw Object.assign(Error('temporarily unavailable'), { status: 503 })
    return save(...args)
  } })
  t.after(() => f.queue.stop())
  const saved = f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }], { waitForSave: true })
  await until(() => attempts >= 3)
  assert.equal(f.queue.recovering, true); assert.equal(f.messages.length, 0)
  await f.edit([{ type: 'update', id: 'a', patch: { y: 20 } }])
  offline = false
  await until(() => !f.queue.dirty); await saved
  assert.deepEqual([f.remote().nodes[0].x, f.remote().nodes[0].y], [10, 20])
  assert.equal(f.queue.recovering, false); assert.equal(f.storage.size, 0)
})

test('已写入但响应连续丢失，自动重试和恢复连接不重复添加', async t => {
  let lost = true
  const f = fixture({ retryDelays: [10000], api: async (save, ...args) => {
    const response = await save(...args)
    if (lost) throw TypeError('connection reset')
    return response
  } })
  t.after(() => f.queue.stop())
  const saved = f.edit([{ type: 'add', node: { id: 'b', type: 'text' } }], { waitForSave: true })
  await until(() => f.queue.recovering)
  lost = false; f.queue.resume()
  await until(() => !f.queue.dirty); await saved
  assert.equal(f.remote().nodes.length, 2); assert.equal(f.remote().revision, 1)
  assert.equal(new Set(f.calls.map(call => call.requestId)).size, 1)
})

test('版本冲突自动合并不同字段与新增结果，连续队列及撤销重做保持正确', async t => {
  const held = gate(), f = fixture({ api: async (save, ...args) => { await held.promise; return save(...args) } })
  t.after(() => f.queue.stop())
  const id = f.state.boards[0].id
  f.external([{ type: 'update', id: 'a', patch: { text: '后台更新' } }, { type: 'add', node: { id: 'result', type: 'text', text: '生成结果' } }])
  await f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }])
  await f.edit([{ type: 'update', id: 'a', patch: { x: 20 } }])
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo' })
  await f.edit(f.redo.get(id).at(-1), { historyDirection: 'redo' })
  held.release(); await f.queue.flush()
  assert.equal(f.remote().nodes[0].x, 20); assert.equal(f.remote().nodes[0].text, '后台更新')
  assert.equal(f.state.boards[0].nodes.length, 2)
  assert.deepEqual(f.calls.map(call => call.revision), [0, 2, 3, 4, 5])
  assert.notEqual(f.calls[0].requestId, f.calls[1].requestId)
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.equal(f.remote().nodes[0].x, 10)
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.equal(f.remote().nodes[0].x, 0)
  assert.equal(f.remote().nodes.length, 2); assert.equal(f.remote().nodes[0].text, '后台更新')
  assert.equal(f.queue.dirty, false)
})

test('同字段修改或删除冲突保留整条队列和历史，不自动覆盖或循环重试', async t => {
  for (const remote of [[{ type: 'update', id: 'a', patch: { x: 90 } }], [{ type: 'remove', ids: ['a'] }]]) {
    const f = fixture({ retryDelays: [5] }); t.after(() => f.queue.stop())
    f.external(remote)
    await f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }])
    await until(() => !!f.queue.error)
    assert.match(f.queue.error, /冲突/); assert.equal(f.queue.recovering, false)
    assert.equal(f.state.boards[0].nodes[0].x, 10)
    assert.equal(f.remote().nodes[0]?.x, remote[0].type === 'remove' ? undefined : 90)
    assert.equal(f.queue.count, 1); assert.equal(f.undo.get(f.state.boards[0].id).length, 1)
    f.queue.resume(); await turn(); assert.equal(f.calls.length, 1)
  }
})

test('删除与另一张卡片的后台修改互不冲突，恢复删除不覆盖后台内容', async t => {
  const f = fixture(); t.after(() => f.queue.stop())
  await f.edit([{ type: 'add', node: { id: 'b', type: 'text', text: 'B' } }], { waitForSave: true })
  f.external([{ type: 'update', id: 'b', patch: { text: '后台新正文' } }])
  await f.edit([{ type: 'remove', ids: ['a'] }], { waitForSave: true })
  assert.equal(f.remote().nodes.length, 1); assert.equal(f.remote().nodes[0].text, '后台新正文')
  await f.edit(f.undo.get(f.state.boards[0].id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.deepEqual(f.remote().nodes.map(node => node.text), ['原文', '后台新正文'])
})

test('重合并日志写入失败不发布新基线或历史，手动重试仍可恢复', async t => {
  class Storage extends Map { set(key, value) { if (this.fail) throw Error('storage full'); return super.set(key, value) } }
  const storage = new Storage(), held = gate(), f = fixture({ storage, api: async (save, ...args) => { await held.promise; return save(...args) } })
  t.after(() => f.queue.stop())
  f.external([{ type: 'update', id: 'a', patch: { text: '远端正文' } }])
  const saved = assert.rejects(f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }], { waitForSave: true }), /storage full/)
  const raw = storage.get('canvas-pending-edits-v1')
  storage.fail = true; held.release(); await saved
  assert.equal(storage.get('canvas-pending-edits-v1'), raw); assert.equal(f.state.boards[0].nodes[0].text, '原文')
  storage.fail = false; await f.queue.retry()
  assert.equal(f.remote().nodes[0].x, 10); assert.equal(f.state.boards[0].nodes[0].text, '远端正文')
})

test('拖动预览期间延后合并，拖动结束后自动恢复并保留后续操作', async t => {
  let dragging = true
  const f = fixture({ busy: () => dragging, retryDelays: [5] }); t.after(() => f.queue.stop())
  f.external([{ type: 'update', id: 'a', patch: { text: '后台' } }])
  await f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }])
  await until(() => !!f.queue.error)
  assert.equal(f.state.boards[0].nodes[0].text, '原文')
  await f.edit([{ type: 'update', id: 'a', patch: { y: 20 } }])
  dragging = false; f.queue.resume()
  await until(() => !f.queue.dirty)
  assert.deepEqual([f.remote().nodes[0].x, f.remote().nodes[0].y], [10, 20])
  assert.equal(f.remote().nodes[0].text, '后台')
})

test('刷新后的恢复日志自动提交，停用或放弃后取消自动重试', async t => {
  const original = fixture({ retryDelays: [10000], api: async () => { throw TypeError('offline') } })
  await original.edit([{ type: 'update', id: 'a', patch: { x: 30 } }]); await turn(); original.queue.stop()
  const saved = original.queue.snapshot()
  const restored = fixture({ storage: original.storage, board: saved.bases[0], retryDelays: [5] })
  t.after(() => restored.queue.stop())
  await until(() => !restored.queue.dirty)
  assert.equal(restored.remote().nodes[0].x, 30)
  for (const action of ['stop', 'discard']) {
    let calls = 0
    const f = fixture({ retryDelays: [5], api: async () => { calls++; throw TypeError('offline') } })
    await f.edit([{ type: 'update', id: 'a', patch: { x: 30 } }]); await turn()
    await f.queue[action](); const count = calls
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(calls, count)
  }
})

test('本地连续编辑、撤销与重做立即生效，旧确认不覆盖后续位置', async () => {
  const held = gate(), f = fixture({api:async(save,...args)=>{await held.promise;return save(...args)}})
  const move = x => [{type:'update',id:'a',patch:{x}}]
  await f.edit(move(10)); await f.edit(move(20))
  assert.equal(f.state.boards[0].nodes[0].x,20); assert.equal(f.calls.length,0)
  await f.edit(f.undo.get(f.state.boards[0].id).at(-1),{historyDirection:'undo'})
  assert.equal(f.state.boards[0].nodes[0].x,10)
  await f.edit(f.redo.get(f.state.boards[0].id).at(-1),{historyDirection:'redo'})
  assert.equal(f.state.boards[0].nodes[0].x,20)
  assert.equal(f.queue.count,4); assert.ok(f.storage.get('canvas-pending-edits-v1'))
  held.release(); await f.queue.flush()
  assert.equal(f.remote().nodes[0].x,20); assert.equal(f.state.boards[0].nodes[0].x,20)
  assert.deepEqual(f.calls.map(call=>call.revision),[0,1,2,3])
  assert.equal(f.queue.dirty,false); assert.equal(f.storage.size,0)
})

test('响应丢失使用相同 ID 重试，不重复创建卡片或重复撤销', async () => {
  let lost = false
  const f = fixture({api:async(save,...args)=>{const result=await save(...args);if(!lost){lost=true;throw TypeError('connection reset')}return result}})
  await f.edit([{type:'add',node:{id:'b',type:'text'}}])
  await f.queue.flush()
  assert.equal(f.remote().nodes.filter(n=>n.id==='b').length,1)
  assert.equal(f.remote().revision,1)
  assert.equal(f.calls[0].requestId,f.calls[1].requestId)
  assert.equal(f.undo.get(f.state.boards[0].id).length,1)
})

test('保存确认不包含进行中的拖动预览，恢复基线只推进已提交操作', async () => {
  const first = gate(), second = gate()
  let sent = 0
  const f = fixture({ api: async (save, ...args) => {
    await (++sent === 1 ? first : second).promise
    return save(...args)
  } })
  await f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }])
  // Pointer previews can temporarily mutate the displayed board before commit.
  const preview = f.state.boards[0]
  preview.nodes[0].y = 75
  await f.edit([{ type: 'update', id: 'a', patch: { x: 20 } }])
  first.release(); await turn()
  const recovery = JSON.parse(f.storage.get('canvas-pending-edits-v1'))
  assert.equal(recovery.bases[0].nodes[0].x, 10)
  assert.equal(recovery.bases[0].nodes[0].y, 0)
  assert.equal(f.state.boards[0].nodes[0].x, 20)
  second.release(); await f.queue.flush()
})

test('确认后的恢复记录清理失败仍可用同一请求重试，不挂起或重复写入', async () => {
  class Storage extends Map {
    delete(key) { if (this.fail) throw Error('storage unavailable'); return super.delete(key) }
  }
  const storage = new Storage(), held = gate()
  const f = fixture({ storage, api: async (save, ...args) => { await held.promise; return save(...args) } })
  const saved = f.edit([{ type: 'update', id: 'a', patch: { x: 10 } }], { waitForSave: true })
  storage.fail = true; held.release()
  await assert.rejects(saved, /storage unavailable/)
  assert.equal(f.queue.count, 1)
  assert.equal(f.remote().revision, 1)
  storage.fail = false; await f.queue.retry()
  assert.equal(f.queue.count, 0)
  assert.equal(f.remote().revision, 1)
  assert.equal(f.calls[0].requestId, f.calls[1].requestId)
})

test('离线失败保留修改、历史和恢复文件，显式重试后依次保存', async () => {
  let offline = true
  const f = fixture({api:async(save,...args)=>{if(offline)throw TypeError('offline');return save(...args)}})
  await f.edit([{type:'update',id:'a',patch:{x:30}}]); await turn()
  assert.ok(f.queue.error); assert.equal(f.state.boards[0].nodes[0].x,30)
  await f.edit([{type:'update',id:'a',patch:{y:40}}])
  await assert.rejects(f.queue.flush(),/offline/)
  assert.equal(f.queue.count,2); assert.equal(f.undo.get(f.state.boards[0].id).length,2)
  assert.equal(JSON.parse(f.storage.get('canvas-pending-edits-v1')).entries.length,2)
  offline=false; await f.queue.retry()
  assert.deepEqual([f.remote().nodes[0].x,f.remote().nodes[0].y],[30,40])
  assert.equal(f.queue.dirty,false)
})

test('刷新恢复失败队列后可重试；显式放弃清理历史，不自动覆盖本地', async () => {
  const f = fixture({api:async()=>{throw Object.assign(Error('conflict'),{status:409})}})
  await f.edit([{type:'update',id:'a',patch:{x:50}}]);await turn()
  const saved = JSON.parse(f.storage.get('canvas-pending-edits-v1'))
  const base = saved.bases[0], state={...f.state,boards:[structuredClone(base)]},types=createTypes()
  let remote=structuredClone(base)
  const queue=createEditQueue({state:()=>state,storage:{getItem:key=>f.storage.get(key),setItem:(key,value)=>f.storage.set(key,value),removeItem:key=>f.storage.delete(key)},undo:new Map(),redo:new Map(),changed(){},report(){},busy:()=>false,api:async(_,input)=>{const result=applyOperations(remote,input.operations,{},types);remote=result.board;return result}})
  assert.equal(state.boards[0].nodes[0].x,50);assert.ok(queue.error)
  await queue.retry();assert.equal(remote.nodes[0].x,50);assert.equal(queue.dirty,false)
  await f.queue.discard();assert.equal(f.queue.dirty,false);assert.equal(f.undo.size,0)
})

test('缺少插件导致恢复失败时，原始日志仍可导出且新编辑不能覆盖它', async () => {
  class Storage extends Map {
    delete(key) { if (this.fail) throw Error('storage unavailable'); return super.delete(key) }
  }
  const storage = new Storage(), f = fixture({ storage, api: async () => { throw TypeError('offline') } })
  await f.edit([{ type: 'add', node: { id: 'image', type: 'image', assetId: 'missing' } }]); await turn()
  const raw = storage.get('canvas-pending-edits-v1'), saved = JSON.parse(raw)
  const restored = fixture({ storage, board: saved.bases[0], clientTypes: f.state.types.filter(type => type.id !== 'image') })
  assert.match(restored.queue.error, /恢复失败/)
  assert.deepEqual(restored.queue.snapshot(), saved)
  restored.queue.snapshot().entries.length = 0
  assert.deepEqual(restored.queue.snapshot(), saved, '导出结果不能修改保留的日志')
  assert.throws(() => restored.edit([{ type: 'update', id: 'a', patch: { x: 50 } }]), /恢复失败/)
  await assert.rejects(restored.queue.retry(), /恢复失败/)
  assert.equal(storage.get('canvas-pending-edits-v1'), raw)
  assert.equal(restored.state.boards[0].nodes.length, 1)
  assert.equal(restored.calls.length, 0)
  storage.fail = true
  await assert.rejects(restored.queue.discard(), /storage unavailable/)
  assert.deepEqual(restored.queue.snapshot(), saved)
  assert.throws(() => restored.edit([{ type: 'rename', title: '不可覆盖' }]), /恢复失败/)
  storage.fail = false; await restored.queue.discard()
  assert.equal(storage.size, 0); assert.equal(restored.queue.dirty, false)
  await restored.edit([{ type: 'update', id: 'a', patch: { x: 50 } }], { waitForSave: true })
  assert.equal(restored.remote().nodes[0].x, 50)
})

test('损坏的恢复日志可原样导出，放弃之前禁止继续写入', async () => {
  const raw = '{"version":1,', storage = new Map([['canvas-pending-edits-v1', raw]])
  const f = fixture({ storage })
  assert.equal(f.queue.snapshot().raw, raw)
  assert.throws(() => f.edit([{ type: 'rename', title: '不可覆盖' }]), /恢复失败/)
  assert.equal(storage.get('canvas-pending-edits-v1'), raw)
  await f.queue.discard(); assert.equal(storage.size, 0)
})

test('服务端 400 移除无效事务及依赖操作，后续编辑与撤销重做按新版本继续保存', async () => {
  const held = gate(); let delayed = false
  const f = fixture({ api: async (save, ...args) => { if (delayed) await held.promise; return save(...args) } })
  await f.edit([{ type: 'update', id: 'a', patch: { x: 5 } }], { waitForSave: true })
  delayed = true
  const invalid = assert.rejects(f.edit([{ type: 'add', node: { id: 'invalid', type: 'image', assetId: 'missing' } }], { waitForSave: true }), /图片素材不存在/)
  const id = f.state.boards[0].id
  await f.edit([{ type: 'update', id: 'invalid', patch: { x: 100 } }])
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo' })
  await f.edit([{ type: 'update', id: 'a', patch: { x: 15 } }])
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo' })
  await f.edit(f.redo.get(id).at(-1), { historyDirection: 'redo' })
  const originalIds = f.queue.snapshot().entries.map(entry => entry.id)
  held.release(); await invalid; await f.queue.flush()
  assert.equal(f.queue.dirty, false); assert.equal(f.storage.size, 0)
  assert.equal(f.state.boards[0].nodes.length, 1)
  assert.equal(f.state.boards[0].nodes[0].x, 15); assert.equal(f.remote().nodes[0].x, 15)
  assert.equal(f.state.boards[0].revision, f.remote().revision)
  assert.deepEqual(f.calls.map(call => call.revision), [0, 1, 1, 2, 3])
  assert.equal(f.calls.filter(call => call.operations[0].node?.id === 'invalid').length, 1)
  assert.ok(f.calls.slice(2).every(call => !originalIds.includes(call.requestId)), '改动后的请求必须使用新 ID')
  assert.match(f.messages[0], /依赖它的 2 项操作/)
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.equal(f.remote().nodes[0].x, 5)
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.equal(f.remote().nodes[0].x, 0, '失败事务之前已保存的撤销历史应保留')
  await f.edit(f.redo.get(id).at(-1), { historyDirection: 'redo', waitForSave: true })
  assert.equal(f.remote().nodes[0].x, 5)
})

test('后续修改覆盖被拒字段时，重新计算逆操作，不把无效值带回撤销历史', async () => {
  const held = gate(), f = fixture({ api: async (save, ...args) => { await held.promise; return save(...args) } })
  const invalid = assert.rejects(f.edit([{ type: 'update', id: 'a', patch: { text: 'x'.repeat(12001) } }], { waitForSave: true }), /文字格式无效/)
  await f.edit([{ type: 'update', id: 'a', patch: { text: '修正文字' } }])
  held.release(); await invalid; await f.queue.flush()
  assert.equal(f.remote().nodes[0].text, '修正文字')
  const id = f.state.boards[0].id
  await f.edit(f.undo.get(id).at(-1), { historyDirection: 'undo', waitForSave: true })
  assert.equal(f.remote().nodes[0].text, '原文')
  await f.edit(f.redo.get(id).at(-1), { historyDirection: 'redo', waitForSave: true })
  assert.equal(f.remote().nodes[0].text, '修正文字'); assert.equal(f.queue.dirty, false)
})

test('拒绝事务的替换日志保存失败时保留原队列，重试后才发布回滚', async () => {
  class Storage extends Map {
    delete(key) { if (this.fail) throw Error('storage unavailable'); return super.delete(key) }
  }
  const storage = new Storage(), held = gate()
  const f = fixture({ storage, api: async (save, ...args) => { await held.promise; return save(...args) } })
  const invalid = assert.rejects(f.edit([{ type: 'add', node: { id: 'invalid', type: 'image', assetId: 'missing' } }], { waitForSave: true }), /storage unavailable/)
  const raw = storage.get('canvas-pending-edits-v1')
  storage.fail = true; held.release(); await invalid
  assert.equal(storage.get('canvas-pending-edits-v1'), raw)
  assert.equal(f.state.boards[0].nodes.length, 2); assert.equal(f.queue.count, 1)
  storage.fail = false; await f.queue.retry()
  assert.equal(f.state.boards[0].nodes.length, 1); assert.equal(f.queue.dirty, false)
  assert.equal(f.remote().revision, 0); assert.equal(f.undo.get(f.state.boards[0].id).length, 0)
})

test('批量事务的逆操作与服务端逐步操作一致，输入对象不会被后续编辑修改', () => {
  const types=createTypes(),board=newBoard('测试'),ops=[{type:'add',node:{id:'t',type:'text',text:'初始'}},{type:'update',id:'t',patch:{text:'修改'}},{type:'add',node:{id:'g',type:'generator'}},{type:'connect',id:'e',from:'t',to:'g'}]
  let expected=board;const inverse=[]
  for(const op of ops){const result=applyOperation(expected,op,{});expected=result.board;inverse.unshift(result.inverse)}
  const result=applyOperations(board,ops,{},types)
  assert.deepEqual(result,{board:expected,inverse})
  const restored=applyOperations(result.board,result.inverse,{},types).board
  assert.deepEqual(restored.nodes,[]);assert.deepEqual(restored.edges,[])
  assert.deepEqual(board.nodes,[])
})

test('持久化请求凭据支持重启后去重，拒绝同 ID 的不同操作', async t => {
  const dir=await mkdtemp(join(tmpdir(),'studio-edit-receipt-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  let store=await createStore(dir);const board=store.read().boards[0],id=crypto.randomUUID(),ops=[{type:'add',node:{id:'a',type:'text'}}]
  await store.edit(board.id,0,ops,id)
  store=await createStore(dir)
  const replay=await store.edit(board.id,0,ops,id)
  assert.equal(replay.replayed,true);assert.equal(replay.board.nodes.length,1);assert.equal(replay.board.revision,1)
  await assert.rejects(store.edit(board.id,0,[{type:'rename',title:'other'}],id),/ID/)
})
