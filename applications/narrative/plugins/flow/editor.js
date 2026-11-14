import { createNode, flowEdges } from './model.js'

const el = (tag, className = '', text) => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const ops = [['gte', '≥'], ['lte', '≤'], ['eq', '='], ['gt', '>'], ['lt', '<']]

export const actionAssetOptions = (spec, project) => [['', '使用默认素材'], ...project.assets
  .filter(asset => !spec.assetKind || asset.kind === spec.assetKind)
  .map(asset => [asset.id, asset.name || asset.id])]

export function actionFieldDefault(spec, project) {
  if (spec.kind === 'variable') return project.variables[0]?.id
  if (spec.kind === 'node') return project.nodes[0]?.id
  if (spec.kind === 'boolean') return spec.default ?? false
  return spec.default ?? ''
}

export function mountFlowEditor(engine, container, observe) {
  const root = el('section', 'ne-flow-editor ne-stack')
  container.append(root)
  let controller, refreshList = () => {}, disposed = false
  const fail = error => engine.error(error.message || String(error))
  const run = action => { try { Promise.resolve(action()).catch(fail) } catch (error) { fail(error) } }
  const save = (change, render = false) => {
    if (engine.mode !== 'edit' || engine.held) return
    return engine.update(change, { render })
  }

  function render() {
    controller?.abort()
    controller = new AbortController()
    const signal = controller.signal
    const listen = (node, event, fn) => node.addEventListener(event, () => run(fn), { signal })
    const button = (text, fn, className = 'ne-button') => {
      const node = el('button', className, text)
      node.type = 'button'; listen(node, 'click', fn); return node
    }
    const field = (label, control) => { const node = el('label', 'ne-field'); node.append(el('span', '', label), control); return node }
    const input = (value, change, { number = false, multiline = false, maxLength = 160 } = {}) => {
      const node = el(multiline ? 'textarea' : 'input', multiline ? 'ne-textarea' : 'ne-input')
      if (number) { node.type = 'number'; node.step = 'any'; node.min = '-1000000'; node.max = '1000000' }
      else node.maxLength = maxLength
      if (multiline) node.rows = 3
      node.value = value ?? ''
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
    const project = engine.project, types = engine.nodeTypes(), current = engine.scene()
    const nodes = project.nodes.map(node => [node.id, node.title || node.id])
    const variables = project.variables.map(item => [item.id, item.name || item.id])
    const nodeSelect = (value, change, empty = '请选择节点') => select(value, [['', empty], ...nodes], change)
    const editNode = (change, rerender = false) => save(draft => {
      const node = draft.nodes.find(item => item.id === current?.id)
      if (node) change(node)
    }, rerender)
    const header = el('div', 'ne-row ne-flow-editor-heading')
    header.append(el('h2', 'ne-section-title', '剧情流程'), el('span', 'ne-badge', project.nodes.length + ' 个节点'))
    const map = el('div', 'ne-flow-map'), list = el('nav', 'ne-flow-list')
    list.setAttribute('aria-label', '剧情节点列表')
    // List listeners use their own scope because titles update without remounting inputs.
    let listController = new AbortController()
    signal.addEventListener('abort', () => listController.abort(), { once: true })
    refreshList = () => {
      listController.abort(); listController = new AbortController()
      const listSignal = listController.signal, rows = engine.project.nodes, registry = engine.nodeTypes()
      list.replaceChildren(); map.replaceChildren()
      const choose = id => { if (!engine.held && engine.mode === 'edit') engine.select({ nodeId: id }) }
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg')
      const height = Math.max(56, Math.ceil(rows.length / 3) * 42 + 16)
      svg.setAttribute('viewBox', '0 0 300 ' + height)
      svg.setAttribute('aria-label', '节点连接缩略图'); svg.setAttribute('role', 'group')
      svg.style.height = height + 'px'
      const positions = new Map(rows.map((node, index) => [node.id, { x: 38 + (index % 3) * 108, y: 25 + Math.floor(index / 3) * 42 }]))
      for (const edge of flowEdges(rows)) {
        const a = positions.get(edge.from), b = positions.get(edge.to), path = document.createElementNS(ns, 'path')
        path.setAttribute('d', a === b ? `M ${a.x - 6} ${a.y - 7} c -20 -28 32 -28 12 0` : `M ${a.x} ${a.y} C ${a.x} ${a.y + 22}, ${b.x} ${b.y - 22}, ${b.x} ${b.y}`)
        path.setAttribute('class', 'ne-flow-edge')
        const title = document.createElementNS(ns, 'title'); title.textContent = edge.label; path.append(title); svg.append(path)
      }
      for (const [index, node] of rows.entries()) {
        const selected = node.id === engine.selection.nodeId, type = registry.find(item => item.type === node.type)
        const item = el('button', 'ne-flow-list-node' + (selected ? ' is-selected' : ''))
        item.type = 'button'; item.disabled = engine.mode !== 'edit' || engine.held
        item.setAttribute('aria-current', selected ? 'step' : 'false')
        const name = el('span', 'ne-flow-node-name', node.title || '未命名节点')
        const badge = el('span', 'ne-badge ne-flow-type', type?.label || node.type)
        badge.style.setProperty('--ne-node-color', type?.color || '#8f9aaa')
        item.append(el('span', 'ne-flow-number', String(index + 1).padStart(2, '0')), name, badge)
        if (node.id === engine.project.startNodeId) item.append(el('span', 'ne-flow-start', '起点'))
        item.addEventListener('click', () => run(() => choose(node.id)), { signal: listSignal }); list.append(item)
        const point = positions.get(node.id), group = document.createElementNS(ns, 'g'), circle = document.createElementNS(ns, 'circle'), label = document.createElementNS(ns, 'text')
        group.setAttribute('class', 'ne-flow-point' + (selected ? ' is-selected' : ''))
        group.setAttribute('role', 'button'); group.setAttribute('tabindex', engine.mode === 'edit' && !engine.held ? '0' : '-1')
        group.setAttribute('aria-label', node.title || node.id)
        circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y); circle.setAttribute('r', '13')
        label.setAttribute('x', point.x); label.setAttribute('y', point.y + 4); label.textContent = String(index + 1)
        group.append(circle, label)
        group.addEventListener('click', () => run(() => choose(node.id)), { signal: listSignal })
        group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); run(() => choose(node.id)) } }, { signal: listSignal })
        svg.append(group)
      }
      map.append(svg)
    }
    refreshList()
    const controls = el('fieldset', 'ne-flow-fields ne-stack')
    controls.disabled = engine.mode !== 'edit' || engine.held
    const add = el('div', 'ne-row ne-flow-add')
    for (const [type, label] of [['story', '＋ 剧情'], ['chat', '＋ 聊天'], ['ending', '＋ 结局']]) {
      const control = button(label, () => {
        const node = createNode(type, engine.project.characters)
        save(draft => { draft.nodes.push(node) }, true)
        engine.select({ nodeId: node.id })
      })
      control.disabled = !types.some(item => item.type === type) || project.nodes.length >= 300
      if (control.disabled) control.title = '请先启用对应节点插件，节点上限为 300 个'
      add.append(control)
    }
    controls.append(add, field('故事起点', nodeSelect(project.startNodeId, value => { if (value) save(draft => { draft.startNodeId = value }, true) })))
    if (current) {
      const card = el('section', 'ne-card ne-stack ne-flow-detail')
      const typeOptions = types.map(item => [item.type, item.label])
      card.append(field('节点标题', input(current.title, value => editNode(node => { node.title = value }))),
        field('节点类型', select(current.type, typeOptions, value => editNode(node => {
          node.type = value
          if (value === 'chat' && !node.chat) node.chat = { ...createNode('chat', project.characters).chat, next: node.next || '' }
        }, true))))
      const preview = button('从此节点试玩 ↗', () => engine.play(current.id), 'ne-button ne-primary')
      preview.disabled = !types.some(item => item.type === current.type)
      card.append(preview)
      if (current.type === 'chat') card.append(el('p', 'ne-muted', '自由聊天的角色、提示词和聊天界面由 AI 插件配置。'))
      card.append(el('h3', 'ne-section-title', '对白'))
      for (const [index, line] of current.lines.entries()) {
        const row = el('div', 'ne-flow-line ne-stack')
        row.append(field('第 ' + (index + 1) + ' 句 · 说话者', select(line.speaker, [['', '旁白'], ...project.characters.map(item => [item.id, item.name])], value => editNode(node => { node.lines[index].speaker = value }))),
          field('对白内容', input(line.text, value => editNode(node => { node.lines[index].text = value }), { multiline: true, maxLength: 8000 })),
          button('删除这句', () => editNode(node => { node.lines.splice(index, 1) }, true), 'ne-button ne-danger ne-flow-small'))
        card.append(row)
      }
      if (!current.lines.length) card.append(el('p', 'ne-muted', '暂无对白，添加第一句，让故事开始。'))
      const addLine = button('＋ 添加对白', () => editNode(node => { node.lines.push({ speaker: '', text: '' }) }, true))
      addLine.disabled = current.lines.length >= 200
      card.append(addLine)

      const conditionEditor = (condition, change) => {
        const box = el('div', 'ne-flow-condition ne-stack'), toggle = el('input')
        let latest = condition
        const patch = (key, value) => { latest = { ...latest, [key]: value }; change(latest) }
        toggle.type = 'checkbox'; toggle.checked = !!condition; toggle.disabled = !variables.length && !condition
        listen(toggle, 'change', () => change(toggle.checked ? { type: 'variable', variable: variables[0][0], op: 'gte', value: 0 } : undefined, true))
        box.append(field('启用属性条件', toggle))
        if (condition) {
          box.append(field('条件属性', select(condition.variable, variables, value => patch('variable', value))),
            field('比较方式', select(condition.op, ops, value => patch('op', value))),
            field('比较数值', input(condition.value, value => patch('value', value), { number: true })))
        }
        return box
      }
      // Action fields are supplied by rules through engine.actions(), not a cross-plugin import.
      const actionEditor = (actions, change) => {
        const box = el('div', 'ne-stack ne-flow-actions'), metadata = engine.actions()
        for (const [index, action] of actions.entries()) {
          const row = el('div', 'ne-flow-action ne-stack'), descriptor = metadata.find(item => item.type === action.type)
          row.append(el('span', 'ne-muted', descriptor?.label || '未注册动作：' + action.type))
          const patch = (key, value) => change(items => { items[index][key] = value })
          for (const spec of descriptor?.fields || []) {
            let control
            if (spec.kind === 'variable') control = select(action[spec.key], variables, value => patch(spec.key, value))
            else if (spec.kind === 'node') control = nodeSelect(action[spec.key], value => { if (value) patch(spec.key, value) })
            else if (spec.kind === 'asset') control = select(action[spec.key] ?? spec.default, actionAssetOptions(spec, project), value => patch(spec.key, value))
            else if (spec.kind === 'boolean') {
              control = el('input'); control.type = 'checkbox'
              control.checked = action[spec.key] ?? actionFieldDefault(spec, project)
              listen(control, 'change', () => patch(spec.key, control.checked))
            }
            else if (spec.kind === 'expression') {
              const expressions = [...new Set(['neutral', 'happy', 'sad', ...project.characters.flatMap(item => Object.keys(item.expressions || {}))])]
              control = select(action[spec.key], expressions.map(value => [value, ({ neutral: '默认', happy: '开心', sad: '难过' })[value] || value]), value => patch(spec.key, value))
            } else control = input(action[spec.key], value => patch(spec.key, value), { number: spec.kind === 'number' })
            row.append(field(spec.label, control))
          }
          row.append(button('移除动作', () => change(items => { items.splice(index, 1) }, true), 'ne-button ne-danger ne-flow-small')); box.append(row)
        }
        let type = metadata[0]?.type || ''
        const picker = select(type, metadata.map(item => [item.type, item.label]), value => { type = value })
        const addAction = button('＋ 添加动作', () => {
          const descriptor = metadata.find(item => item.type === type)
          if (!descriptor) return
          const action = { type }
          for (const spec of descriptor.fields || []) action[spec.key] = actionFieldDefault(spec, project)
          if ((descriptor.fields || []).some(spec => action[spec.key] === undefined)) return engine.error('请先创建动作需要的属性或节点')
          change(items => { items.push(action) }, true)
        })
        addAction.disabled = !metadata.length || actions.length >= 30
        box.append(field('添加动作类型', picker), addAction)
        return box
      }
      if (current.type === 'story') {
        card.append(el('h3', 'ne-section-title', '分支选项'))
        for (const [index, choice] of current.choices.entries()) {
          const box = el('section', 'ne-flow-choice ne-stack')
          const patch = (change, rerender = false) => editNode(node => change(node.choices[index]), rerender)
          box.append(el('span', 'ne-badge', '选项 ' + (index + 1)),
            field('选项文字', input(choice.text, value => patch(item => { item.text = value }), { maxLength: 600 })),
            field('目标节点', nodeSelect(choice.target, value => patch(item => { item.target = value }), '未连接')),
            conditionEditor(choice.condition, (value, rerender) => patch(item => { if (value) item.condition = value; else delete item.condition }, rerender)),
            actionEditor(choice.actions || [], (change, rerender) => patch(item => { item.actions ||= []; change(item.actions) }, rerender)),
            button('删除选项', () => editNode(node => { node.choices.splice(index, 1) }, true), 'ne-button ne-danger'))
          card.append(box)
        }
        const addChoice = button('＋ 添加选项', () => editNode(node => { node.choices.push({ id: 'choice-' + crypto.randomUUID(), text: '新的选择', target: '', actions: [] }) }, true))
        addChoice.disabled = current.choices.length >= 20
        card.append(addChoice)
      }
      if (current.type !== 'ending') card.append(field('后续节点', nodeSelect(current.type === 'chat' ? current.chat?.next || current.next : current.next, value => editNode(node => {
        if (node.type === 'chat') { node.chat ||= createNode('chat', project.characters).chat; node.chat.next = value }
        else node.next = value
      }), '在此结束')), el('p', 'ne-muted', '剧情节点有选项时，需选择分支；无选项时继续到后续节点。'))
      controls.append(card)
    } else controls.append(el('p', 'ne-empty', '选择一个节点，编辑它的故事。'))
    root.replaceChildren(header, map, list, controls)
  }
  const unobserve = observe(event => {
    if (disposed) return
    if (event?.type === 'runtime' || event?.type === 'status') return
    if (event?.type === 'project' && event.render === false) refreshList()
    else render()
  })
  render()
  return () => { disposed = true; controller?.abort(); unobserve(); root.remove() }
}
