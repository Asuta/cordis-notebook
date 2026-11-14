import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'
import client from '../applications/novel/plugins/game/client.js'
import { blankProject, upgradeProject, syncLegacy } from '../applications/novel/plugins/game/model.js'
import { animationPresets } from '../applications/novel/plugins/game/effects.js'
import { blankModel, modelSummary } from '../applications/novel/plugins/game/live2d/document.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('Agent 创建可复用动画并用于真实试玩，校验失败不改变作品，引用中的动画不能删除', async t => {
  const f = await setup(t); await f.call('novel_open', {id:'first'})
  let read = await f.call('novel_read'), scene = read.project.scenes[0]
  const animation = structuredClone(animationPresets[0]), command = {id:'animated-bg',type:'animate',target:'background',characterId:'',animationId:animation.id}
  await f.call('novel_edit',{projectId:'first',localVersion:read.localVersion,operations:[{type:'upsert_animation',value:animation},{type:'upsert_command',sceneId:scene.id,value:command,index:0}]})
  read = await f.call('novel_read'); assert.deepEqual(read.project.animations,[animation])
  await assert.rejects(f.call('novel_edit',{projectId:'first',localVersion:read.localVersion,operations:[{type:'remove_animation',id:animation.id}]}), /仍被剧情引用/)
  await assert.rejects(f.call('novel_edit',{projectId:'first',localVersion:read.localVersion,operations:[{type:'upsert_animation',value:{...animation,duration:-1}}]}), /关键帧/)
  assert.equal((await f.call('novel_read')).localVersion,read.localVersion)
  const playing = await f.call('novel_play',{action:'start',projectId:'first'});assert.equal(playing.stage.animations.background.animation.id,animation.id)
  await f.call('novel_play',{action:'exit'});read = await f.call('novel_read')
  await f.call('novel_edit',{projectId:'first',localVersion:read.localVersion,operations:[{type:'remove_command',sceneId:scene.id,id:command.id},{type:'remove_animation',id:animation.id}]})
  assert.deepEqual((await f.call('novel_read')).project.animations,[])
})
async function setup(t) {
  const window = new Window(), previous = { window: globalThis.window, document: globalThis.document, Node: globalThis.Node }
  Object.assign(globalThis, { window, document: window.document, Node: window.Node })
  const cleanups = [], hooks = new Map(), tools = new Map(), records = new Map([
    ['first', blankProject('第一个故事', 'first')], ['second', blankProject('第二个故事', 'second')],
  ])
  const gate = { match: null, wait: null, entered: null }, models = new Map()
  const ctx = { effect: fn => cleanups.push(fn()), on: (name, fn) => hooks.set(name, fn) }
  const sdk = {
    mount: (name, node) => window.document.body.append(node), storage: { local: window.localStorage },
    agent: { register: (definition, callback) => tools.set(definition.name, callback) },
    listen: (target, name, fn) => { target.addEventListener(name, fn); cleanups.push(() => target.removeEventListener(name, fn)) },
    async request(path, method = 'GET', body) {
      if (path === '/api/applications') return { session: 'novel-client-test-session' }
      if (gate.match?.(path, method)) { gate.entered.resolve(); await gate.wait.promise }
      if (path === '/api/novel/projects') return [...records.values()].map(p => ({ id: p.id, title: p.title, scenes: p.scenes.length }))
      if (path.includes('/models')) {
        const parts = path.split('/'), project = records.get(parts[4]), mid = parts[6]
        if (method === 'GET') return structuredClone(models.get(mid))
        const m = method === 'POST' ? body.model || blankModel(body.name) : structuredClone(body.model)
        if (method === 'POST') { m.id = 'model-' + (models.size + 1); m.revision = 1 }
        else { assert.equal(body.expectedRevision, models.get(mid).revision); m.revision++ }
        models.set(m.id, structuredClone(m)); project.models ||= []; const at = project.models.findIndex(x => x.id === m.id)
        if (at < 0) project.models.push(modelSummary(m)); else project.models[at] = modelSummary(m)
        project.revision++; return { project: structuredClone(project), model: structuredClone(m) }
      }
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
  return { window, records, models, gate, hooks, call, root: window.document.querySelector('.novel-app') }
}

test('工作台模型工具与角色工作室共享手工修改、撤销与作品切换保存', async t => {
  const f = await setup(t); await f.call('novel_open', { id: 'first' })
  const initial = await f.call('novel_model_create', { name: '手工与 Agent' })
  assert.equal(initial.model.name, '手工与 Agent'); assert.ok(f.root.querySelector('.rig-studio'))
  const name = [...f.root.querySelectorAll('.rig-sidebar label')].find(n => n.textContent.includes('模型名称')).querySelector('input')
  name.value = '手工命名'; name.dispatchEvent(new f.window.Event('change'))
  let read = await f.call('novel_model_read'); assert.equal(read.model.name, '手工命名')
  await assert.rejects(f.call('novel_model_edit', { modelId: read.model.id, localVersion: initial.localVersion, operations: [{ type: 'rename', name: '陈旧覆盖' }] }), /变化/)
  await f.call('novel_model_edit', { modelId: read.model.id, localVersion: read.localVersion, operations: [{ type: 'rename', name: 'Agent 命名' }] })
  read = await f.call('novel_model_read')
  await f.call('novel_model_history', { modelId: read.model.id, localVersion: read.localVersion, direction: 'undo' })
  read = await f.call('novel_model_read'); assert.equal(read.model.name, '手工命名')
  await f.call('novel_model_edit', { modelId: read.model.id, localVersion: read.localVersion, operations: [{ type: 'rename', name: '最终模型' }] })
  await f.call('novel_open', { id: 'second' }); assert.equal((await f.call('novel_model_read')).model, null)
  assert.equal(f.models.get(read.model.id).name, '最终模型'); assert.equal(f.records.get('second').models, undefined)
})

function playFixture(f) {
  const p = upgradeProject(f.records.get('first')), scene = p.scenes[0]
  p.variables = [{ id: 'trust', name: '好感', kind: 'affinity', initial: 0 }, { id: 'unlocked', name: '结局记忆', kind: 'boolean', initial: false, scope: 'global' }]
  scene.commands = [{ id: 'opening', type: 'say', speakerId: '', text: '开场的第一句还在逐字显示。' }, { id: 'second-line', type: 'say', speakerId: '', text: '轮到你选择了。' }, { id: 'pause', type: 'wait', duration: 30000 }, { id: 'branch', type: 'choice' }]
  scene.choices = [{ id: 'locked', text: '需要好感度', targetId: 'ending', condition: { variableId: 'trust', op: 'gte', value: 2 }, effects: [] }, { id: 'go', text: '一起出发', targetId: 'ending', condition: null, effects: [{ variableId: 'trust', op: 'add', value: 1 }] }]
  p.scenes.push({ ...structuredClone(scene), id: 'ending', title: '终章', ending: true, choices: [], commands: [{ id: 'unlock', type: 'set', variableId: 'unlocked', op: 'set', value: true }, { id: 'last-line', type: 'say', speakerId: '', text: '星光终于抵达。' }] })
  p.scenes.forEach(syncLegacy); f.records.set('first', p)
  return p
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

test('Agent 指令编辑、预览与手工编辑共用撤销重做，不污染游玩存档', async t => {
  const f = await setup(t)
  await f.call('novel_open', { id: 'first' })
  let read = await f.call('novel_read'), scene = read.project.scenes[0]
  const command = { id: 'agent-say', type: 'say', speakerId: '', text: '由 Agent 添加的演出' }
  await f.call('novel_edit', { projectId: 'first', localVersion: read.localVersion, operations: [{ type: 'upsert_command', sceneId: scene.id, value: command, index: 1 }] })
  read = await f.call('novel_read')
  assert.equal(read.project.scenes[0].commands[1].id, command.id)
  const before = read.localVersion, state = await f.call('novel_preview', { sceneId: scene.id, commandId: command.id })
  assert.equal(state.current.text, command.text)
  assert.equal((await f.call('novel_read')).localVersion, before)
  assert.equal(f.window.localStorage.getItem('novel-v2-first-slot-auto'), null)
  assert.equal(f.root.querySelector('.novel-live .novel-dialogue-text').textContent, command.text)
  await f.call('novel_history', { projectId: 'first', localVersion: before, direction: 'undo' })
  read = await f.call('novel_read'); assert.ok(!read.project.scenes[0].commands.some(c => c.id === command.id))
  await f.call('novel_history', { projectId: 'first', localVersion: read.localVersion, direction: 'redo' })
  assert.ok((await f.call('novel_read')).project.scenes[0].commands.some(c => c.id === command.id))
  await assert.rejects(f.call('novel_edit', { projectId: 'first', localVersion: before, operations: [{ type: 'remove_command', sceneId: scene.id, id: command.id }] }), /重新 novel_read/)
})

test('Agent 试玩与页面同步推进、条件选项、回退、解锁、重开和退出', async t => {
  const f = await setup(t), p = playFixture(f), play = args => f.call('novel_play', args)
  await assert.rejects(play({ action: 'start' }), /novel_open/)
  assert.equal((await f.call('novel_read')).mode, 'library')
  await f.call('novel_open', { id: 'first' })
  let state = await play({ action: 'start', projectId: 'first' })
  assert.equal(state.mode, 'play'); assert.equal(state.current.id, 'opening'); assert.equal(state.textComplete, false)
  assert.equal(state.sceneTitle, '序章'); assert.equal(state.canRollback, false)
  assert.equal((await f.call('novel_read')).mode, 'play')
  await assert.rejects(play({ action: 'rollback' }), /起点/)
  await assert.rejects(play({ action: 'choose', choiceId: 'go' }), /不在选择/)
  const version = (await f.call('novel_read')).localVersion
  await assert.rejects(f.call('novel_edit', { projectId: 'first', localVersion: version, operations: [{ type: 'set_project', patch: { title: '禁止' } }] }), /编辑器/)
  await assert.rejects(async () => f.call('novel_preview', { sceneId: p.startSceneId, commandId: 'opening' }), /编辑器/)
  await assert.rejects(f.call('novel_history', { projectId: 'first', localVersion: version, direction: 'undo' }), /重新 novel_read/)
  state = await play({ action: 'advance' })
  assert.equal(state.current.id, 'second-line', '一次调用补全文字并进入下一句')
  assert.ok(Object.keys(JSON.parse(f.window.localStorage.getItem('novel-v2-first-profile')).read).some(key => key.includes(':opening:')))
  f.root.querySelector('.novel-reading-tools button').click()
  assert.equal((await play({ action: 'status' })).current.id, 'opening', '工具能读取用户手动回退的位置')
  state = await play({ action: 'advance' }); state = await play({ action: 'advance' })
  assert.equal(state.current.type, 'wait')
  state = await play({ action: 'advance' })
  assert.equal(state.current.type, 'choice'); assert.deepEqual(state.choices, [{ id: 'go', text: '一起出发', targetId: 'ending' }])
  assert.deepEqual([...f.root.querySelectorAll('.novel-player-choice')].map(c => c.textContent), state.choices.map(c => c.text))
  await assert.rejects(play({ action: 'advance' }), /需要选择/)
  await assert.rejects(play({ action: 'choose' }), /choiceId/)
  for (const choiceId of ['locked', 'missing']) await assert.rejects(play({ action: 'choose', choiceId }), /不存在或条件未满足/)
  state = await play({ action: 'choose', choiceId: 'go' })
  assert.equal(state.sceneId, 'ending'); assert.equal(state.current.text, '星光终于抵达。'); assert.equal(state.values.trust, 1); assert.equal(state.values.unlocked, true)
  state = await play({ action: 'rollback' })
  assert.equal(state.current.type, 'choice'); assert.equal(state.values.trust, 0); assert.equal(state.values.unlocked, true)
  await play({ action: 'choose', choiceId: 'go' }); state = await play({ action: 'advance' })
  assert.equal(state.ended, true); assert.deepEqual(state.unlockedEndings, ['ending'])
  assert.equal(f.root.querySelector('.novel-ending-subtitle').textContent, '终章')
  await assert.rejects(play({ action: 'advance' }), /故事已结束/)
  state = await play({ action: 'restart' })
  assert.equal(state.current.id, 'opening'); assert.equal(state.historyLength, 0); assert.equal(state.values.trust, 0); assert.equal(state.values.unlocked, true); assert.deepEqual(state.unlockedEndings, ['ending'])
  assert.equal(JSON.parse(f.window.localStorage.getItem('novel-v2-first-slot-auto')).state.current.id, state.current.id)
  assert.deepEqual(await play({ action: 'exit' }), { mode: 'edit', projectId: 'first', localVersion: version })
  assert.equal(f.root.querySelector('.novel-player'), null); assert.ok(f.root.querySelector('.novel-app-header'))
  await assert.rejects(play({ action: 'status' }), /当前未在试玩/)
})

test('Agent 可指定场景、指令和测试变量开始试玩，并拒绝错误参数和作品', async t => {
  const f = await setup(t), p = playFixture(f), play = args => f.call('novel_play', args)
  await f.call('novel_open', { id: 'first' })
  for (const args of [{ sceneId: 'missing' }, { commandId: 'missing' }, { values: [] }, { values: { missing: 1 } }, { values: { trust: true } }, { values: { trust: Infinity } }, { values: { trust: 10000 } }]) {
    await assert.rejects(play({ action: 'start', ...args }), /不存在|测试变量/)
    assert.equal((await f.call('novel_read')).mode, 'edit')
    assert.equal(f.window.localStorage.getItem('novel-v2-first-slot-auto'), null)
  }
  await assert.rejects(play({ action: 'unknown' }), /未知试玩动作/)
  await assert.rejects(play({ action: 'start', projectId: 'second' }), /作品已切换/)
  let state = await play({ action: 'start', sceneId: p.startSceneId, commandId: 'branch', values: { trust: 3 } })
  assert.equal(state.current.id, 'branch'); assert.deepEqual(state.choices.map(c => c.id), ['locked', 'go']); assert.equal(state.canRollback, false)
  state.values.trust = -1
  assert.equal((await play({ action: 'status' })).values.trust, 3, '返回的状态不能改写播放器')
  state = await play({ action: 'start', values: { trust: 4 } })
  assert.equal(state.current.id, 'opening'); assert.equal(state.values.trust, 4, '从场景起点也能覆盖测试变量')
  state = await play({ action: 'start' })
  assert.equal(state.current.id, 'opening'); assert.equal(state.values.trust, 0, 'start 从起点启动，不自动续读或沿用测试变量')
  await assert.rejects(play({ action: 'advance', projectId: 'second' }), /作品已切换/)
  await play({ action: 'exit' }); await f.call('novel_open', { id: 'second' })
  await assert.rejects(play({ action: 'start', projectId: 'first' }), /作品已切换/)
})

test('Agent 启动试玩等待草稿保存，接管手动面板和自动播放', async t => {
  const f = await setup(t); playFixture(f)
  const play = args => f.call('novel_play', args)
  await f.call('novel_open', { id: 'first' })
  const title = f.root.querySelector('.novel-story-main > .novel-field input')
  title.value = '刚修改的场景标题'; title.dispatchEvent(new f.window.Event('input'))
  Object.assign(f.gate, { match: (path, method) => path.endsWith('/first') && method === 'PUT', wait: deferred(), entered: deferred() })
  const starting = play({ action: 'start' }); await f.gate.entered.promise
  assert.equal(f.root.inert, true)
  await assert.rejects(play({ action: 'start' }), /稍后再试/)
  await assert.rejects(play({ action: 'exit' }), /稍后再试/)
  f.gate.wait.resolve(); let state = await starting
  assert.equal(state.sceneTitle, title.value); assert.equal(state.revision, 1); assert.equal(f.records.get('first').scenes[0].title, title.value); assert.equal(f.root.inert, false)
  const click = text => { const button = [...f.root.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); button.click() }
  click('自动'); click('隐藏'); click('设置')
  state = await play({ action: 'status' }); assert.equal(state.auto, true); assert.equal(state.dialogueHidden, true); assert.equal(state.panelOpen, true)
  state = await play({ action: 'advance' })
  assert.equal(state.current.id, 'second-line'); assert.equal(state.auto, false); assert.equal(state.dialogueHidden, false); assert.equal(state.panelOpen, false)
  assert.equal(f.root.querySelector('.novel-player-overlay').hidden, true)
})

test('Agent 试玩返回剧情执行错误，失败后仍能退出并编辑', async t => {
  const f = await setup(t), p = playFixture(f), play = args => f.call('novel_play', args), scene = p.scenes[0]
  scene.choices.push({ id: 'broken', text: '断开的选项', targetId: 'missing', condition: null, effects: [] })
  scene.commands.push({ id: 'loop', type: 'jump', targetId: 'loop-scene' })
  p.scenes.push({ ...structuredClone(scene), id: 'loop-scene', title: '循环', choices: [], commands: [{ id: 'loop-again', type: 'jump', targetId: 'loop-scene' }] })
  p.scenes.forEach(syncLegacy)
  await f.call('novel_open', { id: 'first' })
  await play({ action: 'start', commandId: 'branch' })
  await assert.rejects(play({ action: 'choose', choiceId: 'broken' }), /跳转的场景不存在/)
  let state = await play({ action: 'status' }); assert.equal(state.current.id, 'branch'); assert.equal(state.historyLength, 0); assert.equal(state.values.trust, 0)
  await play({ action: 'exit' })
  await assert.rejects(play({ action: 'start', sceneId: 'loop-scene' }), /跳转循环/)
  assert.equal((await f.call('novel_read')).mode, 'edit'); assert.ok(f.root.querySelector('.novel-app-header'))
})
