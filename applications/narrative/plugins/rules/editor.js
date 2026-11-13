import { RULE_EVENTS } from './engine.js'

const el = (tag, className = '', text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const eventNames = { 'node.enter': '进入节点', 'choice.select': '选择分支', 'chat.message': '聊天消息', 'gift.give': '赠送礼物' }
const ops = [['gte', '大于等于 ≥'], ['lte', '小于等于 ≤'], ['eq', '等于 ='], ['gt', '大于 >'], ['lt', '小于 <']]

export const actionAssetOptions = (spec, project) => [['', '使用默认素材'], ...project.assets
  .filter(asset => !spec.assetKind || asset.kind === spec.assetKind)
  .map(asset => [asset.id, asset.name || asset.id])]

export function actionFieldDefault(spec, project) {
  if (spec.kind === 'variable') return project.variables[0]?.id
  if (spec.kind === 'node') return project.nodes[0]?.id
  if (spec.kind === 'boolean') return spec.default ?? false
  return spec.default ?? ''
}

function referenced(project, id) {
  const uses = item => item.condition?.variable === id || item.actions?.some(action => action.variable === id)
  return project.rules.some(uses) || project.nodes.some(node => node.choices.some(uses))
}

export function mountRulesEditor(engine, container, observe) {
  const root = el('fieldset', 'ne-rules-editor ne-stack')
  container.append(root)
  let controller, sync = () => {}, disposed = false
  const fail = error => engine.error(error.message || String(error))
  const run = action => { try { Promise.resolve(action()).catch(fail) } catch (error) { fail(error) } }
  const save = (change, render = false) => {
    if (engine.mode !== 'edit' || engine.held) return
    return engine.update(change, { render })
  }
  function render() {
    controller?.abort(); controller = new AbortController()
    const signal = controller.signal, project = engine.project, syncers = []
    const listen = (node, event, fn) => node.addEventListener(event, () => run(fn), { signal })
    const button = (text, fn, className = 'ne-button') => {
      const node = el('button', className, text); node.type = 'button'; listen(node, 'click', fn); return node
    }
    const field = (label, control) => { const wrap = el('label', 'ne-field'); wrap.append(el('span', '', label), control); return wrap }
    const input = (value, change, number = false) => {
      const node = el('input', 'ne-input'); node.value = value ?? ''
      if (number) { node.type = 'number'; node.step = 'any'; node.min = '-1000000'; node.max = '1000000' }
      else node.maxLength = 160
      listen(node, 'input', () => {
        if (number && (!node.value.trim() || !node.validity.valid || !Number.isFinite(node.valueAsNumber))) return
        change(number ? node.valueAsNumber : node.value)
      })
      return node
    }
    const select = (value, options, change) => {
      const node = el('select', 'ne-select')
      for (const [id, text] of options) { const option = el('option', '', text); option.value = id; node.append(option) }
      if (value && !options.some(([id]) => id === value)) { const option = el('option', '', value + '（不可用）'); option.value = value; node.append(option) }
      node.value = value || ''; listen(node, 'change', () => change(node.value)); return node
    }
    const checkbox = (checked, change) => {
      const node = el('input'); node.type = 'checkbox'; node.checked = checked
      listen(node, 'change', () => change(node.checked)); return node
    }
    const editRule = (id, change, rerender = false) => save(draft => { const item = draft.rules.find(row => row.id === id); if (item) change(item) }, rerender)
    const variables = project.variables.map(item => [item.id, item.name || item.id])
    const nodes = project.nodes.map(node => [node.id, node.title || node.id])
    const nodeSelect = (value, change) => select(value, [['', '请选择节点'], ...nodes], change)
    const heading = el('div', 'ne-row ne-rules-heading')
    heading.append(el('h2', 'ne-section-title', '属性'), el('span', 'ne-badge', project.variables.length + ' 项'))
    const attributes = el('div', 'ne-stack')
    for (const definition of project.variables) {
      const box = el('section', 'ne-card ne-stack ne-rules-attribute')
      const edit = change => save(draft => { const item = draft.variables.find(row => row.id === definition.id); if (item) change(item) })
      const name = input(definition.name, value => edit(item => { item.name = value.slice(0, 80) }))
      name.maxLength = 80
      const initial = input(definition.initial, value => edit(item => { item.initial = Math.max(item.min, Math.min(item.max, value)) }), true)
      const min = input(definition.min, value => edit(item => { item.min = value; item.max = Math.max(value, item.max); item.initial = Math.max(item.min, Math.min(item.max, item.initial)) }), true)
      const max = input(definition.max, value => edit(item => { item.max = value; item.min = Math.min(value, item.min); item.initial = Math.max(item.min, Math.min(item.max, item.initial)) }), true)
      const row = el('div', 'ne-rules-range'); row.append(field('初始值', initial), field('最小值', min), field('最大值', max))
      const remove = button('删除属性', () => {
        if (referenced(engine.project, definition.id)) return engine.error('该属性仍被条件或动作引用，请先移除引用')
        save(draft => { draft.variables = draft.variables.filter(item => item.id !== definition.id) }, true)
      }, 'ne-button ne-danger ne-rules-small')
      remove.title = '被条件或动作引用的属性需要先移除引用'
      box.append(field('属性名称', name), row, remove); attributes.append(box)
      syncers.push(() => {
        const item = engine.project.variables.find(row => row.id === definition.id)
        if (!item) return
        for (const [key, control] of Object.entries({ name, initial, min, max })) if (document.activeElement !== control) control.value = item[key]
      })
    }
    if (!project.variables.length) attributes.append(el('p', 'ne-muted', '添加好感度、勇气等数值，让选择影响故事。'))
    const addVariable = button('＋ 添加属性', () => save(draft => { draft.variables.push({ id: 'attribute-' + crypto.randomUUID(), name: '新属性', initial: 0, min: 0, max: 100 }) }, true))
    addVariable.disabled = project.variables.length >= 80

    const ruleHeading = el('div', 'ne-row ne-rules-heading')
    ruleHeading.append(el('h2', 'ne-section-title', '事件规则'), el('span', 'ne-badge', project.rules.length + ' 条'))
    const rules = el('div', 'ne-stack')
    for (const [ruleIndex, rule] of project.rules.entries()) {
      const box = el('details', 'ne-card ne-rules-rule'), summary = el('summary', '', rule.name || '未命名规则'), content = el('div', 'ne-stack ne-rules-rule-body')
      box.open = project.rules.length <= 3 || ruleIndex === project.rules.length - 1
      box.append(summary, content)
      const patch = (change, rerender = false) => editRule(rule.id, change, rerender)
      content.append(field('规则名称', input(rule.name, value => patch(item => { item.name = value }))),
        field('触发事件', select(rule.event, RULE_EVENTS.map(event => [event, eventNames[event]]), value => patch(item => { item.event = value }))),
        field('限定节点', select(rule.nodeId || '', [['', '任意节点'], ...nodes], value => patch(item => { if (value) item.nodeId = value; else delete item.nodeId }))),
        field('每次试玩只执行一次', checkbox(rule.once, value => patch(item => { item.once = value }))))
      const conditionToggle = checkbox(!!rule.condition, value => patch(item => {
        if (value) item.condition = { type: 'variable', variable: variables[0][0], op: 'gte', value: 0 }
        else delete item.condition
      }, true))
      conditionToggle.disabled = !variables.length && !rule.condition
      content.append(field('满足属性条件时触发', conditionToggle))
      if (rule.condition) {
        const conditionBox = el('div', 'ne-rules-condition ne-stack')
        const conditionPatch = (key, value) => patch(item => { item.condition[key] = value })
        conditionBox.append(field('条件属性', select(rule.condition.variable, variables, value => conditionPatch('variable', value))),
          field('比较方式', select(rule.condition.op, ops, value => conditionPatch('op', value))),
          field('比较数值', input(rule.condition.value, value => conditionPatch('value', value), true)))
        content.append(conditionBox)
      }
      content.append(el('h3', 'ne-section-title', '按顺序执行动作'))
      const metadata = engine.actions()
      for (const [index, action] of rule.actions.entries()) {
        const descriptor = metadata.find(item => item.type === action.type), actionBox = el('div', 'ne-rules-action ne-stack')
        actionBox.append(el('span', 'ne-badge', (index + 1) + ' · ' + (descriptor?.label || '未注册动作：' + action.type)))
        const actionPatch = (key, value) => patch(item => { item.actions[index][key] = value })
        for (const spec of descriptor?.fields || []) {
          let control
          if (spec.kind === 'variable') control = select(action[spec.key], variables, value => actionPatch(spec.key, value))
          else if (spec.kind === 'node') control = nodeSelect(action[spec.key], value => { if (value) actionPatch(spec.key, value) })
          else if (spec.kind === 'asset') control = select(action[spec.key] ?? spec.default, actionAssetOptions(spec, project), value => actionPatch(spec.key, value))
          else if (spec.kind === 'boolean') control = checkbox(action[spec.key] ?? actionFieldDefault(spec, project), value => actionPatch(spec.key, value))
          else if (spec.kind === 'expression') {
            const expressions = [...new Set(['neutral', 'happy', 'sad', ...project.characters.flatMap(item => Object.keys(item.expressions || {}))])]
            control = select(action[spec.key], expressions.map(value => [value, ({ neutral: '默认', happy: '开心', sad: '难过' })[value] || value]), value => actionPatch(spec.key, value))
          } else control = input(action[spec.key], value => actionPatch(spec.key, value), spec.kind === 'number')
          actionBox.append(field(spec.label, control))
        }
        actionBox.append(button('移除动作', () => patch(item => { item.actions.splice(index, 1) }, true), 'ne-button ne-danger ne-rules-small'))
        content.append(actionBox)
      }
      let actionType = metadata[0]?.type || ''
      const picker = select(actionType, metadata.map(item => [item.type, item.label]), value => { actionType = value })
      const addAction = button('＋ 添加动作', () => {
        const descriptor = metadata.find(item => item.type === actionType)
        if (!descriptor) return
        const action = { type: actionType }
        for (const spec of descriptor.fields || []) action[spec.key] = actionFieldDefault(spec, project)
        if ((descriptor.fields || []).some(spec => action[spec.key] === undefined)) return engine.error('请先创建动作需要的属性或节点')
        patch(item => { item.actions.push(action) }, true)
      })
      addAction.disabled = !metadata.length || rule.actions.length >= 30
      content.append(field('添加动作类型', picker), addAction, button('删除规则', () => save(draft => { draft.rules = draft.rules.filter(item => item.id !== rule.id) }, true), 'ne-button ne-danger'))
      syncers.push(() => { summary.textContent = engine.project.rules.find(item => item.id === rule.id)?.name || '未命名规则' })
      rules.append(box)
    }
    if (!project.rules.length) rules.append(el('p', 'ne-muted', '在进入节点、做出选择或聊天后，自动改变数值和表情。'))
    const addRule = button('＋ 添加事件规则', () => save(draft => { draft.rules.push({ id: 'rule-' + crypto.randomUUID(), name: '新的事件规则', event: 'node.enter', once: false, actions: [] }) }, true))
    addRule.disabled = project.rules.length >= 200
    sync = () => { root.disabled = engine.mode !== 'edit' || engine.held; for (const fn of syncers) fn() }
    root.replaceChildren(heading, attributes, addVariable, ruleHeading, rules, addRule)
    sync()
  }
  const unobserve = observe(event => {
    if (disposed) return
    if (event?.type === 'registry' || event?.type === 'mode' || (event?.type === 'project' && event.render !== false)) render()
    else sync()
  })
  render()
  return () => { disposed = true; controller?.abort(); unobserve(); root.remove() }
}
