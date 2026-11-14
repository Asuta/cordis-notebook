import test from 'node:test'
import assert from 'node:assert/strict'
import { clampAttribute, createActions, registerRules, testVariable, MAX_RULE_DEPTH, MAX_RULE_RUNS } from '../engine.js'
import { actionAssetOptions, actionFieldDefault } from '../editor.js'

const condition = (patch = {}) => ({ type: 'variable', variable: 'trust', op: 'gte', value: 3, ...patch })
const add = value => ({ type: 'add-variable', variable: 'trust', value })
const rule = (patch = {}) => ({ id: 'rule-one', name: '相遇', event: 'node.enter', once: false, actions: [add(1)], ...patch })
const runtime = () => ({ nodeId: 'intro', variables: { trust: 2 }, stage: { expression: 'neutral' }, firedRules: [], log: [] })
function harness(rules = []) {
  const cleanups = [], actions = new Map(), conditions = new Map(), events = new Set()
  const owner = { effect(fn) { const dispose = fn(); if (dispose) cleanups.push(dispose) } }
  const register = (map, descriptor) => { map.set(descriptor.type, descriptor); owner.effect(() => () => map.delete(descriptor.type)) }
  const engine = {
    mode: 'play', runtime: runtime(), calls: [],
    project: { variables: [{ id: 'trust', name: '好感度', initial: 2, min: -2, max: 10 }], nodes: [{ id: 'intro' }, { id: 'after' }], rules },
    transact(change) { change(this.runtime) },
    registerAction(_owner, descriptor) { register(actions, descriptor) },
    registerCondition(_owner, descriptor) { register(conditions, descriptor) },
    onEvent(_owner, fn) { events.add(fn); owner.effect(() => () => events.delete(fn)) },
    test(value) {
      if (!value) return true
      const handler = conditions.get(value.type)
      if (!handler) throw Error('条件未注册')
      return handler.test(value)
    },
    async runActions(rows, payload) {
      for (const item of rows) {
        const handler = actions.get(item.type)
        if (!handler) throw Error('动作未注册：' + item.type)
        await handler.execute(item, payload)
      }
    },
    async emit(event, payload) { for (const listener of [...events]) await listener(event, payload) },
    async go(target) { this.calls.push(target); this.runtime.nodeId = target; await this.emit('node.enter', { nodeId: target }) },
  }
  const runner = registerRules(owner, engine)
  return { engine, owner, actions, conditions, events, runner, dispose() { for (const fn of cleanups.reverse()) fn() } }
}

test('属性夹取支持负值和小数，拒绝非有限数值', () => {
  const definition = { min: -2, max: 10 }
  assert.equal(clampAttribute(-9, definition), -2)
  assert.equal(clampAttribute(100, definition), 10)
  assert.equal(clampAttribute(1.25, definition), 1.25)
  for (const value of [NaN, Infinity, -Infinity, '3', null]) assert.throws(() => clampAttribute(value, definition), /有限数字/)
})

test('所有数字比较运算符都覆盖边界和两侧', () => {
  const { engine } = harness()
  engine.runtime.variables.trust = 3
  const expected = { gte: [true, true, false], lte: [false, true, true], eq: [false, true, false], gt: [true, false, false], lt: [false, false, true] }
  for (const [op, results] of Object.entries(expected)) {
    for (const [index, value] of [2, 3, 4].entries()) assert.equal(testVariable(engine, condition({ op, value })), results[index], op + ' against ' + value)
  }
})

test('编辑预览用初始属性，试玩用运行时属性，空条件恒真', () => {
  const { engine } = harness()
  engine.runtime.variables.trust = 8
  assert.equal(engine.test(condition()), true)
  engine.mode = 'edit'; engine.runtime = null
  assert.equal(engine.test(condition()), false)
  assert.equal(testVariable(engine, undefined), true)
})

test('错误条件类型、属性、比较方式和数据都会明确失败', () => {
  const { engine } = harness()
  assert.throws(() => testVariable(engine, condition({ type: 'script' })), /未知条件/)
  assert.throws(() => engine.test(condition({ variable: 'missing' })), /属性不存在/)
  assert.throws(() => engine.test(condition({ op: 'neq' })), /未知比较方式/)
  assert.throws(() => engine.test(condition({ value: NaN })), /有限数字/)
  engine.runtime.variables.trust = '2'
  assert.throws(() => engine.test(condition()), /有限数字/)
})

test('注册四种真实动作与编辑字段元数据，未知动作不会静默跳过', async () => {
  const { engine, actions, conditions } = harness()
  assert.deepEqual([...actions.keys()], ['add-variable', 'set-variable', 'expression', 'goto'])
  assert.deepEqual([...conditions.keys()], ['variable'])
  assert.deepEqual(actions.get('add-variable').fields.map(item => item.kind), ['variable', 'number'])
  assert.equal(actions.get('expression').fields[0].kind, 'expression')
  await assert.rejects(engine.runActions([{ type: 'unknown' }]), /动作未注册/)
})

test('增减和设置属性均限制在定义范围内，并保留小数', async () => {
  const { engine } = harness()
  await engine.runActions([add(100)])
  assert.equal(engine.runtime.variables.trust, 10)
  await engine.runActions([add(-100)])
  assert.equal(engine.runtime.variables.trust, -2)
  await engine.runActions([{ type: 'set-variable', variable: 'trust', value: 1.25 }, add(0.5)])
  assert.equal(engine.runtime.variables.trust, 1.75)
  await engine.runActions([{ type: 'set-variable', variable: 'trust', value: -50 }])
  assert.equal(engine.runtime.variables.trust, -2)
})

test('属性和表情动作验证参数，表情只修改运行时舞台', async () => {
  const { engine } = harness()
  await assert.rejects(engine.runActions([add(Infinity)]), /有限数字/)
  await assert.rejects(engine.runActions([{ ...add(1), variable: 'missing' }]), /属性不存在/)
  await assert.rejects(engine.runActions([{ type: 'expression', value: '' }]), /有效表情/)
  await engine.runActions([{ type: 'expression', value: 'happy' }])
  assert.equal(engine.runtime.stage.expression, 'happy')
  assert.equal(engine.project.variables[0].initial, 2)
})

test('goto 校验目标并等待引擎进入节点后才运行下一动作', async () => {
  const { engine } = harness()
  let release
  engine.go = async target => { engine.calls.push(target); await new Promise(resolve => { release = resolve }); engine.runtime.nodeId = target }
  const pending = engine.runActions([{ type: 'goto', target: 'after' }, add(1)])
  await Promise.resolve()
  assert.equal(engine.runtime.variables.trust, 2)
  release(); await pending
  assert.equal(engine.runtime.nodeId, 'after')
  assert.equal(engine.runtime.variables.trust, 3)
  await assert.rejects(engine.runActions([{ type: 'goto', target: 'missing' }]), /节点不存在/)
})

test('编辑模式下事件和全部标准动作都没有剧情副作用', async () => {
  const { engine } = harness([rule()]), before = structuredClone(engine.runtime)
  engine.mode = 'edit'
  await engine.emit('node.enter', { nodeId: 'intro' })
  for (const action of createActions(engine)) {
    const value = { type: action.type, variable: 'trust', value: action.type === 'expression' ? 'happy' : 4, target: 'after' }
    await action.execute(value)
  }
  assert.deepEqual(engine.runtime, before)
  assert.deepEqual(engine.calls, [])
})

test('规则按事件、源节点和条件过滤；后续规则读取前面动作的新属性', async () => {
  const { engine } = harness([
    rule({ id: 'wrong-event', event: 'chat.message', actions: [add(9)] }),
    rule({ id: 'wrong-node', nodeId: 'after', actions: [add(9)] }),
    rule({ id: 'wrong-condition', condition: condition({ value: 9 }), actions: [add(9)] }),
    rule({ id: 'first', nodeId: 'intro' }),
    rule({ id: 'second', condition: condition(), actions: [{ type: 'expression', value: 'happy' }] }),
  ])
  engine.runtime.nodeId = 'after'
  await engine.emit('node.enter', { nodeId: 'intro' })
  assert.equal(engine.runtime.variables.trust, 3)
  assert.equal(engine.runtime.stage.expression, 'happy')
  assert.deepEqual(engine.runtime.log.filter(item => item.status === 'done').map(item => item.ruleId), ['first', 'second'])
})

test('once 保存在运行时，可跨存档恢复，并在新试玩中重新触发', async () => {
  const { engine } = harness([rule({ once: true })])
  await engine.emit('node.enter')
  await engine.emit('node.enter')
  assert.equal(engine.runtime.variables.trust, 3)
  assert.deepEqual(engine.runtime.firedRules, ['rule-one'])
  engine.runtime = structuredClone(engine.runtime)
  await engine.emit('node.enter')
  assert.equal(engine.runtime.variables.trust, 3)
  engine.runtime = runtime()
  await engine.emit('node.enter')
  assert.equal(engine.runtime.variables.trust, 3)
})

test('once 在动作前预留，goto 递归回同一节点也只执行一次', async () => {
  const { engine } = harness([rule({ once: true, actions: [add(1), { type: 'goto', target: 'intro' }] })])
  await engine.emit('node.enter', { nodeId: 'intro' })
  assert.equal(engine.runtime.variables.trust, 3)
  assert.deepEqual(engine.calls, ['intro'])
  assert.deepEqual(engine.runtime.firedRules, ['rule-one'])
})

test('循环规则在递归上限内停止并记录错误，下一事件不受旧深度影响', async () => {
  const { engine } = harness([rule({ actions: [{ type: 'goto', target: 'intro' }] })])
  await assert.rejects(engine.emit('node.enter'), /递归执行/)
  assert.equal(engine.calls.length, MAX_RULE_DEPTH)
  assert.ok(engine.runtime.log.some(item => item.status === 'error' && /递归/.test(item.message)))
  engine.project.rules = [rule()]
  await engine.emit('node.enter')
  assert.equal(engine.runtime.variables.trust, 3)
})

test('单事件规则总次数有界，日志不会无限增长', async () => {
  const { engine, actions } = harness(Array.from({ length: MAX_RULE_RUNS + 1 }, (_, index) => rule({ id: 'rule-' + index, actions: [{ type: 'count' }] })))
  let count = 0
  actions.set('count', { execute() { count++ } })
  await assert.rejects(engine.emit('node.enter'), /次数超过上限/)
  assert.equal(count, MAX_RULE_RUNS)
  assert.equal(engine.runtime.log.length, 100)
  await assert.rejects(engine.emit('node.enter'), /次数超过上限/)
  assert.equal(count, MAX_RULE_RUNS * 2)
  assert.equal(engine.runtime.log.length, 100)
})

test('条件错误写入规则日志，动作失败释放 once 预留并向调用方报告', async () => {
  const { engine } = harness([rule({ condition: condition({ variable: 'missing' }) })])
  await assert.rejects(engine.emit('node.enter'), /属性不存在/)
  assert.equal(engine.runtime.log.at(-1).status, 'error')
  engine.project.rules = [rule({ once: true, actions: [{ type: 'missing' }] })]
  await assert.rejects(engine.emit('node.enter'), /动作未注册/)
  assert.deepEqual(engine.runtime.firedRules, [])
  engine.project.rules[0].actions = [add(1)]
  await engine.emit('node.enter')
  assert.deepEqual(engine.runtime.firedRules, ['rule-one'])
})

test('异步规则返回前退出或替换运行时，后续规则不会污染新的试玩', async () => {
  for (const change of ['stop', 'replace']) {
    const { engine, actions } = harness([rule({ id: 'wait', actions: [{ type: 'wait' }] }), rule({ id: 'after' })])
    let release
    actions.set('wait', { execute: () => new Promise(resolve => { release = resolve }) })
    const old = engine.runtime, pending = engine.emit('node.enter')
    await Promise.resolve()
    if (change === 'stop') { engine.mode = 'edit'; engine.runtime = null } else engine.runtime = runtime()
    release(); await pending
    assert.equal(old.variables.trust, 2)
    assert.equal(old.log.filter(item => item.status === 'done').length, 0)
    if (change === 'replace') assert.equal(engine.runtime.variables.trust, 2)
  }
})

test('释放插件移除动作、条件和事件监听，保留的 runner 引用也不能再执行', async () => {
  const { engine, runner, actions, conditions, events, dispose } = harness([rule()])
  dispose()
  assert.equal(actions.size, 0); assert.equal(conditions.size, 0); assert.equal(events.size, 0)
  await runner.handle('node.enter')
  assert.equal(engine.runtime.variables.trust, 2)
})

test('规则动作的素材列表支持类型过滤和默认素材空选项', () => {
  const project = { assets: [{ id: 'portrait', name: '立绘', kind: 'image' }, { id: 'bgm', name: '背景音乐', kind: 'audio' }] }
  assert.deepEqual(actionAssetOptions({ kind: 'asset', assetKind: 'audio' }, project), [['', '使用默认素材'], ['bgm', '背景音乐']])
  assert.deepEqual(actionAssetOptions({ kind: 'asset', assetKind: 'image' }, project), [['', '使用默认素材'], ['portrait', '立绘']])
  assert.equal(actionAssetOptions({ kind: 'asset' }, project).length, 3)
})

test('规则新增声音和 Live2D 动作保留布尔值及字符串、数字配置', () => {
  const project = { variables: [], nodes: [] }
  const fields = [{ key: 'asset', kind: 'asset', default: 'bgm' }, { key: 'loop', kind: 'boolean', default: true }, { key: 'enabled', kind: 'boolean', default: false }, { key: 'expression', kind: 'string', default: 'happy' }, { key: 'group', kind: 'string', default: 'TapBody' }, { key: 'index', kind: 'number', default: 0 }]
  assert.deepEqual(Object.fromEntries(fields.map(spec => [spec.key, actionFieldDefault(spec, project)])), { asset: 'bgm', loop: true, enabled: false, expression: 'happy', group: 'TapBody', index: 0 })
  assert.equal(actionFieldDefault({ kind: 'boolean' }, project), false)
  assert.equal(actionFieldDefault({ kind: 'string' }, project), '')
})
