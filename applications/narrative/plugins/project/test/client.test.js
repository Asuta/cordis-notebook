import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deferred, owner, setup, settle } from './helpers.js'

test('无效编辑保持原作品，导出独立，未知素材不产生错误 URL', async t => {
  const f = await setup(t), events = [], listener = owner()
  t.after(() => listener.dispose())
  f.engine.observe(listener, event => events.push(event))
  const before = f.engine.exportProject(), version = f.engine.version
  assert.throws(() => f.engine.update(value => { value.title = ' ' }), /基本信息/)
  assert.deepEqual(f.engine.project, before)
  assert.equal(f.engine.version, version)
  assert.equal(f.window.localStorage.getItem('draft:first'), null)
  assert.equal(f.puts().length, 0)
  const exported = f.engine.exportProject(); exported.nodes[0].lines[0].text = '只改导出对象'
  assert.deepEqual(f.engine.project, before)
  assert.equal(f.engine.asset('missing'), '')
  assert.equal(f.engine.asset('lin'), '/builtin/project/assets/lin.png')
  f.engine.update(value => { value.title = '表单中的新标题' }, { render: false })
  assert.ok(events.some(event => event.type === 'project' && event.render === false))
  assert.equal(f.engine.runtime, null, '编辑预览不能启动剧情')
  await f.engine.save()
})

test('保存期间再次编辑会追加最新版本保存，草稿仅在全部写入成功后删除', async t => {
  const f = await setup(t), entered = deferred(), release = deferred()
  t.after(() => release.resolve())
  f.control.before = async request => {
    if (request.method === 'PUT' && f.puts().length === 1) { entered.resolve(); await release.promise }
  }
  f.engine.update(value => { value.title = '第一次修改' })
  const unload = new f.window.Event('beforeunload', { cancelable: true })
  f.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true)
  const saving = f.engine.save(); await entered.promise
  f.engine.update(value => { value.title = '保存中继续修改' })
  const secondSave = f.engine.save()
  assert.equal(f.puts().length, 1, '并行刷新不能产生两个同版本请求')
  assert.equal(JSON.parse(f.window.localStorage.getItem('draft:first')).title, '保存中继续修改')
  release.resolve(); await Promise.all([saving, secondSave])
  assert.deepEqual(f.puts().map(request => [request.body.revision, request.body.title]), [[0, '第一次修改'], [1, '保存中继续修改']])
  assert.equal(f.records.get('first').title, '保存中继续修改')
  assert.equal(f.engine.project.revision, 2)
  assert.equal(f.engine.status, '已保存')
  assert.equal(f.window.localStorage.getItem('draft:first'), null)
  const cleanUnload = new f.window.Event('beforeunload', { cancelable: true })
  f.window.dispatchEvent(cleanUnload); assert.equal(cleanUnload.defaultPrevented, false)
})

test('保存冲突阻止切换与停用，保留草稿，释放停用保护后可以重试', async t => {
  const f = await setup(t)
  f.control.before = request => { if (request.method === 'PUT') throw Object.assign(Error('服务器版本冲突'), { status: 409 }) }
  f.engine.update(value => { value.description = '尚未保存的本地修改' })
  await assert.rejects(f.engine.open('second'), /版本冲突/)
  assert.equal(f.engine.project.id, 'first')
  assert.equal(f.requests.some(request => request.path.endsWith('/second')), false)
  let release
  await assert.rejects(f.ctx.hooks.get('plugins/before-stop')({ hold(callback) { release = callback } }), /版本冲突/)
  assert.equal(f.engine.held, true)
  assert.throws(() => f.engine.update(() => {}), /返回编辑器/)
  assert.equal(JSON.parse(f.window.localStorage.getItem('draft:first')).description, '尚未保存的本地修改')
  release(); assert.equal(f.engine.held, false)
  f.control.before = null
  await f.engine.save()
  assert.equal(f.window.localStorage.getItem('draft:first'), null)
  await f.engine.open('second')
  assert.equal(f.engine.project.id, 'second')
  assert.equal(f.window.localStorage.getItem('current-project'), 'second')
})

test('切换操作和停用等待在途读取，期间阻止写入和重复切换', async t => {
  const f = await setup(t), entered = deferred(), release = deferred()
  t.after(() => release.resolve())
  f.engine.update(value => { value.title = '切换前必须保存' })
  f.control.before = async request => {
    if (request.path.endsWith('/second') && request.method === 'GET') { entered.resolve(); await release.promise }
  }
  const opening = f.engine.open('second'); await entered.promise
  assert.equal(f.records.get('first').title, '切换前必须保存')
  assert.throws(() => f.engine.update(() => {}), /返回编辑器/)
  await assert.rejects(f.engine.create('hybrid'), /稍后再试/)
  let resume, stopped = false
  const stopping = f.ctx.hooks.get('plugins/before-stop')({ hold(callback) { resume = callback } }).then(() => { stopped = true })
  await settle(); assert.equal(stopped, false)
  assert.equal(f.engine.held, true)
  release.resolve(); await opening; await stopping
  assert.equal(f.engine.project.id, 'second')
  assert.equal(f.engine.mode, 'edit')
  assert.equal(f.engine.runtime, null)
  resume(); assert.equal(f.engine.held, false)
})

test('恢复同版本草稿并保存，其他版本与损坏草稿留在本机', async t => {
  await t.test('相同版本', async t => {
    const f = await setup(t, { draft(value) { value.title = '恢复的草稿'; return value } })
    assert.equal(f.engine.project.title, '恢复的草稿')
    await f.engine.save()
    assert.equal(f.records.get('first').title, '恢复的草稿')
    assert.equal(f.window.localStorage.getItem('draft:first'), null)
  })
  await t.test('其他版本', async t => {
    const f = await setup(t, { draft(value) { value.revision = 4; value.title = '其他页面的草稿'; return value } })
    assert.equal(f.engine.project.title, '第一个故事')
    await f.engine.save(); assert.equal(f.puts().length, 0)
    assert.equal(JSON.parse(f.window.localStorage.getItem('draft:first')).title, '其他页面的草稿')
    assert.ok(f.toasts.some(message => /另一版本/.test(message)))
  })
  await t.test('损坏 JSON', async t => {
    const f = await setup(t, { draft: () => '{damaged' })
    assert.equal(f.engine.project.title, '第一个故事')
    assert.equal(f.window.localStorage.getItem('draft:first'), '{damaged')
    assert.ok(f.toasts.some(message => /草稿无法读取/.test(message)))
  })
})

test('远程停用和卸载保留脏草稿，卸载清除自动保存与离页监听', async t => {
  const f = await setup(t)
  f.engine.update(value => { value.title = '卸载前的修改' })
  f.window.localStorage.removeItem('draft:first')
  f.ctx.hooks.get('plugins/remote-stop')()
  assert.equal(JSON.parse(f.window.localStorage.getItem('draft:first')).title, '卸载前的修改')
  f.window.localStorage.removeItem('draft:first')
  await f.ctx.dispose()
  assert.equal(JSON.parse(f.window.localStorage.getItem('draft:first')).title, '卸载前的修改')
  t.mock.timers.tick(1000); await settle()
  assert.equal(f.puts().length, 0)
  const unload = new f.window.Event('beforeunload', { cancelable: true })
  f.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, false)
})

test('节点、动作、条件和事件注册随插件释放，异步动作严格按顺序执行', async t => {
  const f = await setup(t), plugin = owner(), listener = owner(), events = [], order = [], gate = deferred()
  t.after(async () => { gate.resolve(); await plugin.dispose(); await listener.dispose() })
  f.engine.observe(listener, event => events.push(event.type))
  f.engine.registerNode(plugin, { type: 'story', label: '剧情' })
  assert.throws(() => f.engine.registerNode(plugin, { type: 'story' }), /重复登记/)
  f.engine.registerAction(plugin, { type: 'first-action', async execute() { order.push('start'); await gate.promise; order.push('finished') } })
  f.engine.registerAction(plugin, { type: 'second-action', execute() { order.push('second') } })
  f.engine.registerCondition(plugin, { type: 'custom', test: condition => condition.value === 1 })
  assert.equal(f.engine.test(null), true)
  assert.equal(f.engine.test({ type: 'missing' }), false)
  assert.equal(f.engine.test({ type: 'custom', value: 1 }), true)
  const running = f.engine.runActions([{ type: 'first-action' }, { type: 'second-action' }])
  await settle(); assert.deepEqual(order, ['start'])
  gate.resolve(); await running
  assert.deepEqual(order, ['start', 'finished', 'second'])
  await assert.rejects(f.engine.runActions([{ type: 'missing' }]), /动作插件未启用/)
  let calls = 0
  f.engine.onEvent(plugin, async () => { await Promise.resolve(); calls++ })
  await f.engine.emit('test'); assert.equal(calls, 1)
  await plugin.dispose()
  assert.deepEqual(f.engine.nodeTypes(), [])
  assert.deepEqual(f.engine.actions(), [])
  assert.equal(f.engine.test({ type: 'custom', value: 1 }), false)
  await f.engine.emit('test'); assert.equal(calls, 1)
  assert.ok(events.filter(type => type === 'registry').length >= 2)
  f.engine.registerNode(listener, { type: 'story' })
  assert.equal(f.engine.nodeTypes().length, 1, '停用后同名能力可以重新注册')
})

test('缺失插件和异步节点异常显示可恢复错误，试玩禁止修改作品', async t => {
  const f = await setup(t), plugin = owner()
  t.after(() => plugin.dispose())
  await f.engine.play()
  assert.match(f.engine.runtime.error, /缺少.*story.*节点插件/)
  f.engine.stop()
  let failEnter = true
  f.engine.registerNode(plugin, { type: 'story', async enter() { await Promise.resolve(); if (failEnter) throw Error('进入节点失败') }, async advance() { await Promise.resolve(); throw Error('下一句失败') } })
  await f.engine.play()
  assert.equal(f.engine.runtime.error, '进入节点失败')
  assert.ok(f.toasts.includes('进入节点失败'))
  assert.throws(() => f.engine.update(() => {}), /返回编辑器/)
  failEnter = false; await f.engine.go('arrival')
  assert.equal(f.engine.runtime.error, '')
  await f.engine.advance()
  assert.equal(f.engine.runtime.error, '下一句失败')
  await assert.rejects(f.engine.go('missing'), /找不到目标节点/)
  assert.equal(f.engine.runtime.nodeId, 'arrival')
  f.engine.stop(); assert.equal(f.engine.runtime, null)
})

test('递归事件跳转被阻止，移除循环插件后可以继续剧情', async t => {
  const f = await setup(t), plugin = owner(), loop = owner()
  t.after(async () => { await loop.dispose(); await plugin.dispose() })
  f.engine.registerNode(plugin, { type: 'story' })
  f.engine.onEvent(loop, async event => { if (event === 'node.enter') await f.engine.go('arrival') })
  await f.engine.play()
  assert.match(f.engine.runtime.error, /跳转次数过多/)
  await loop.dispose(); await f.engine.go('arrival')
  assert.equal(f.engine.runtime.error, '')
})

test('Agent 编辑拒绝过期版本及其他作品，成功编辑使用相同保存与校验流程', async t => {
  const f = await setup(t), read = f.tools.get('narrative_read'), edit = f.tools.get('narrative_edit')
  const stale = read()
  f.engine.update(value => { value.title = '手动修改' })
  await assert.rejects(edit({ version: stale.version, project: stale.project }), /版本已变化/)
  const current = read(), other = structuredClone(current.project); other.id = 'second'
  await assert.rejects(edit({ version: current.version, project: other }), /版本已变化/)
  current.project.description = 'Agent 补充的说明'
  await edit({ version: current.version, project: current.project })
  assert.equal(f.records.get('first').title, '手动修改')
  assert.equal(f.records.get('first').description, 'Agent 补充的说明')
  assert.equal(f.window.localStorage.getItem('draft:first'), null)
})
