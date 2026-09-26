import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Context, Service } from 'cordis'
import drawing from '../applications/drawing/plugins/canvas/client.js'
import notebook from '../applications/notebook/plugins/notebook/client.js'
import { noteFormats } from '../applications/notebook/plugins/note-formats/server.js'
import { formatPlain } from '../applications/notebook/plugins/format-plain/server.js'
import { applicationStorage } from '../client/host/application-storage.js'
import { StopCoordinator } from '../client/host/stop-coordinator.js'
import { createHost } from '../server/server.js'

const turn = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function browser(t) {
  const window = new Window(), previous = new Map(), roots = []
  for (const [key, value] of Object.entries({ window, document: window.document, localStorage: window.localStorage, sessionStorage: window.sessionStorage })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  window.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {} })
  t.after(async () => {
    for (const root of roots) await root.fiber.dispose()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { window, context() { const root = new Context(); roots.push(root); return root } }
}

function sdkFor(ctx, app, plugin) {
  return {
    storage: { local: applicationStorage(localStorage, app, plugin), session: applicationStorage(sessionStorage, app, plugin) },
    el(tag, props = {}, text) {
      const node = document.createElement(tag)
      for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value
        else if (key.startsWith('aria-')) node.setAttribute(key, value)
        else node[key] = value
      }
      if (text !== undefined) node.textContent = text
      return node
    },
    mount(slot, node) { document.body.append(node); ctx.effect(() => () => node.remove()) },
    listen(target, event, fn) { target.addEventListener(event, fn); ctx.effect(() => () => target.removeEventListener(event, fn)) },
    provide(name, value) { const service = new Service(ctx, name); Object.defineProperties(service, Object.getOwnPropertyDescriptors(value)); return service },
    onConfig() {},
  }
}

async function drawingFixture(t, beforePost) {
  const { window, context } = browser(t), root = context(), calls = [], messages = []
  const dir = await mkdtemp(join(tmpdir(), 'cordis-drawing-save-'))
  const backend = await createHost({ port: 0, dataDir: dir, initialApplication: 'drawing' })
  t.after(async () => { await backend.close(); await rm(dir, { recursive: true, force: true }) })
  const address = 'http://127.0.0.1:' + backend.server.address().port
  let sdk
  await root.plugin(ctx => {
    sdk = { ...sdkFor(ctx, 'drawing', 'canvas'), config: { brushSize: 6 }, toast: text => messages.push(text),
      async request(path, method = 'GET', payload) {
        if (method === 'POST') { calls.push(structuredClone(payload)); await beforePost(calls.length) }
        const response = await fetch(address + path, {
          method, headers: { 'Content-Type': 'application/json', 'X-Application-Session': backend.applications.session },
          body: payload === undefined ? undefined : JSON.stringify(payload),
        })
        const result = await response.json()
        if (!response.ok) throw Object.assign(Error(result.error), { status: response.status })
        return result
      },
    }
    return drawing(ctx, sdk)
  })
  const title = document.querySelector('[aria-label="作品标题"]'), status = document.querySelector('.drawing-toolbar button:last-child')
  return { root, backend, sdk, calls, messages, status,
    edit(value) { title.value = value; title.dispatchEvent(new window.Event('input')) },
    draftKey: 'draft-' + sdk.storage.session.getItem('tab-id'),
    stop: new StopCoordinator(root),
  }
}

test('画图并发保存与应用切换共用完整保存流程，期间的新修改只提交一次', { timeout: 15000 }, async t => {
  const first = deferred(), second = deferred(), firstEntered = deferred(), secondEntered = deferred()
  t.after(() => { first.resolve(); second.resolve() })
  const f = await drawingFixture(t, async count => {
    if (count === 1) { firstEntered.resolve(); await first.promise }
    if (count === 2) { secondEntered.resolve(); await second.promise }
  })
  f.edit('第一版'); f.status.click(); await firstEntered.promise
  f.edit('第二版'); f.status.click()
  let switched = false
  const switching = f.stop.run({ reason: 'application', targets: ['canvas'] }, async () => {
    assert.equal(f.backend.ctx.drawingStorage.read().title, '第二版')
    assert.equal(f.sdk.storage.local.getItem(f.draftKey), null)
    await f.backend.applications.switch(null, f.backend.applications.session)
    switched = true
  })
  // Attach a handler immediately so a regression is reported by assertions, not an unhandled rejection.
  const outcome = switching.then(() => null, error => error)
  await turn(); first.resolve(); await secondEntered.promise
  assert.equal(switched, false)
  assert.equal(JSON.parse(f.sdk.storage.local.getItem(f.draftKey)).title, '第二版')
  second.resolve()
  assert.equal(await outcome, null)
  assert.equal(switched, true)
  assert.deepEqual(f.calls.map(({ title, revision }) => ({ title, revision })), [{ title: '第一版', revision: 0 }, { title: '第二版', revision: 1 }])
  assert.deepEqual(f.messages, [])
})

test('画图共享保存失败时保留草稿并取消切换，之后可以重试', { timeout: 15000 }, async t => {
  const gate = deferred(), entered = deferred()
  t.after(() => gate.resolve())
  const f = await drawingFixture(t, async count => {
    if (count === 1) { entered.resolve(); await gate.promise; throw Error('模拟网络中断') }
  })
  f.edit('保留的草稿'); f.status.click(); await entered.promise
  let switched = false
  const change = { reason: 'application', targets: ['canvas'] }
  const failure = assert.rejects(f.stop.run(change, () => { switched = true }), /模拟网络中断/)
  await turn(); gate.resolve(); await failure
  assert.equal(switched, false)
  assert.equal(document.querySelector('.drawing-app').inert, false)
  assert.equal(JSON.parse(f.sdk.storage.local.getItem(f.draftKey)).title, '保留的草稿')
  assert.equal(f.calls.length, 1)
  await f.stop.run(change, () => { switched = true })
  assert.equal(switched, true)
  assert.equal(f.backend.ctx.drawingStorage.read().title, '保留的草稿')
  assert.equal(f.sdk.storage.local.getItem(f.draftKey), null)
  assert.equal(f.calls.length, 2)
})

const note = { id: 'note-a', type: 'plain', title: '已保存标题', content: '正文', pinned: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' }
const draftKey = tab => 'cordis-notebook-draft-v2-' + tab
const draft = title => JSON.stringify({ ...note, title })
async function openNotebook(context) {
  const root = context(), messages = []
  await root.plugin(noteFormats); await root.plugin(formatPlain)
  await root.plugin(ctx => {
    new Service(ctx, 'notesApi').request = async (path, method, data) => method === 'PATCH' ? { ...note, ...data } : [structuredClone(note)]
  })
  await root.plugin({ inject: ['notesApi', 'noteFormats'], apply: ctx => notebook(ctx, {
    ...sdkFor(ctx, 'notebook', 'notebook'), config: { autosaveMs: 60000 },
    application: { id: 'notebook', legacyBrowserStorage: true }, toast: text => messages.push(text),
  }) })
  assert.deepEqual(messages, [])
  return root
}

test('旧标签页稍后升级时恢复其最新草稿，不由其他标签页提前迁移', async t => {
  const { context } = browser(t)
  const scoped = applicationStorage(localStorage, 'notebook', 'notebook')
  localStorage.setItem(draftKey('old-tab'), draft('较早草稿'))
  const firstPage = await openNotebook(context)
  assert.equal(scoped.getItem(draftKey('old-tab')), null)
  await firstPage.fiber.dispose()
  localStorage.setItem(draftKey('old-tab'), draft('最后编辑的草稿'))
  sessionStorage.clear(); sessionStorage.setItem('cordis-tab-id', 'old-tab')
  const laterPage = await openNotebook(context)
  assert.equal(laterPage.notebook.current().title, '最后编辑的草稿')
  assert.equal(laterPage.notebook.dirty, true)
  assert.equal(JSON.parse(localStorage.getItem(draftKey('old-tab'))).title, '最后编辑的草稿')
  laterPage.notebook.edit({ title: '新版继续编辑' })
  await laterPage.fiber.dispose()
  const reopened = await openNotebook(context)
  assert.equal(reopened.notebook.current().title, '新版继续编辑')
  await reopened.notebook.flush(); await reopened.fiber.dispose()
  const saved = await openNotebook(context)
  assert.equal(saved.notebook.dirty, false, '保存并清理新版草稿后不能再次恢复旧草稿')
  await saved.fiber.dispose()
  sessionStorage.clear(); sessionStorage.setItem('cordis-tab-id', 'old-tab')
  const restoredSession = await openNotebook(context)
  assert.equal(restoredSession.notebook.dirty, false, '恢复仅含旧会话键的标签页也不能重复导入同一草稿')
})

test('先前全局迁移留下的旧副本不会遮住尚未升级标签页的最新草稿', async t => {
  const { context } = browser(t)
  const scoped = applicationStorage(localStorage, 'notebook', 'notebook')
  scoped.setItem('legacy-imported', '1')
  scoped.setItem(draftKey('old-tab'), draft('提前复制的旧副本'))
  localStorage.setItem(draftKey('old-tab'), draft('仍在旧版编辑的最新草稿'))
  sessionStorage.setItem('cordis-tab-id', 'old-tab')
  const root = await openNotebook(context)
  assert.equal(root.notebook.current().title, '仍在旧版编辑的最新草稿')
})

test('旧标签页已保存清理草稿后，升级不会恢复先前提前复制的副本', async t => {
  const { context } = browser(t)
  const scoped = applicationStorage(localStorage, 'notebook', 'notebook')
  scoped.setItem('legacy-imported', '1')
  scoped.setItem(draftKey('old-tab'), draft('已经保存的旧副本'))
  sessionStorage.setItem('cordis-tab-id', 'old-tab')
  const root = await openNotebook(context)
  assert.equal(root.notebook.dirty, false)
  assert.equal(scoped.getItem(draftKey('old-tab')), null)
})

test('已经使用新版存储的标签页保持自己的草稿，不被旧备份覆盖', async t => {
  const { context } = browser(t)
  const local = applicationStorage(localStorage, 'notebook', 'notebook'), session = applicationStorage(sessionStorage, 'notebook', 'notebook')
  localStorage.setItem(draftKey('same-tab'), draft('旧备份'))
  sessionStorage.setItem('cordis-tab-id', 'same-tab')
  session.setItem('cordis-tab-id', 'same-tab')
  local.setItem(draftKey('same-tab'), draft('新版最新草稿'))
  const root = await openNotebook(context)
  assert.equal(root.notebook.current().title, '新版最新草稿')
})
