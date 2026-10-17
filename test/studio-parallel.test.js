import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore, owner } from './helpers/studio-fixture.js'
import { createJobs } from '../applications/studio/plugins/image-generation/jobs.js'
import { copySelection } from '../applications/studio/plugins/canvas/copy.js'
import { imageFixture, until } from './helpers/studio-wavespeed.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-parallel-')), store = await createStore(dir), jobs = await createJobs(store), requests = []
  const bytes = await imageFixture()
  jobs.register(owner(), { id: 'test', label: '测试', public: () => ({}), prepare(input) {
    const entry = { prompt: input.prompt }; requests.push(entry)
    return { model: 'mock', outputKind: 'image', generate(_, signal) {
      entry.started = true
      return new Promise((resolve, reject) => { entry.complete = () => resolve(bytes); entry.fail = () => reject(Error('模拟失败')); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
    } }
  } })
  t.after(async () => { await jobs.close(); await rm(dir, { recursive: true, force: true }) })
  const boardId = store.read().boards[0].id, board = () => store.read().boards[0]
  await store.edit(boardId, 0, [{ type: 'add', node: { id: 'g', type: 'generator', provider: 'test', prompt: '第一份提示词' } }])
  const submit = (requestId = randomUUID()) => jobs.start({ requestId, boardId, nodeId: 'g', revision: board().revision })
  const edit = operations => store.edit(boardId, board().revision, operations)
  return { dir, store, jobs, requests, boardId, board, submit, edit }
}

test('同一卡片多次提交立即占位、独立冻结输入，乱序完成原位替换且不重复创建', async t => {
  const { store, jobs, requests, board, submit, edit } = await fixture(t)
  const first = await submit()
  await until(() => requests[0].started)
  const frame = board().nodes.find(node => node.id === first.resultNodeId)
  assert.equal(frame.type, 'image'); assert.equal(frame.assetId, undefined); assert.equal(frame.jobId, first.id); assert.equal(frame.sourceNodeId, 'g')
  await submit(first.id); assert.equal(requests.length, 1); assert.equal(board().nodes.length, 2)
  assert.throws(() => copySelection(board(), [frame.id], store.types, store.read().assets), /尚未生成/)
  await edit([{ type: 'update', id: 'g', patch: { prompt: '第二份提示词' } }])
  const second = await submit(), third = await submit()
  await until(() => requests[1].started)
  assert.equal(requests[2].started, undefined); assert.equal(jobs.read()[2].status, 'queued')
  const frames = board().nodes.filter(node => node.jobId).sort((a, b) => a.y - b.y), positions = new Set(frames.map(node => `${node.x},${node.y}`))
  assert.equal(positions.size, 3); assert.ok(frames[1].y - frames[0].y <= 380); assert.ok(frames[2].y - frames[1].y <= 380)
  assert.deepEqual(jobs.read().map(job => job.input.prompt), ['第一份提示词', '第二份提示词', '第二份提示词'])
  await edit([{ type: 'update', id: first.resultNodeId, patch: { x: 1400, y: 1900, title: '我移动过的结果' } }])
  requests[1].complete(); await until(() => jobs.read()[1].status === 'succeeded'); await until(() => requests[2].started)
  assert.equal(board().nodes.find(node => node.id === second.resultNodeId).assetId, jobs.read()[1].assetId)
  assert.equal(board().nodes.find(node => node.id === first.resultNodeId).assetId, undefined)
  requests[0].complete(); requests[2].complete(); await until(() => jobs.read().every(job => job.status === 'succeeded'))
  const completed = board().nodes.find(node => node.id === first.resultNodeId)
  assert.equal(completed.x, 1400); assert.equal(completed.y, 1900); assert.equal(completed.title, '我移动过的结果')
  assert.equal(board().nodes.length, 4); assert.ok(board().nodes.find(node => node.id === third.resultNodeId).assetId)
})

test('失败、取消和删除结果框各自独立，刷新后保留占位，不复活已删除画框', async t => {
  const { dir, store, jobs, requests, board, submit, edit } = await fixture(t)
  const first = await submit(), second = await submit(), third = await submit()
  await until(() => requests[1].started)
  requests[0].fail(); await until(() => jobs.read()[0].status === 'failed'); await until(() => requests[2].started)
  assert.equal(board().nodes.find(node => node.id === first.resultNodeId).assetId, undefined)
  await edit([{ type: 'remove', ids: [second.resultNodeId] }]); await jobs.boardChanged(board())
  assert.equal(jobs.read()[1].status, 'interrupted'); assert.equal(jobs.read()[2].status, 'running')
  requests[1].complete(); requests[2].complete(); await until(() => jobs.read()[2].status === 'succeeded')
  assert.equal(board().nodes.some(node => node.id === second.resultNodeId), false)
  assert.ok(board().nodes.find(node => node.id === third.resultNodeId).assetId)
  const reopened = await createStore(dir)
  assert.deepEqual(reopened.read().boards[0].nodes, store.read().boards[0].nodes)
  assert.equal(reopened.read().jobs[0].status, 'failed')
})

test('队列和画板容量在提交前校验，不创建多余画框或调用生成服务', async t => {
  const { store, jobs, requests, board, submit } = await fixture(t)
  for (let i = 0; i < 20; i++) await submit()
  assert.equal(board().nodes.length, 21)
  await assert.rejects(submit(), /20 个待完成/)
  assert.equal(requests.length, 20); assert.equal(board().nodes.length, 21)
  for (const job of jobs.read()) await jobs.cancel(job.id)
  await store.change(state => { const current = state.boards[0]; while (current.nodes.length < 500) current.nodes.push({ id: 'text-' + current.nodes.length, type: 'text', title: '文字', x: -500, y: 0, text: '' }) })
  await assert.rejects(submit(), /画板卡片已满/)
  assert.equal(requests.length, 20); assert.equal(board().nodes.length, 500)
})

test('多结果输出保留首个占位框的位置和标题，按实际媒体类型填充并连接其他结果', async t => {
  const { jobs, board, submit, edit } = await fixture(t), bytes = await imageFixture()
  let complete
  jobs.register(owner(), { id: 'batch', label: '多结果', public: () => ({}), prepare: () => ({ model: 'batch', outputKind: 'video', generate: () => new Promise(resolve => { complete = () => resolve([{ bytes, kind: 'image' }, { bytes, kind: 'image' }]) }) }) })
  await edit([{ type: 'update', id: 'g', patch: { provider: 'batch' } }])
  const job = await submit()
  await until(() => complete)
  assert.equal(board().nodes.find(node => node.id === job.resultNodeId).type, 'video')
  await edit([{ type: 'update', id: job.resultNodeId, patch: { x: 1200, y: 900, title: '固定结果位置' } }])
  complete(); await until(() => jobs.read()[0].status === 'succeeded')
  const frames = board().nodes.filter(node => node.jobId === job.id), first = frames.find(node => node.id === job.resultNodeId)
  assert.equal(frames.length, 2); assert.equal(first.type, 'image'); assert.equal(first.x, 1200); assert.equal(first.y, 900); assert.equal(first.title, '固定结果位置')
  assert.ok(frames.every(node => node.assetId && node.sourceNodeId === 'g'))
  assert.deepEqual(frames.map(node => node.assetId), jobs.read()[0].assetIds)
  assert.notDeepEqual({ x: frames[0].x, y: frames[0].y }, { x: frames[1].x, y: frames[1].y })
})
