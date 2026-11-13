export const RULE_EVENTS = ['node.enter', 'choice.select', 'chat.message', 'gift.give']
export const MAX_RULE_DEPTH = 12
export const MAX_RULE_RUNS = 64
const LOG_LIMIT = 100

function variable(engine, id) {
  const definition = engine.project.variables.find(item => item.id === id)
  if (!definition) throw Error(`属性不存在：${id}`)
  return definition
}

export function clampAttribute(value, definition) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('属性值必须是有限数字')
  return Math.max(definition.min, Math.min(definition.max, value))
}

export function testVariable(engine, condition) {
  if (!condition) return true
  if (condition.type !== 'variable') throw Error(`未知条件：${condition.type}`)
  const definition = variable(engine, condition.variable)
  const value = engine.mode === 'play' ? engine.runtime.variables[definition.id] : definition.initial
  if (typeof value !== 'number' || !Number.isFinite(value) || typeof condition.value !== 'number' || !Number.isFinite(condition.value)) throw Error('条件必须比较有限数字')
  switch (condition.op) {
    case 'gte': return value >= condition.value
    case 'lte': return value <= condition.value
    case 'eq': return value === condition.value
    case 'gt': return value > condition.value
    case 'lt': return value < condition.value
    default: throw Error(`未知比较方式：${condition.op}`)
  }
}

export function createActions(engine) {
  const numeric = (type, label, add) => ({
    type, label,
    fields: [{ key: 'variable', label: '属性', kind: 'variable' }, { key: 'value', label: add ? '增减值' : '设为', kind: 'number', default: add ? 1 : 0 }],
    execute(action) {
      if (engine.mode !== 'play') return
      const definition = variable(engine, action.variable)
      if (typeof action.value !== 'number' || !Number.isFinite(action.value)) throw Error('属性动作需要有限数字')
      const current = engine.runtime.variables[definition.id] ?? definition.initial
      const next = clampAttribute(add ? current + action.value : action.value, definition)
      engine.transact(runtime => { runtime.variables[definition.id] = next })
    },
  })
  return [numeric('add-variable', '增减属性', true), numeric('set-variable', '设置属性', false), {
    type: 'expression', label: '切换表情',
    fields: [{ key: 'value', label: '表情', kind: 'expression', default: 'neutral' }],
    execute(action) {
      if (engine.mode !== 'play') return
      if (typeof action.value !== 'string' || !action.value.trim() || action.value.length > 80) throw Error('请选择有效表情')
      engine.transact(runtime => { runtime.stage.expression = action.value })
    },
  }, {
    type: 'goto', label: '跳转节点',
    fields: [{ key: 'target', label: '目标节点', kind: 'node' }],
    async execute(action) {
      if (engine.mode !== 'play') return
      if (!engine.project.nodes.some(node => node.id === action.target)) throw Error(`跳转节点不存在：${action.target}`)
      await engine.go(action.target)
    },
  }]
}

export function createRuleRunner(engine) {
  const frames = new WeakMap()
  let disposed = false
  const log = (runtime, entry) => {
    if (engine.mode !== 'play' || engine.runtime !== runtime) return
    engine.transact(state => {
      state.log.push({ ...entry, time: new Date().toISOString() })
      if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT)
    })
  }
  const handle = async (event, payload = {}) => {
    if (disposed || engine.mode !== 'play') return
    const runtime = engine.runtime, nodeId = payload?.nodeId || runtime.nodeId
    let frame = frames.get(runtime)
    if (!frame || !frame.depth) { frame = { depth: 0, runs: 0 }; frames.set(runtime, frame) }
    if (frame.depth >= MAX_RULE_DEPTH) {
      const error = Error('规则跳转过于频繁：已停止递归执行')
      log(runtime, { event, status: 'error', message: error.message })
      throw error
    }
    frame.depth++
    try {
      for (const rule of [...engine.project.rules]) {
        if (disposed || engine.mode !== 'play' || engine.runtime !== runtime) return
        if (rule.event !== event || (rule.nodeId && rule.nodeId !== nodeId) || (rule.once && runtime.firedRules.includes(rule.id))) continue
        let reserved = false
        try {
          if (!engine.test(rule.condition)) continue
          if (++frame.runs > MAX_RULE_RUNS) throw Error('规则执行次数超过上限，已停止本次事件')
          // Reserve once before actions: a goto can emit another matching event.
          if (rule.once) { engine.transact(state => { state.firedRules.push(rule.id) }); reserved = true }
          log(runtime, { event, nodeId, ruleId: rule.id, name: rule.name, status: 'running', message: `执行规则：${rule.name || rule.id}` })
          await engine.runActions(rule.actions || [], { ...(payload || {}), event, nodeId, ruleId: rule.id })
          if (disposed) return
          log(runtime, { event, nodeId, ruleId: rule.id, status: 'done', message: `规则完成：${rule.name || rule.id}` })
        } catch (error) {
          if (reserved && engine.mode === 'play' && engine.runtime === runtime) engine.transact(state => { state.firedRules = state.firedRules.filter(id => id !== rule.id) })
          log(runtime, { event, nodeId, ruleId: rule.id, status: 'error', message: error.message })
          throw error
        }
      }
    } finally { frame.depth-- }
  }
  return { handle, dispose() { disposed = true } }
}

export function registerRules(owner, engine) {
  engine.registerCondition(owner, { type: 'variable', label: '属性条件', test: condition => testVariable(engine, condition) })
  for (const action of createActions(engine)) engine.registerAction(owner, action)
  const runner = createRuleRunner(engine)
  engine.onEvent(owner, runner.handle)
  owner.effect(() => () => runner.dispose())
  return runner
}
