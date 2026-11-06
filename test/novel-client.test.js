import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/novel/plugins/game/client.js'
import { blankProject } from '../applications/novel/plugins/game/model.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function setup(t) {
  const window = new Window(), previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node }
  Object.assign(globalThis, { window, document: window.document, Node: window.Node })
  const cleanups = [], hooks = new Map(), tools = new Map(), records = new Map([
    ['first', blankProject('第一个故事', 'first')], ['second', blankProject('第二个故事', 'second')],
  ])
  const gate = { match: null, wait: null, entered: null }
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    mount: (name, node) => window.document.body.append(node), storage: { local: window.localStorage },
    agent: { register: (definition, callback) => tools.set(definition.name, callback) },
    listen: (target, name, fn) => { target.addEventListener(name, fn); cleanups.push(() => target.removeEventListener(name, fn)) },
    async request(path, method = 'GET', body) {
      if (gate.match?.(path, method)) { gate.entered.resolve(); await gate.wait.promise }
      if (path === '/api/novel/projects') return [...records.values()].map(p => ({ id: p.id, title: p.title, scenes: p.scenes.length }))
      const id = path.split('/').at(-1), current = records.get(id)
      assert.ok(current, path)
      if (method === 'PUT') {
        assert.equal(body.revision, current.revision, '并发保存使用最新版本')
        records.set(id, { ...structuredClone(body), revision: current.revision + 1 })
      }
      return structuredClone(records.get(id))
    },
  }
  t.after(async () => { for (const cleanup of cleanups.reverse()) await cleanup?.(); Object.assign(globalThis, previous); await window.happyDOM.close() })
  await client(ctx, sdk)
  const call = (name, args = {}) => tools.get(name)(args)
  return { window, records, gate, hooks, call, root: window.document.querySelector('.novel-app') }
}

test('视觉小说 Agent 与手工编辑共用版本保护，拒绝陈旧编辑并保留未保存草稿', async t => {
  const f = await setup(t)
  await f.call('novel_open', { id: 'first' })
  const before = await f.call('novel_read')
  const title = f.root.querySelector('.novel-story-main > .novel-field input')
  title.value = '用户刚修改的场景'; title.dispatchEvent(new f.window.Event('input'))
  const operations = [{ type: 'set_project', patch: { description: 'Agent 补充简介' } }]
  await assert.rejects(f.call('novel_edit', { projectId: 'first', localVersion: before.localVersion, operations }), /重新 novel_read/)
  const current = await f.call('novel_read')
  assert.equal(current.project.scenes[0].title, title.value)
  await f.call('novel_edit', { projectId: 'first', localVersion: current.localVersion, operations })
  assert.equal(f.records.get('first').scenes[0].title, title.value)
  assert.equal(f.records.get('first').description, 'Agent 补充简介')
  assert.equal(f.window.localStorage.getItem('draft-first'), null)
  await f.call('novel_open', { id: 'second' })
  await assert.rejects(f.call('novel_edit', { projectId: 'first', localVersion: 0, operations }), /重新 novel_read/)
  assert.equal(f.records.get('second').description, '')
})

test('视觉小说切换与保存期间阻止其他写入，插件热更新等待在途操作', async t => {
  const f = await setup(t)
  await f.call('novel_open', { id: 'first' })
  Object.assign(f.gate, { match: (path, method) => path.endsWith('/second') && method === 'GET', wait: deferred(), entered: deferred() })
  const opening = f.call('novel_open', { id: 'second' })
  await f.gate.entered.promise
  assert.equal(f.root.inert, true)
  await assert.rejects(f.call('novel_open', { id: 'first' }), /稍后再试/)
  await assert.rejects(f.call('novel_edit', { projectId: 'first', localVersion: 0, operations: [{ type: 'set_project', patch: { title: '不应写入' } }] }), /重新 novel_read/)
  let release, stopped = false
  const stopping = f.hooks.get('plugins/before-stop')({ hold: fn => { release = fn } }).then(() => { stopped = true })
  await Promise.resolve(); assert.equal(stopped, false)
  f.gate.wait.resolve(); await opening; await stopping
  assert.equal(f.root.inert, true); release(); assert.equal(f.root.inert, false)
  assert.equal((await f.call('novel_read')).project.id, 'second')
  assert.equal(f.records.get('first').title, '第一个故事')
})
