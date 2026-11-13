import { test } from 'node:test'
import assert from 'node:assert/strict'
import saves from '../client.js'
import { initialRuntime } from '../../project/model.js'
import { owner, setup, settle } from '../../project/test/helpers.js'

async function fixture(t) {
  const f = await setup(t), ctx = owner(), panels = new Map(), toolbars = new Map()
  ctx.narrative = f.engine
  ctx.narrativeUI = {
    registerPanel(owner, descriptor) {
      panels.set(descriptor.id, descriptor)
      owner.effect(() => () => panels.delete(descriptor.id))
    },
    registerToolbar(owner, descriptor) {
      toolbars.set(descriptor.id, descriptor)
      owner.effect(() => () => toolbars.delete(descriptor.id))
    },
  }
  const app = document.createElement('div'); app.className = 'ne-app'; document.body.append(app)
  const container = document.createElement('div'); app.append(container)
  saves(ctx, f.sdk)
  t.after(() => ctx.dispose())
  const render = () => panels.get('saves').render(container)
  const slot = index => container.querySelectorAll('.ne-save-card')[index]
  const click = async (card, label) => {
    const button = [...card.querySelectorAll('button')].find(button => button.textContent === label)
    assert.ok(button, label); button.click(); await settle(); return button
  }
  return { ...f, savesOwner: ctx, panels, toolbars, container, render, slot, click }
}

test('手动存档保存完整且独立的状态，从编辑器恢复对白、属性、历史和一次性事件', async t => {
  const f = await fixture(t), runtime = initialRuntime(f.engine.project)
  runtime.lineIndex = 1; runtime.text = structuredClone(f.engine.project.nodes[0].lines[1])
  runtime.variables.trust = 3; runtime.stage.expression = 'happy'
  runtime.transcript = [{ role: 'user', name: '你', text: '今晚一起等流星' }]
  runtime.visited = ['arrival']; runtime.firedRules = ['first-gift']; runtime.log = [{ event: 'gift.give', status: 'done' }]
  f.engine.restoreRuntime(runtime); f.render()
  await f.click(f.slot(1), '保存进度')
  const stored = JSON.parse(f.window.localStorage.getItem('save:first:1'))
  assert.equal(stored.projectId, 'first')
  assert.equal(stored.revision, f.engine.project.revision)
  assert.equal(stored.label, f.engine.scene().title)
  assert.ok(Number.isFinite(Date.parse(stored.updatedAt)))
  assert.deepEqual(stored.runtime, runtime)
  f.engine.transact(state => { state.variables.trust = 8; state.transcript[0].text = '后来的对白' })
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('save:first:1')).runtime, runtime)
  f.engine.stop(); f.render()
  await f.click(f.slot(1), '继续游玩')
  assert.equal(f.engine.mode, 'play')
  assert.deepEqual(f.engine.runtime, runtime)
  assert.equal(f.engine.runtime.busy, false)
})

test('生成中的手动存档拒绝覆盖已有进度，并把异步点击异常显示为通知', async t => {
  const f = await fixture(t)
  f.engine.restoreRuntime(initialRuntime(f.engine.project)); f.render()
  await f.click(f.slot(1), '保存进度')
  const saved = f.window.localStorage.getItem('save:first:1')
  f.engine.transact(state => { state.busy = true; state.variables.trust = 5 })
  await f.click(f.slot(1), '覆盖存档')
  assert.equal(f.window.localStorage.getItem('save:first:1'), saved)
  assert.match(f.toasts.at(-1), /等待当前对话结束/)
})

test('作品版本变化后禁用旧存档，旧按钮事件也不能绕过版本保护', async t => {
  const f = await fixture(t)
  f.engine.restoreRuntime(initialRuntime(f.engine.project)); f.render()
  await f.click(f.slot(1), '保存进度')
  const oldContinue = [...f.slot(1).querySelectorAll('button')].find(button => button.textContent === '继续游玩')
  f.engine.stop()
  f.engine.update(value => { value.nodes[0].lines[0].text = '新的剧情版本' }); await f.engine.save()
  oldContinue.click(); await settle()
  assert.equal(f.engine.mode, 'edit')
  assert.equal(f.engine.runtime, null)
  assert.match(f.toasts.at(-1), /旧存档不再匹配/)
  f.render()
  assert.match(f.slot(1).textContent, /版本已变化/)
  assert.equal([...f.slot(1).querySelectorAll('button')].find(button => button.textContent === '继续游玩').disabled, true)
})

test('损坏存档不会改变当前状态，损坏 JSON 作为空存档显示', async t => {
  const f = await fixture(t)
  f.window.localStorage.setItem('save:first:1', '{damaged')
  f.window.localStorage.setItem('save:first:2', JSON.stringify({ projectId: 'first', revision: 0, label: '损坏进度', updatedAt: new Date().toISOString(), runtime: { nodeId: 'missing' } }))
  f.render()
  assert.match(f.slot(1).textContent, /空/)
  await f.click(f.slot(2), '继续游玩')
  assert.equal(f.engine.mode, 'edit')
  assert.equal(f.engine.runtime, null)
  assert.match(f.toasts.at(-1), /存档数据无效/)
})

test('自动进度固定捕获时的作品和状态，切换作品后不串档，卸载会刷新最后进度', async t => {
  const f = await fixture(t)
  const first = initialRuntime(f.engine.project); first.variables.trust = 2
  f.engine.restoreRuntime(first)
  await f.engine.open('second')
  t.mock.timers.tick(250)
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('save:first:auto')).runtime, first)
  assert.equal(f.window.localStorage.getItem('save:second:auto'), null)
  f.render(); assert.match(f.slot(0).textContent, /空/)
  const second = initialRuntime(f.engine.project); second.variables.trust = 6
  f.engine.restoreRuntime(second)
  f.engine.transact(state => { state.busy = true; state.variables.trust = 9 })
  await f.savesOwner.dispose()
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('save:second:auto')).runtime, second, '在途的半轮聊天不能覆盖最后完成的进度')
  assert.deepEqual(JSON.parse(f.window.localStorage.getItem('save:first:auto')).runtime, first)
  assert.equal(f.panels.size, 0); assert.equal(f.toolbars.size, 0)
  const after = f.window.localStorage.getItem('save:second:auto')
  f.engine.transact(state => { state.busy = false; state.variables.trust = 1 })
  t.mock.timers.tick(1000)
  assert.equal(f.window.localStorage.getItem('save:second:auto'), after, '停用后不能继续订阅并写入存档')
})

test('自动存档失败提示存储错误，停用清理已打开的存档窗口', async t => {
  const f = await fixture(t)
  f.engine.restoreRuntime(initialRuntime(f.engine.project))
  t.mock.method(f.sdk.storage.local, 'setItem', () => { throw Error('quota exceeded') })
  t.mock.timers.tick(250)
  assert.ok(f.toasts.some(message => /自动进度保存失败/.test(message)))
  f.toolbars.get('save-dialog').run()
  assert.ok(document.querySelector('.ne-saves-dialog'))
  await f.savesOwner.dispose()
  assert.equal(document.querySelector('.ne-saves-dialog'), null)
})
