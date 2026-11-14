import test from 'node:test'
import assert from 'node:assert/strict'
import { createDialoguePlayer } from '../player.js'

const line = text => ({ speaker: 'lin', text })
const scene = (id = 'intro', patch = {}) => ({ id, type: 'story', title: id, lines: [line('第一句'), line('最后一句')], choices: [{ id: 'stay', text: '留下来', target: 'after', actions: [{ type: 'add-variable', variable: 'trust', value: 1 }] }], ...patch })
const runtime = () => ({ nodeId: 'intro', lineIndex: 0, text: line('运行时第一句'), variables: { trust: 2 }, stage: {}, busy: false, ended: false })
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }
function harness(patch = {}) {
  const engine = {
    mode: 'play', held: false, selected: 'intro', runtime: runtime(), trace: [], tests: 0,
    project: { nodes: [scene(), scene('after', { choices: [] }), scene('chat', { type: 'chat', choices: [] })], characters: [{ id: 'lin', name: '林栀' }], settings: { dialogueStyle: 'novel' } },
    scene() { return this.project.nodes.find(node => node.id === (this.mode === 'play' ? this.runtime.nodeId : this.selected)) },
    test(condition) { this.tests++; return !condition || this.runtime.variables[condition.variable] >= condition.value },
    transact(change) { change(this.runtime) },
    async runActions(rows, payload) { this.trace.push('actions:start'); await this.onActions?.(rows, payload); this.trace.push('actions:end') },
    async emit(event, payload) { this.trace.push(event + ':start'); await this.onEvent?.(event, payload); this.trace.push(event + ':end') },
    async go(id) { this.trace.push('go:' + id); this.runtime.nodeId = id; this.runtime.busy = false; await this.onGo?.(id) },
    async advance() {
      if (this.runtime.busy) return
      this.trace.push('advance'); await this.onAdvance?.()
      this.runtime.lineIndex++; this.runtime.text = this.scene().lines[this.runtime.lineIndex]
    },
    ...patch,
  }
  let renders = 0
  const player = createDialoguePlayer(engine, () => { renders++ })
  return { engine, player, renders: () => renders }
}

test('编辑预览读取选中的 scene 对白，不能运行剧情动作', async () => {
  const { engine, player } = harness({ mode: 'edit', selected: 'after' })
  assert.equal(player.view().text.text, '第一句')
  assert.equal(player.view().node.id, 'after')
  assert.equal(player.view().playing, false)
  assert.equal(await player.advance(), false)
  assert.equal(await player.choose('stay'), false)
  assert.deepEqual(engine.trace, [])
})

test('试玩显示 runtime.text，逐句读完后才显示选项', async () => {
  const { engine, player } = harness()
  assert.equal(player.view().text.text, '运行时第一句')
  assert.deepEqual(player.view().choices, [])
  assert.equal(engine.tests, 0)
  assert.equal(await player.choose('stay'), false)
  assert.deepEqual(engine.trace, [])
  await player.advance()
  assert.equal(engine.runtime.lineIndex, 1)
  assert.equal(player.view().text.text, '最后一句')
  assert.equal(player.view().atEnd, true)
  assert.equal(player.view().choices[0].id, 'stay')
})

test('空对白节点在行号 0 即可选择，一句节点也不必额外继续', () => {
  for (const lines of [[], [line('请选择')]]) {
    const { engine, player } = harness()
    engine.project.nodes[0].lines = lines
    assert.equal(player.view().atEnd, true)
    assert.equal(player.view().choices.length, 1)
  }
})

test('chat 节点不给对白插件渲染，也不能由其推进或选择', async () => {
  const { engine, player } = harness()
  engine.runtime.nodeId = 'chat'
  assert.equal(player.view(), null)
  assert.equal(await player.advance(), false)
  assert.equal(await player.choose('stay'), false)
  engine.mode = 'edit'; engine.selected = 'chat'
  assert.equal(player.view(), null)
  assert.deepEqual(engine.trace, [])
})

test('选项通过 engine.test 验证条件，选择前重新检查且不跳向失效目标', async () => {
  const { engine, player } = harness()
  engine.runtime.lineIndex = 1
  const choice = engine.project.nodes[0].choices[0]
  choice.condition = { type: 'variable', variable: 'trust', op: 'gte', value: 2 }
  assert.equal(player.view().choices[0].available, true)
  engine.runtime.variables.trust = 1
  assert.equal(await player.choose('stay'), false)
  assert.equal(player.view().choices[0].reason, '条件未满足')
  engine.runtime.variables.trust = 3; choice.target = 'missing'
  assert.equal(player.view().choices[0].available, false)
  assert.equal(player.view().choices[0].reason, '尚未连接目标节点')
  assert.equal(await player.choose('stay'), false)
  assert.deepEqual(engine.trace, [])
})

test('条件错误只将预览选项标为不可用，不让渲染观察器抛错', () => {
  const { engine, player } = harness()
  engine.runtime.lineIndex = 1
  engine.test = () => { throw Error('属性不存在') }
  assert.equal(player.view().choices[0].available, false)
  assert.equal(player.view().choices[0].reason, '属性不存在')
})

test('忙碌、切换保护、结局或失效选项都不能触发动作', async () => {
  for (const state of ['busy', 'held', 'ended', 'missing']) {
    const { engine, player } = harness()
    engine.runtime.lineIndex = 1
    if (state === 'held') engine.held = true
    else if (state !== 'missing') engine.runtime[state] = true
    assert.equal(await player.choose(state === 'missing' ? 'unknown' : 'stay'), false)
    assert.equal(await player.advance(), false)
    assert.deepEqual(engine.trace, [])
  }
})

test('动作完成后才发送 choice.select，规则结束后才进入目标节点', async () => {
  const { engine, player } = harness(), actionWait = deferred(), eventWait = deferred()
  engine.runtime.lineIndex = 1
  engine.onActions = async (actions, payload) => {
    assert.equal(payload.nodeId, 'intro'); assert.equal(payload.choiceId, 'stay')
    await actionWait.promise
    engine.runtime.variables.trust += actions[0].value
  }
  engine.onEvent = async (event, payload) => {
    assert.equal(event, 'choice.select'); assert.equal(payload.choice.text, '留下来')
    assert.equal(engine.runtime.variables.trust, 3)
    await eventWait.promise
  }
  const pending = player.choose('stay')
  assert.deepEqual(engine.trace, ['actions:start'])
  assert.equal(player.view().busy, true)
  assert.equal(await player.choose('stay'), false)
  actionWait.resolve()
  // Let the action continuation and the awaited runActions continuation settle.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(engine.trace, ['actions:start', 'actions:end', 'choice.select:start'])
  assert.equal(engine.runtime.nodeId, 'intro')
  eventWait.resolve(); assert.equal(await pending, true)
  assert.deepEqual(engine.trace, ['actions:start', 'actions:end', 'choice.select:start', 'choice.select:end', 'go:after'])
  assert.equal(engine.runtime.busy, false)
})

test('继续按钮的本地锁阻止重复推进，又不抢占 engine.advance 的 busy 检查', async () => {
  const { engine, player, renders } = harness(), wait = deferred()
  engine.onAdvance = () => wait.promise
  const pending = player.advance()
  assert.equal(player.view().busy, true)
  assert.equal(engine.runtime.busy, false)
  assert.equal(await player.advance(), false)
  assert.deepEqual(engine.trace, ['advance'])
  wait.resolve(); assert.equal(await pending, true)
  assert.equal(engine.runtime.lineIndex, 1)
  assert.equal(player.view().busy, false)
  assert.ok(renders() >= 2)
})

test('最后一句有分支时不允许继续绕过，即使所有分支条件都不满足', async () => {
  const { engine, player } = harness()
  engine.runtime.lineIndex = 1; engine.test = () => false
  assert.equal(await player.advance(), false)
  assert.equal(await player.choose('stay'), false)
  assert.deepEqual(engine.trace, [])
})

test('等待动作时退出、重开或释放插件，都不会发送迟到事件或跳转', async () => {
  for (const change of ['stop', 'restart', 'dispose']) {
    const { engine, player } = harness(), wait = deferred()
    engine.runtime.lineIndex = 1; engine.onActions = () => wait.promise
    const old = engine.runtime, pending = player.choose('stay')
    if (change === 'stop') { engine.mode = 'edit'; engine.runtime = null }
    else if (change === 'restart') engine.runtime = runtime()
    else { player.dispose(); assert.equal(old.busy, false) }
    wait.resolve(); assert.equal(await pending, false)
    assert.deepEqual(engine.trace, ['actions:start', 'actions:end'])
    if (change === 'restart') assert.equal(engine.runtime.busy, false)
  }
})

test('等待选择规则时重开试玩，旧选择不能跳转或修改新 busy 状态', async () => {
  const { engine, player } = harness(), wait = deferred(), entered = deferred()
  engine.runtime.lineIndex = 1
  engine.onEvent = () => { entered.resolve(); return wait.promise }
  const pending = player.choose('stay')
  await entered.promise
  engine.runtime = runtime(); engine.runtime.busy = true
  wait.resolve(); assert.equal(await pending, false)
  assert.equal(engine.runtime.nodeId, 'intro')
  assert.equal(engine.runtime.busy, true)
  assert.equal(engine.trace.some(item => item.startsWith('go:')), false)
})

test('选择进入聊天后，目标聊天处理器持有的 busy 不会被对白插件清除', async () => {
  const { engine, player } = harness()
  engine.runtime.lineIndex = 1; engine.project.nodes[0].choices[0].target = 'chat'
  engine.onGo = () => { engine.runtime.busy = true }
  assert.equal(await player.choose('stay'), true)
  assert.equal(engine.runtime.nodeId, 'chat')
  assert.equal(engine.runtime.busy, true)
  assert.equal(player.view(), null)
})

test('动作或事件失败会解锁原节点，保留错误给调用方且不继续跳转', async () => {
  for (const phase of ['onActions', 'onEvent']) {
    const { engine, player } = harness()
    engine.runtime.lineIndex = 1
    engine[phase] = () => { throw Error('执行失败') }
    await assert.rejects(player.choose('stay'), /执行失败/)
    assert.equal(engine.runtime.nodeId, 'intro')
    assert.equal(engine.runtime.busy, false)
    assert.equal(player.view().busy, false)
    assert.equal(engine.trace.some(item => item.startsWith('go:')), false)
  }
})

test('已结束的结局仍显示运行时最后文本与外观设置，但没有交互', async () => {
  const { engine, player } = harness()
  engine.project.nodes[0].type = 'ending'; engine.runtime.ended = true; engine.runtime.lineIndex = 1
  engine.runtime.text = line('明年再见'); engine.project.settings.dialogueStyle = 'chat'
  const state = player.view()
  assert.equal(state.text.text, '明年再见'); assert.equal(state.style, 'chat'); assert.equal(state.ended, true)
  assert.deepEqual(state.choices, [])
  assert.equal(await player.advance(), false)
  assert.equal(await player.choose('stay'), false)
})
