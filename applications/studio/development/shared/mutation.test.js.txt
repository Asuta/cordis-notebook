import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMutation } from '../mutation.js'

function fixture() {
  let dispose, editable = true
  const edits = [], board = { id: 'one', revision: 0, title: '原画板', nodes: [] }
  const session = { boardId: 'one', board: () => board, flush: async () => {}, editable: () => editable,
    edit: async (operations, options) => { edits.push({ operations, options }); return { board: { ...board, revision: ++board.revision } } } }
  const mutate = createMutation({ effect: fn => { dispose = fn() } }, session)
  return { mutate, edits, board, session, dispose: () => dispose(), lock: () => { editable = false } }
}
test('异步结果拒绝覆盖新编辑、切板、停用和过期版本；防止重复执行', async () => {
  for (const change of ['revision', 'board', 'editing', 'dispose']) {
    const f = fixture(); let release
    const pending = f.mutate(() => new Promise(resolve => { release = resolve }))
    await Promise.resolve()
    await assert.rejects(f.mutate(() => []), /正在执行/)
    if (change === 'revision') f.board.revision++
    if (change === 'board') f.session.boardId = 'two'
    if (change === 'editing') f.lock()
    if (change === 'dispose') f.dispose()
    release([{ type: 'rename', title: '旧结果' }])
    await assert.rejects(pending); assert.equal(f.edits.length, 0)
  }
  const f = fixture()
  await assert.rejects(f.mutate(() => [], { revision: 9 }), /重新 studio_read/)
  await f.mutate(() => [{ type: 'rename', title: '新标题' }], { revision: 0 })
  assert.deepEqual(f.edits[0].options, { targetBoard: 'one', expectedRevision: 0 })
})
