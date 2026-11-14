import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, newBoard } from '../applications/studio/plugins/canvas/store.js'
import { createTypes } from './helpers/studio-fixture.js'
import { writeSnapshot } from '../shared/persistence.js'

const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
async function fixture(t, writer = writeSnapshot) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-store-edits-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await createStore(directory, writer, createTypes())
  await store.change(state => {
    state.boards = Array.from({ length: 6 }, (_, index) => ({ ...newBoard('画板 ' + index), nodes: Array.from({ length: 20 }, (_, n) => ({ id: 'text-' + n, type: 'text', title: '文字', text: '原文', x: n * 10, y: 0 })) }))
    state.jobs = Array.from({ length: 100 }, (_, index) => ({ id: 'job-' + index, status: 'succeeded', prompt: '历史内容'.repeat(1000) }))
    state.assets = { reference: { id: 'reference', kind: 'image', name: '参考图', width: 32, height: 32 } }
    state.extensions = { example: [{ id: 'kept', value: ['保持原样'] }] }
  })
  return { store, file: join(directory, 'studio.json') }
}

test('批量移动只复制目标画板，保留其他画板和历史记录，并可整批撤销重做', async t => {
  const { store, file } = await fixture(t), before = store.read(), target = before.boards[0]
  const operations = target.nodes.map(node => ({ type: 'update', id: node.id, patch: { x: node.x + 100, y: 50 } }))
  const clone = globalThis.structuredClone, copies = { project: 0, board: 0 }
  let result
  globalThis.structuredClone = value => {
    if (value?.boards && value?.assets) copies.project++
    if (value?.nodes && value?.edges) copies.board++
    return clone(value)
  }
  try { result = await store.edit(target.id, target.revision, operations) }
  finally { globalThis.structuredClone = clone }
  assert.equal(copies.project, 0, '普通画板编辑不应复制整个项目')
  assert.equal(copies.board, 2, '整批共用一份编辑草稿，另复制一份对外返回快照')
  const after = store.read()
  assert.deepEqual(after.boards.slice(1), before.boards.slice(1))
  for (const key of ['assets', 'jobs', 'extensions']) assert.deepEqual(after[key], before[key])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), after)
  const undone = await store.edit(target.id, result.board.revision, result.inverse)
  assert.deepEqual(undone.board.nodes, target.nodes)
  const redone = await store.edit(target.id, undone.board.revision, undone.inverse)
  assert.deepEqual(redone.board.nodes, result.board.nodes)
})

test('批量操作中的校验或版本失败不修改内存、文件和保存版本', async t => {
  const { store, file } = await fixture(t), before = store.read(), target = before.boards[0]
  const saved = await readFile(file, 'utf8'), revision = store.revision()
  await assert.rejects(store.edit(target.id, target.revision, [
    { type: 'update', id: 'text-0', patch: { x: 100 } },
    { type: 'update', id: 'text-1', patch: { text: 123 } },
    { type: 'update', id: 'text-1', patch: { text: '后续修正也不能跳过前一步校验' } },
  ]), /文字格式/)
  await assert.rejects(store.edit(target.id, target.revision + 1, [{ type: 'rename', title: '错误版本' }]), error => error.status === 409)
  assert.deepEqual(store.read(), before)
  assert.equal(store.revision(), revision)
  assert.equal(await readFile(file, 'utf8'), saved)
})

test('写盘失败保留旧状态，后续画板编辑和扩展事务共用保存队列', async t => {
  let blocked
  const { store, file } = await fixture(t, async (file, snapshot) => {
    if (blocked) {
      const wait = blocked; blocked = null; wait.entered.release()
      await wait.done.promise
      throw Error('模拟磁盘写入失败')
    }
    await writeSnapshot(file, snapshot)
  })
  const before = store.read(), target = before.boards[0], second = before.boards[1], revision = store.revision()
  const entered = gate(), done = gate(); blocked = { entered, done }
  const failed = assert.rejects(store.edit(target.id, target.revision, [{ type: 'update', id: 'text-0', patch: { x: 999 } }]), /模拟磁盘写入失败/)
  await entered.promise
  assert.deepEqual(store.read(), before, '写盘确认前不得发布草稿')
  assert.equal(store.revision(), revision)
  const following = store.edit(target.id, target.revision, [{ type: 'update', id: 'text-0', patch: { y: 50 } }])
  const extension = store.records('example').change(tx => {
    tx.records.push({ id: 'new', value: ['新记录'] })
    tx.edit(second.id, [{ type: 'rename', title: '扩展修改的画板' }])
  })
  done.release(); await failed; await following; await extension; await store.flush()
  const after = store.read()
  assert.equal(after.boards[0].nodes[0].x, 0)
  assert.equal(after.boards[0].nodes[0].y, 50)
  assert.equal(after.boards[1].title, '扩展修改的画板')
  assert.equal(after.extensions.example.length, 2)
  assert.deepEqual(after.boards.slice(2), before.boards.slice(2))
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), after)
})

test('排队期间冻结输入，返回快照与内部状态隔离，重放不重复保存', async t => {
  let blocked, writes = 0
  const { store, file } = await fixture(t, async (file, snapshot) => {
    writes++
    if (blocked) { const wait = blocked; blocked = null; wait.entered.release(); await wait.done.promise }
    await writeSnapshot(file, snapshot)
  })
  const target = store.read().boards[0], id = crypto.randomUUID()
  const operations = [{ type: 'update', id: 'text-0', patch: { x: 100 } }]
  const original = structuredClone(operations), entered = gate(), done = gate(); blocked = { entered, done }
  const pending = store.edit(target.id, target.revision, operations, id)
  operations[0].patch.x = 999
  await entered.promise; done.release()
  const result = await pending
  assert.equal(result.board.nodes[0].x, 100)
  result.board.nodes[0].x = 888; result.inverse[0].patch.x = 777
  assert.equal(store.read().boards[0].nodes[0].x, 100)
  const saved = await readFile(file, 'utf8'), revision = store.revision(), beforeWrites = writes
  const replay = await store.edit(target.id, target.revision, original, id)
  assert.equal(replay.replayed, true)
  assert.equal(replay.board.nodes[0].x, 100)
  assert.equal(store.revision(), revision)
  assert.equal(writes, beforeWrites)
  assert.equal(await readFile(file, 'utf8'), saved)
})
