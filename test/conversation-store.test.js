import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { openConversationStore } from '../workbench/conversation-store.js'
import { writeSnapshot } from '../shared/persistence.js'
import { threadPage, threadSummary } from '../workbench/conversation-view.js'
import { mergeThread } from '../workbench/public/thread-cache.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cordis-threads-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
const thread = id => ({ id, revision: 0, messages: [], turns: [] })

test('旧数据迁移完成后才发布标记，中断可重试，原始历史保留', async t => {
  const dir = await fixture(t), legacy = [thread('a'), thread('b')]
  await writeFile(join(dir, 'conversations.json'), JSON.stringify(legacy))
  await assert.rejects(openConversationStore(dir, { write: (file, data) => {
    if (basename(file) === 'b.json') throw Error('disk full')
    return writeSnapshot(file, data)
  } }), /disk full/)
  await assert.rejects(readFile(join(dir, 'conversations/.format.json')), { code: 'ENOENT' })
  const store = await openConversationStore(dir)
  assert.deepEqual(store.conversations, legacy)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'conversations.json'))), legacy)
  store.conversations[0].revision++; store.mark(store.conversations[0]); await store.flush()
  assert.equal((await openConversationStore(dir)).conversations[0].revision, 1)
})

test('保存合并为当前会话的最新快照，不重写其他历史；慢写入队列不会积压每帧快照', async t => {
  const dir = await fixture(t), writes = []
  const legacy = Array.from({ length: 100 }, (_, i) => ({ ...thread('t' + i), messages: [{ text: 'x'.repeat(10000) }] }))
  await writeFile(join(dir, 'conversations.json'), JSON.stringify(legacy))
  await openConversationStore(dir)
  let release, entered
  const gate = new Promise(r => { release = r }), started = new Promise(r => { entered = r })
  const store = await openConversationStore(dir, { write: async (file, data) => {
    writes.push({ file, bytes: Buffer.byteLength(data), revision: JSON.parse(data).thread.revision })
    if (writes.length === 1) { entered(); await gate }
    await writeSnapshot(file, data)
  } })
  const current = store.conversations[0]
  current.revision = 1; store.mark(current); const pending = store.flush(); await started
  for (let i = 2; i <= 200; i++) { current.revision = i; store.mark(current) }
  release(); await pending
  assert.deepEqual(writes.map(write => write.revision), [1, 200])
  assert.ok(writes.every(write => basename(write.file) === 't0.json'))
  assert.ok(writes.reduce((n, write) => n + write.bytes, 0) < JSON.stringify(legacy).length / 40)
  assert.equal((await openConversationStore(dir)).conversations[0].revision, 200)
  t.diagnostic(`100 会话/200 次更新：实际写入 ${writes.length} 次，共 ${writes.reduce((n, write) => n + write.bytes, 0)} 字节`)
})

test('写入失败可见且保留待写最新内容，flush 重试后恢复；非法路径不能迁移', async t => {
  const dir = await fixture(t); await openConversationStore(dir)
  let failing = true
  const store = await openConversationStore(dir, { write: (file, data) => { if (failing) throw Error('EIO'); return writeSnapshot(file, data) } })
  const current = thread('safe'); store.mark(current)
  await assert.rejects(store.flush(), /EIO/)
  current.revision = 2; failing = false; await store.flush()
  assert.equal((await openConversationStore(dir)).conversations[0].revision, 2)
  assert.throws(() => store.mark(thread('../outside')), /格式无效/)
})

test('摘要不含历史正文；分页覆盖全部旧消息和完整轮次，不变 revision 只返回确认', () => {
  const value = { ...thread('history'), revision: 8, messages: [{ text: '旧消息' }], sessionFile: 'private/path' }
  for (let i = 0; i < 55; i++) { value.turns.push({ id: 't' + i, events: [{ text: 'trace'.repeat(100) }] }); value.messages.push({ turnId: 't' + i, role: 'user', text: 'm' + i }) }
  const summary = threadSummary(value)
  assert.equal(summary.messages, undefined); assert.equal(summary.turns, undefined); assert.equal(summary.sessionFile, undefined)
  const last = threadPage(value), middle = threadPage(value, { before: last.history.before }), first = threadPage(value, { before: middle.history.before })
  assert.deepEqual([last.turns.length, middle.turns.length, first.turns.length], [20, 20, 15])
  assert.equal(first.messages[0].text, '旧消息'); assert.equal(first.history.before, 0)
  assert.equal(new Set([...last.messages, ...middle.messages, ...first.messages].map(m => m.text)).size, 56)
  assert.deepEqual(threadPage(value, { since: 8 }), { id: 'history', revision: 8, unchanged: true })
  assert.throws(() => threadPage(value, { before: -1 }), { status: 400 })
  const combined = mergeThread(mergeThread(last, middle, { older: true }), first, { older: true })
  assert.equal(combined.turns.length, 55); assert.equal(combined.messages[0].text, '旧消息')
  assert.equal(mergeThread(combined, summary).turns.length, 55)
})

test('过时详情和更早页不会回滚 SSE；断线后缺页可通过历史游标继续加载', () => {
  const page = (revision, start, end) => ({ id: 'a', revision, messages: [{ id: 'm', text: 'v' + revision }], turns: [{ id: 't', status: 'v' + revision }], history: { before: start, end, total: end } })
  const newest = page(3, 20, 40), old = page(2, 0, 20)
  const result = mergeThread(newest, old, { older: true, detail: true })
  assert.equal(result.turns[0].status, 'v3'); assert.equal(result.messages[0].text, 'v3'); assert.equal(result.revision, 3)
  assert.equal(result.history.before, 0)
  const gap = mergeThread(result, page(100, 80, 100), { detail: true })
  assert.equal(gap.history.before, 80); assert.equal(gap.detailRevision, 100)
})

test('先收单轮 SSE 再加载历史时保持顺序，重叠内容独立按 revision 取最新版本', () => {
  const value = { ...thread('history'), revision: 8, commands: [] }
  for (let i = 0; i < 25; i++) {
    value.turns.push({ id: 't' + i, status: 'v8' })
    value.messages.push({ id: 'm' + i, turnId: 't' + i, text: 'v8' })
    value.commands.push({ session_id: 'c' + i, turnId: 't' + i, status: 'v8' })
  }
  for (const detailRevision of [7, 8, 9]) {
    const live = threadPage(structuredClone(value), { limit: 1 })
    const detail = threadPage({ ...value, revision: detailRevision,
      messages: value.messages.map(m => ({ ...m, text: 'v' + detailRevision })),
      turns: value.turns.map(turn => ({ ...turn, status: 'v' + detailRevision })),
      commands: value.commands.map(command => ({ ...command, status: 'v' + detailRevision })),
    })
    const combined = mergeThread(live, detail, { detail: true })
    const expected = Array.from({ length: 20 }, (_, i) => i + 5)
    assert.deepEqual(combined.messages.map(m => m.id), expected.map(i => 'm' + i))
    assert.deepEqual(combined.turns.map(turn => turn.id), expected.map(i => 't' + i))
    assert.deepEqual(combined.commands.map(command => command.session_id), expected.map(i => 'c' + i))
    const newest = 'v' + Math.max(8, detailRevision)
    assert.equal(combined.messages.at(-1).text, newest)
    assert.equal(combined.turns.at(-1).status, newest)
    assert.equal(combined.commands.at(-1).status, newest)
    assert.deepEqual(combined.history, { before: 5, end: 25, total: 25 })
    // Reversing the arrival order must not move an older single-turn snapshot to the front.
    const reverse = mergeThread(detail, live)
    assert.deepEqual(reverse.messages.map(m => m.id), expected.map(i => 'm' + i))
    assert.equal(reverse.messages.at(-1).text, newest)
  }
})

test('更新的更早分页按时间插入，同时刷新重叠轮次而不覆盖新收到的尾部消息', () => {
  const value = { ...thread('overlap'), revision: 1 }
  for (let i = 0; i < 30; i++) {
    value.turns.push({ id: 't' + i })
    value.messages.push({ id: 'm' + i, turnId: 't' + i, text: 'v1' })
  }
  const current = threadPage(value)
  const older = threadPage({ ...value, revision: 2, messages: value.messages.map(m => ({ ...m, text: 'v2' })) }, { before: 20 })
  const result = mergeThread(current, older, { older: true })
  assert.deepEqual(result.messages.map(m => m.id), Array.from({ length: 30 }, (_, i) => 'm' + i))
  assert.equal(result.messages[15].text, 'v2')
  assert.equal(result.messages[29].text, 'v1')
})
