import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { createHost } from '../server/server.js'
import { owner } from './helpers/studio-fixture.js'
import client from '../applications/studio/plugins/canvas/client.js'
import canvasUI from '../applications/studio/plugins/canvas-ui/client.js'
import generation from '../applications/studio/plugins/image-generation/client.js'
import { generationInput } from '../applications/studio/plugins/image-generation/definition.js'
import { textInputs } from '../applications/studio/plugins/image-generation/snapshot.js'

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'studio-client-state-'))
  const app = await createHost({ port: 0, dataDir: directory, locationRoot: directory, initialApplication: 'studio' })
  const window = new Window({ settings: { disableCSSFileLoading: true } })
  const previous = { window: globalThis.window, document: globalThis.document }, ctx = owner(), requests = new Set(), toasts = [], requestPaths = []
  globalThis.window = window; globalThis.document = window.document; ctx.on = () => {}
  t.after(async () => {
    try { await ctx.dispose(); await Promise.allSettled([...requests]); await window.happyDOM.close(); await app.close() }
    finally { Object.assign(globalThis, previous); await rm(directory, { recursive: true, force: true }) }
  })
  const request = async (path, method = 'GET', body) => {
    requestPaths.push(path)
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': app.applications.session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json()
    if (!response.ok) throw Object.assign(Error(value.error || response.statusText), { status: response.status })
    return value
  }
  const sdk = {
    application: { id: 'studio', name: '灵感画布', manageData: true },
    storage: { local: window.localStorage }, toast: message => toasts.push(message),
    provide(name, value) { ctx[name] = value },
    mount(name, node) { window.document.body.append(node); ctx.effect(() => () => node.remove()) },
    listen(target, name, fn) { target.addEventListener(name, fn); ctx.effect(() => () => target.removeEventListener(name, fn)) },
    el(tag, props = {}, text) {
      const node = window.document.createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value
        else if (key.startsWith('aria-') || key.startsWith('data-')) node.setAttribute(key, value)
        else node[key] = value
      }
      if (text !== undefined) node.textContent = text
      return node
    },
    request(...args) { const task = request(...args); requests.add(task); task.then(() => requests.delete(task), () => requests.delete(task)); return task },
  }
  const documents = app.ctx.canvasDocuments
  documents.types.register(app.ctx, {
    id: 'dynamic-text', label: '动态文字', fields: ['copy'], output: 'text', defaults: () => ({ copy: '初始文字' }), validate() {},
    resolve(node) { if (node.copy === '不可用') throw Error('来源暂不可用'); return { text: '解析：' + node.copy } },
  })
  app.ctx.imageGeneration.register(app.ctx, {
    id: 'local-fixture', label: '本地测试', public: () => ({ hasKey: true, model: 'local' }),
    prepare() { assert.fail('本测试不得发起生成') },
  })
  await client(ctx, sdk); await canvasUI(ctx, sdk); generation(ctx, sdk)
  return { directory, app, ctx, documents, request, requestPaths, window, toasts, session: ctx.canvasSession, view: ctx.canvasUI }
}

test('轻量轮询在无变化时跳过全量状态，文档、任务及提供者变化时失效', async t => {
  const { request, requestPaths, session, documents, app } = await setup(t)
  await session.refresh({ fresh: true })
  requestPaths.length = 0
  await session.refresh(); await session.refresh()
  assert.deepEqual(requestPaths, ['/api/studio/summary', '/api/studio/summary'])
  const before = await request('/api/studio/summary')
  assert.equal(before.revision, session.state.stateRevision)
  assert.ok(JSON.stringify(before).length < 100)
  await documents.edit(session.boardId, session.board().revision, [{ type: 'add', node: { id: 'remote-text', type: 'text', text: '远端新增' } }])
  requestPaths.length = 0
  await session.refresh()
  assert.deepEqual(requestPaths, ['/api/studio/summary', '/api/studio'])
  assert.equal(session.board().nodes.find(node => node.id === 'remote-text').text, '远端新增')
  const afterEdit = await request('/api/studio/summary')
  await assert.rejects(documents.edit(session.boardId, -1, []))
  assert.deepEqual(await request('/api/studio/summary'), afterEdit, '失败写入不改变版本')
  await documents.records('image-generation').change(tx => tx.records.push({ id: 'summary-job', status: 'interrupted' }))
  await session.refresh()
  assert.equal(session.state.jobs.find(job => job.id === 'summary-job').status, 'interrupted')
  const afterJob = await request('/api/studio/summary')
  app.ctx.imageGeneration.register(app.ctx, { id: 'summary-provider', label: '版本测试', public: () => ({ hasKey: false }), prepare() { assert.fail('不应生成') } })
  assert.notEqual((await request('/api/studio/summary')).revision, afterJob.revision)
  await session.refresh()
  assert.ok(session.state.providers.some(provider => provider.id === 'summary-provider'))
})

test('后台标签暂停轮询，回到前台后同步其他页面的内容', async t => {
  const { session, documents, requestPaths, window } = await setup(t)
  let hidden = true
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden })
  window.document.dispatchEvent(new window.Event('visibilitychange'))
  await documents.edit(session.boardId, session.board().revision, [{ type: 'add', node: { id: 'remote-text', type: 'text', text: '其他页面' } }])
  requestPaths.length = 0
  await session.refresh()
  assert.deepEqual(requestPaths, [])
  assert.equal(session.board().nodes.some(node => node.id === 'remote-text'), false)
  hidden = false
  window.document.dispatchEvent(new window.Event('visibilitychange'))
  for (let i = 0; i < 100 && !session.board().nodes.some(node => node.id === 'remote-text'); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(session.board().nodes.find(node => node.id === 'remote-text')?.text, '其他页面')
})

test('真实 HTTP 编辑、撤销及复制画板均保留解析输出，生成卡无需等待轮询即可重绘', async t => {
  const { directory, request, session, view, window, documents, toasts } = await setup(t)
  await session.edit([
    { type: 'add', node: { id: 'text', type: 'dynamic-text' } },
    { type: 'add', node: { id: 'basic', type: 'text', text: '基础文字' } },
    { type: 'add', node: { id: 'generator', type: 'generator', provider: 'local-fixture', prompt: '补充要求' } },
    { type: 'connect', id: 'custom-edge', from: 'text', to: 'generator' },
    { type: 'connect', id: 'basic-edge', from: 'basic', to: 'generator' },
  ])
  const readText = () => textInputs(session.board(), session.board().nodes.find(node => node.type === 'generator'), new Map(session.state.types.map(type => [type.id, type]))).map(ref => ref.text)
  assert.deepEqual(readText(), ['解析：初始文字', '基础文字'])
  assert.equal(window.document.querySelectorAll('.studio-text-reference').length, 2)
  assert.equal(window.document.querySelector('.studio-generate-run').disabled, false)
  const changed = await session.edit([{ type: 'update', id: 'text', patch: { copy: '已修改' } }])
  assert.deepEqual(readText(), ['解析：已修改', '基础文字'])
  await session.edit(changed.inverse)
  assert.deepEqual(readText(), ['解析：初始文字', '基础文字'])
  await session.saveViewport()
  assert.deepEqual(readText(), ['解析：初始文字', '基础文字'])

  const copy = await request('/api/studio/copy', 'POST', { boardId: session.boardId, revision: session.board().revision, nodeIds: ['text', 'basic', 'generator'] })
  await session.edit(copy.operations)
  assert.equal(window.document.querySelectorAll('.studio-generator').length, 2)
  assert.equal(window.document.querySelectorAll('.studio-text-reference').length, 4)
  const duplicate = await session.duplicateBoard(session.boardId)
  assert.deepEqual(textInputs(duplicate, duplicate.nodes.find(node => node.type === 'generator'), new Map(session.state.types.map(type => [type.id, type]))).map(ref => ref.text), ['解析：初始文字', '基础文字'])
  const full = await request('/api/studio')
  assert.deepEqual(duplicate, full.boards.find(board => board.id === duplicate.id))
  assert.deepEqual(toasts, [])
  assert.ok(documents.read().boards.every(board => board.nodes.every(node => !Object.hasOwn(node, 'resolvedOutput'))))
  const disk = JSON.parse(await readFile(join(directory, 'apps/studio/plugin-data/canvas/studio.json'), 'utf8'))
  assert.ok(disk.boards.every(board => board.nodes.every(node => !Object.hasOwn(node, 'resolvedOutput'))))
  assert.doesNotThrow(() => view.render())
})

test('多页面视口单独保存在本地，不递增共享画板版本或触发另一页面全量刷新', async t => {
  const { request, requestPaths, session, window } = await setup(t)
  const secondWindow = new Window({ settings: { disableCSSFileLoading: true } })
  const { createSession } = await import('../applications/studio/plugins/canvas/session.js')
  const ownerContext = owner()
  ownerContext.on = () => {}
  const requests = new Set()
  t.after(async () => { await ownerContext.dispose(); await Promise.allSettled([...requests]); await secondWindow.happyDOM.close() })
  const secondSdk = { storage: { local: secondWindow.localStorage }, toast() {}, listen(target, name, fn) { target.addEventListener(name, fn); ownerContext.effect(() => target.removeEventListener(name, fn)) }, request(...args) {
    const task = request(...args); requests.add(task); task.then(() => requests.delete(task), () => requests.delete(task)); return task
  } }
  const second = await createSession(ownerContext, secondSdk)
  const revision = session.board().revision
  const serverViewport = structuredClone(session.board().viewport)
  session.viewport = { x: 720, y: -360, zoom: .25 }
  await session.saveViewport()
  assert.equal(session.board().revision, revision)
  assert.deepEqual(session.board().viewport, serverViewport)
  assert.deepEqual(JSON.parse(window.localStorage.getItem('viewport:' + session.boardId)), session.viewport)
  requestPaths.length = 0
  await second.refresh()
  assert.deepEqual(requestPaths, ['/api/studio/summary'])
  assert.deepEqual(second.viewport, serverViewport)
})

test('resolver 暂不可用时画布可编辑、可断线；生成校验保持严格并在来源恢复后恢复', async t => {
  const { session, documents, window, view, toasts } = await setup(t)
  await session.edit([
    { type: 'add', node: { id: 'text', type: 'dynamic-text', copy: '不可用' } },
    { type: 'add', node: { id: 'generator', type: 'generator', provider: 'local-fixture', prompt: '补充' } },
    { type: 'connect', id: 'edge', from: 'text', to: 'generator' },
  ])
  assert.match(window.document.querySelector('[data-input-unavailable]').textContent, /文字输入暂不可用/)
  assert.equal(window.document.querySelector('.studio-generate-run').disabled, true)
  const strictInput = () => generationInput(documents.read().boards[0], 'generator', documents.types)
  assert.throws(strictInput, /来源暂不可用/)
  await session.refresh({ fresh: true }); assert.doesNotThrow(() => view.render())
  await session.edit([{ type: 'update', id: 'generator', patch: { prompt: '仍可保存' } }])
  const disconnect = [...window.document.querySelectorAll('.studio-text-reference button')].find(button => button.textContent === '×')
  await disconnect.onclick()
  assert.equal(session.board().edges.length, 0)
  assert.equal(window.document.querySelector('[data-input-unavailable]'), null)
  await session.edit([{ type: 'connect', id: 'edge', from: 'text', to: 'generator' }])
  await session.edit([{ type: 'update', id: 'text', patch: { copy: '已恢复' } }])
  assert.equal(window.document.querySelector('[data-input-unavailable]'), null)
  assert.equal(window.document.querySelector('.studio-generate-run').disabled, false)
  assert.equal(strictInput().prompt, '解析：已恢复\n\n仍可保存')
  assert.deepEqual(toasts, [])
})
