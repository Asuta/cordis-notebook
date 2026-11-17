const LIMITS = { nodes: 300, lines: 200, choices: 20, actions: 30 }
const isChapter = node => ['story', 'ending'].includes(node.type)
const element = (tag, className, text) => {
  const node = document.createElement(tag)
  node.className = className || ''
  if (text != null) node.textContent = text
  return node
}
const uid = prefix => prefix + '-' + crypto.randomUUID()
const assertRoom = (rows, key, label) => { if (rows.length >= LIMITS[key]) throw Error(label + '最多 ' + LIMITS[key] + ' 个') }

// Legacy chat and rule links still protect a chapter from deletion.
function references(project, id) {
  const found = []
  for (const node of project.nodes) {
    if (node.id === id) continue
    if (node.next === id || node.chat?.next === id || node.choices.some(choice => choice.target === id || choice.actions.some(action => action.type === 'goto' && action.target === id))) found.push(node.title || node.id)
  }
  for (const rule of project.rules) if (rule.nodeId === id || rule.actions.some(action => action.type === 'goto' && action.target === id)) found.push('规则「' + (rule.name || rule.id) + '」')
  return [...new Set(found)]
}

/** Standalone panel; optional ui.navigate closes the settings dialog before play. */
export function mountEditor(host, { engine, sdk, ui }) {
  let disposed = false, updating = false, activeId = '', projectId = engine.project.id, pendingDelete = ''
  const cleanups = [], bindings = new Map(), commands = new Map()
  const root = element('section', 'vn-editor'), notice = element('p', 'vn-editor-notice')
  const fieldset = element('fieldset', 'vn-editor-fieldset'), toolbar = element('div', 'vn-editor-toolbar')
  const layout = element('div', 'vn-editor-layout'), sidebar = element('nav', 'vn-editor-chapters'), detail = element('div', 'vn-editor-detail')
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); notice.hidden = true
  sidebar.setAttribute('aria-label', '剧情章节')
  layout.append(sidebar, detail); fieldset.append(toolbar, layout); root.append(notice, fieldset); host.append(root)
  const report = error => { if (!disposed) { notice.textContent = error.message || String(error); notice.hidden = false }; sdk.toast(error.message || String(error)) }
  const current = () => engine.project.nodes.find(node => node.id === activeId && isChapter(node))
  const editable = () => {
    if (disposed) throw Error('编辑器已卸载')
    if (engine.project.id !== projectId) throw Error('作品已切换，请重新打开编辑器')
    if (engine.mode === 'play' || engine.held) throw Error('请先返回编辑器，或等待作品保存完成')
  }
  function update(mutator, structural = false) {
    editable(); updating = true
    try { engine.update(mutator, { render: structural }) } finally { updating = false }
    notice.textContent = ''; notice.hidden = true
    refreshChapters()
  }
  function editNode(mutator, structural = false) {
    const id = activeId
    update(project => {
      const node = project.nodes.find(item => item.id === id)
      if (!node || !isChapter(node)) throw Error('章节已移除或类型已改变，请重新选择')
      mutator(node, project)
    }, structural)
  }
  function button(label, run, { disabled = false, danger = false, title } = {}) {
    const node = element('button', 'vn-editor-button' + (danger ? ' vn-editor-danger' : ''), label)
    node.type = 'button'; node.disabled = disabled
    if (title) node.setAttribute('aria-label', title)
    commands.set(node, run)
    return node
  }
  function commit(input) {
    const binding = bindings.get(input)
    if (!binding || input.value === binding.saved) { input.removeAttribute('aria-invalid'); return true }
    try {
      if (input.maxLength > 0 && input.value.length > input.maxLength) throw Error('「' + input.getAttribute('aria-label') + '」最多 ' + input.maxLength + ' 字')
      binding.save(input.value)
      binding.saved = input.value; input.removeAttribute('aria-invalid')
      return true
    } catch (error) { input.setAttribute('aria-invalid', 'true'); report(error); return false }
  }
  // Failed changes remain visible; structural clicks must not discard their drafts.
  function flush() {
    for (const input of bindings.keys()) if (!commit(input)) { input.focus(); return false }
    return true
  }
  function field(parent, label, value, save, { options, maxLength, multiline = false, number = false, min = -1000000, max = 1000000, key } = {}) {
    const wrap = element('label', 'vn-editor-field'), input = element(options ? 'select' : multiline ? 'textarea' : 'input', 'vn-editor-input')
    wrap.append(element('span', 'vn-editor-label', label), input); parent.append(wrap)
    input.setAttribute('aria-label', label); input.dataset.field = key || label
    if (maxLength) input.maxLength = maxLength
    if (multiline) input.rows = 3
    if (number) { input.type = 'number'; input.min = String(min); input.max = String(max); input.step = 'any' }
    if (options) setOptions(input, options, value)
    else input.value = String(value ?? '')
    bindings.set(input, { saved: input.value, save: raw => {
      if (number && (raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < min || Number(raw) > max)) throw Error('「' + label + '」须为 ' + min + ' 至 ' + max + ' 的数值')
      save(number ? Number(raw) : raw)
    } })
    return input
  }
  function setOptions(input, options, value) {
    const rows = [...options]
    if (!rows.some(([id]) => id === (value || ''))) rows.push([value, '未找到或不支持：' + value])
    input.replaceChildren(...rows.map(([id, label]) => { const option = element('option', '', label); option.value = id; return option }))
    input.value = value || ''
  }
  const characterOptions = () => [['', '旁白 / 无角色'], ...engine.project.characters.map(c => [c.id, c.name || c.id])]
  const variableOptions = () => engine.project.variables.map(v => [v.id, (v.name || v.id) + '（' + v.min + '～' + v.max + '）'])
  const nodeName = id => { const n = engine.project.nodes.find(n => n.id === id); return n ? n.title || n.id : '缺失：' + id }
  const targets = () => [['', '未连接'], ...engine.project.nodes.filter(isChapter).map((n, index) => [n.id, (index + 1) + '. ' + (n.title || n.id) + (n.type === 'ending' ? '（结局）' : '')])]
  function section(title, parent = detail) {
    const node = element('section', 'vn-editor-section'); node.append(element('h3', 'vn-editor-heading', title)); parent.append(node); return node
  }
  function refreshChapters() {
    const chapters = engine.project.nodes.filter(isChapter)
    const existing = new Map([...sidebar.querySelectorAll('button')].map(item => [item.dataset.nodeId, item]))
    const heading = sidebar.querySelector('h3') || element('h3', 'vn-editor-heading')
    heading.textContent = '章节 · ' + chapters.length + ' / ' + LIMITS.nodes
    const children = [heading]
    if (!chapters.length) children.push(element('p', 'vn-editor-hint', '还没有剧情章节，点击“新增章节”开始。'))
    chapters.forEach((node, index) => {
      const choose = () => { pendingDelete = ''; engine.select({ nodeId: node.id }); if (activeId !== node.id) render() }
      const item = existing.get(node.id) || button('', choose)
      commands.set(item, choose); existing.delete(node.id)
      item.className = 'vn-editor-chapter'; item.dataset.nodeId = node.id
      item.setAttribute('aria-pressed', String(node.id === activeId))
      if (!item.firstChild) item.append(element('span', 'vn-editor-chapter-title'), element('span', 'vn-editor-meta'), element('span', 'vn-editor-links'))
      item.children[0].textContent = String(index + 1).padStart(2, '0') + ' · ' + (node.title || '未命名章节')
      item.children[1].textContent = (node.type === 'ending' ? '结局 · ending' : '章节 · story') + (engine.project.startNodeId === node.id ? ' · 起点' : '')
      const links = node.choices.length ? node.choices.map(choice => (choice.text || '未命名选项') + ' → ' + (choice.target ? nodeName(choice.target) : '未连接')).join('；') : node.type === 'ending' ? '故事结束' : node.next ? '→ ' + nodeName(node.next) : '未设置后续章节'
      item.children[2].textContent = links; children.push(item)
    })
    const other = engine.project.nodes.length - chapters.length
    if (other) {
      const hint = sidebar.querySelector('.vn-editor-other') || element('p', 'vn-editor-hint vn-editor-other')
      hint.textContent = '另有 ' + other + ' 个其他类型节点，仍保留在作品中；节点总数 ' + engine.project.nodes.length + ' / ' + LIMITS.nodes + '。'
      children.push(hint)
    }
    for (const item of existing.values()) commands.delete(item)
    // Keep buttons attached through a field's blur/change so a pending click still lands.
    if (children.length !== sidebar.children.length || children.some((child, index) => child !== sidebar.children[index])) sidebar.replaceChildren(...children)
  }
  function addChapter(type) {
    const id = uid(type), stage = current()?.stage
    update(project => {
      assertRoom(project.nodes, 'nodes', '节点')
      project.nodes.push({ id, type, title: type === 'ending' ? '新的结局' : '新的章节', stage: stage ? structuredClone(stage) : { background: '', characterId: '', expression: 'neutral', position: 50, scale: 100 }, lines: [{ speaker: '', text: '' }], choices: [], next: '' })
    }, true)
    engine.select({ nodeId: id }); render()
  }
  function checkDelete(project, id) {
    if (project.startNodeId === id) throw Error('这是起始节点，请先将其他章节设为起点')
    const refs = references(project, id)
    if (refs.length) throw Error('章节仍被引用：' + refs.join('、') + '。请先移除跳转或规则引用')
  }
  function render() {
    if (disposed) return
    projectId = engine.project.id; activeId = engine.selection.nodeId
    bindings.clear(); commands.clear(); toolbar.replaceChildren(); detail.replaceChildren()
    toolbar.append(button('新增章节', () => addChapter('story'), { disabled: engine.project.nodes.length >= LIMITS.nodes }), button('新增结局', () => addChapter('ending'), { disabled: engine.project.nodes.length >= LIMITS.nodes }))
    refreshChapters(); syncState()
    const node = current()
    if (!node) { detail.append(element('p', 'vn-editor-hint', '请在左侧选择剧情章节或结局。其他类型节点由对应插件编辑。')); return }
    toolbar.append(button('从此段试读', async () => {
      const id = activeId
      engine.select({ nodeId: id })
      await ui?.navigate?.('scene.editor')
      await engine.play(id)
    }), button(engine.project.startNodeId === node.id ? '当前为起点' : '设为起始节点', () => { update(p => { p.startNodeId = activeId }, true); render() }, { disabled: engine.project.startNodeId === node.id }))
    toolbar.append(button('删除章节', () => { checkDelete(engine.project, activeId); pendingDelete = activeId; render() }, { danger: true }))
    if (pendingDelete === activeId) {
      const confirm = element('div', 'vn-editor-confirm'); confirm.setAttribute('role', 'alert')
      confirm.append(element('p', 'vn-editor-hint', '删除「' + (node.title || node.id) + '」及其全部对白、选项？此操作不能撤销。'), button('确认删除章节', () => {
        const id = activeId
        update(project => { checkDelete(project, id); project.nodes = project.nodes.filter(item => item.id !== id) }, true)
        pendingDelete = ''; engine.select({ nodeId: engine.project.nodes.find(isChapter)?.id || engine.project.startNodeId }); render()
      }, { danger: true }), button('取消删除', () => { pendingDelete = ''; render() })); detail.append(confirm)
    }
    const basics = section('章节与舞台'), grid = element('div', 'vn-editor-grid'); basics.append(grid)
    field(grid, '章节标题', node.title, value => editNode(n => { n.title = value }), { maxLength: 160, key: 'title' })
    field(grid, '章节类型', node.type, value => editNode(n => { n.type = value }), { options: [['story', '章节 · story'], ['ending', '结局 · ending']], key: 'type' })
    field(grid, '背景素材', node.stage.background, value => editNode(n => { n.stage.background = value }), { options: [['', '无背景'], ...engine.project.assets.filter(a => a.kind === 'image').map(a => [a.id, a.name])], key: 'stage.background' })
    const expressionOptions = () => {
      const character = engine.project.characters.find(c => c.id === current()?.stage.characterId)
      return [['', '默认立绘'], ...Object.keys(character?.expressions || {}).map(key => [key, ({ neutral: '默认', happy: '开心', sad: '难过' })[key] || key])]
    }
    let expression
    field(grid, '舞台角色', node.stage.characterId, value => {
      editNode(n => { n.stage.characterId = value })
      setOptions(expression, expressionOptions(), current().stage.expression)
      bindings.get(expression).saved = expression.value
    }, { options: characterOptions(), key: 'stage.characterId' })
    expression = field(grid, '角色表情', node.stage.expression, value => editNode(n => { n.stage.expression = value }), { options: expressionOptions(), key: 'stage.expression' })
    field(grid, '角色位置（%）', node.stage.position, value => editNode(n => { n.stage.position = value }), { number: true, min: 0, max: 100, key: 'stage.position' })
    field(grid, '角色缩放（%）', node.stage.scale, value => editNode(n => { n.stage.scale = value }), { number: true, min: 30, max: 180, key: 'stage.scale' })
    field(grid, '后续章节（next）', node.next || '', value => editNode(n => { n.next = value }), { options: targets(), key: 'next' })
    basics.append(element('p', 'vn-editor-hint', '对白依次播放。设置了选项时由选项决定跳转；没有选项时进入 next。结局没有选项时结束，忽略 next。'))
    renderLines(node); renderChoices(node)
  }
  function renderLines(node) {
    const lines = section('顺序对白 · ' + node.lines.length + ' / ' + LIMITS.lines)
    if (!node.lines.length) lines.append(element('p', 'vn-editor-hint', '暂无对白，可直接展示选项或连接下一章。'))
    node.lines.forEach((line, index) => {
      const row = element('div', 'vn-editor-card'), head = element('div', 'vn-editor-row')
      head.append(element('strong', 'vn-editor-label', '对白 ' + (index + 1)))
      for (const [label, offset] of [['上移', -1], ['下移', 1]]) head.append(button(label, () => {
        editNode(n => { const [item] = n.lines.splice(index, 1); n.lines.splice(index + offset, 0, item) }, true); render()
      }, { disabled: index + offset < 0 || index + offset >= node.lines.length, title: label + '对白 ' + (index + 1) }))
      head.append(button('删除', () => { editNode(n => { n.lines.splice(index, 1) }, true); render() }, { danger: true, title: '删除对白 ' + (index + 1) })); row.append(head)
      field(row, '对白 ' + (index + 1) + ' 说话者', line.speaker, value => editNode(n => { n.lines[index].speaker = value }), { options: characterOptions(), key: 'lines.' + index + '.speaker' })
      field(row, '对白 ' + (index + 1) + ' 文本', line.text, value => editNode(n => { n.lines[index].text = value }), { multiline: true, maxLength: 8000, key: 'lines.' + index + '.text' })
      lines.append(row)
    })
    lines.append(button('新增对白', () => { editNode(n => { assertRoom(n.lines, 'lines', '对白'); n.lines.push({ speaker: '', text: '' }) }, true); render() }, { disabled: node.lines.length >= LIMITS.lines }))
  }
  function renderChoices(node) {
    const choices = section('分支选项 · ' + node.choices.length + ' / ' + LIMITS.choices)
    if (!node.choices.length) choices.append(element('p', 'vn-editor-hint', '暂无选项。新增选项后，请为每个选项连接目标章节。'))
    node.choices.forEach((choice, index) => {
      const row = element('div', 'vn-editor-card'), head = element('div', 'vn-editor-row')
      const editChoice = (fn, structural = false) => editNode((n, p) => {
        const c = n.choices.find(item => item.id === choice.id)
        if (!c) throw Error('选项已被移除，请重新选择章节')
        fn(c, p)
      }, structural)
      head.append(element('strong', 'vn-editor-label', '选项 ' + (index + 1)), button('删除选项', () => { editNode(n => { n.choices = n.choices.filter(c => c.id !== choice.id) }, true); render() }, { danger: true, title: '删除选项 ' + (index + 1) })); row.append(head)
      field(row, '选项 ' + (index + 1) + ' 文字', choice.text, value => editChoice(c => { c.text = value }), { maxLength: 600, key: 'choices.' + index + '.text' })
      field(row, '选项 ' + (index + 1) + ' 目标', choice.target, value => editChoice(c => { c.target = value }), { options: targets(), key: 'choices.' + index + '.target' })
      const conditions = section('显示条件', row)
      if (!choice.condition) {
        conditions.append(element('p', 'vn-editor-hint', '无条件，始终显示。'), button('添加变量条件', () => {
          editChoice((c, p) => { if (!p.variables.length) throw Error('作品中尚无变量，请先添加变量'); c.condition = { type: 'variable', variable: p.variables[0].id, op: 'gte', value: p.variables[0].initial } }, true); render()
        }, { disabled: !engine.project.variables.length, title: '为选项 ' + (index + 1) + ' 添加变量条件' }))
        if (!engine.project.variables.length) conditions.append(element('p', 'vn-editor-hint', '作品中尚无变量，添加变量后可配置条件和动作。'))
      } else {
        if ((choice.condition.type || 'variable') === 'variable') {
          const grid = element('div', 'vn-editor-grid'); conditions.append(grid)
          field(grid, '选项 ' + (index + 1) + ' 条件变量', choice.condition.variable, value => editChoice(c => { c.condition.variable = value }), { options: variableOptions(), key: 'choices.' + index + '.condition.variable' })
          field(grid, '选项 ' + (index + 1) + ' 比较方式', choice.condition.op, value => editChoice(c => { c.condition.op = value }), { options: [['gte', '大于等于 ≥'], ['lte', '小于等于 ≤'], ['eq', '等于 ='], ['gt', '大于 >'], ['lt', '小于 <']], key: 'choices.' + index + '.condition.op' })
          field(grid, '选项 ' + (index + 1) + ' 条件值', choice.condition.value, value => editChoice(c => { c.condition.value = value }), { number: true, key: 'choices.' + index + '.condition.value' })
        } else conditions.append(element('p', 'vn-editor-hint', '保留自定义条件「' + choice.condition.type + '」。当前剧情播放器不支持此条件，可移除后改用变量条件。'))
        conditions.append(button('移除条件', () => { editChoice(c => { delete c.condition }, true); render() }, { title: '移除选项 ' + (index + 1) + ' 条件' }))
      }
      const actions = section('变量动作 · ' + choice.actions.length + ' / ' + LIMITS.actions, row)
      choice.actions.forEach((action, actionIndex) => {
        const actionRow = element('div', 'vn-editor-action'), prefix = '选项 ' + (index + 1) + ' 动作 ' + (actionIndex + 1), key = 'choices.' + index + '.actions.' + actionIndex
        if (['add-variable', 'set-variable'].includes(action.type)) {
          field(actionRow, prefix + ' 变量', action.variable, value => editChoice(c => { c.actions[actionIndex].variable = value }), { options: variableOptions(), key: key + '.variable' })
          field(actionRow, prefix + ' 方式', action.type, value => editChoice(c => { c.actions[actionIndex].type = value }), { options: [['add-variable', '增减（负数为减少）'], ['set-variable', '设为指定值']], key: key + '.type' })
          field(actionRow, prefix + ' 数值', action.value, value => editChoice(c => { c.actions[actionIndex].value = value }), { number: true, key: key + '.value' })
        } else actionRow.append(element('p', 'vn-editor-hint', '保留动作「' + action.type + '」：' + JSON.stringify(action) + '。当前剧情播放器不支持此动作，请移除或通过原插件编辑。'))
        actionRow.append(button('删除动作', () => { editChoice(c => { c.actions.splice(actionIndex, 1) }, true); render() }, { danger: true, title: '删除' + prefix })); actions.append(actionRow)
      })
      actions.append(button('添加变量动作', () => {
        editChoice((c, p) => { assertRoom(c.actions, 'actions', '动作'); if (!p.variables.length) throw Error('作品中尚无变量，请先添加变量'); c.actions.push({ type: 'add-variable', variable: p.variables[0].id, value: 1 }) }, true); render()
      }, { disabled: !engine.project.variables.length || choice.actions.length >= LIMITS.actions, title: '为选项 ' + (index + 1) + ' 添加变量动作' }))
      choices.append(row)
    })
    choices.append(button('新增选项', () => { editNode(n => { assertRoom(n.choices, 'choices', '选项'); n.choices.push({ id: uid('choice'), text: '新的选项', target: '', actions: [] }) }, true); render() }, { disabled: node.choices.length >= LIMITS.choices }))
  }
  function syncState() { fieldset.disabled = engine.mode === 'play' || engine.held }
  const change = event => { if (!disposed && bindings.has(event.target)) commit(event.target) }
  const click = event => {
    const target = event.target.closest('button'), run = commands.get(target)
    if (!run || target.disabled || fieldset.disabled || disposed || !flush()) return
    try { Promise.resolve(run()).catch(report) } catch (error) { report(error) }
  }
  root.addEventListener('change', change); root.addEventListener('click', click)
  const owner = { effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup } }
  engine.observe(owner, event => {
    if (disposed || updating) return
    syncState()
    if (event.type === 'selection' && engine.selection.nodeId !== activeId) {
      if (!flush()) { updating = true; try { engine.select({ nodeId: activeId }) } finally { updating = false }; return }
      pendingDelete = ''; render()
    } else if (event.type === 'project') {
      if (engine.project.id !== projectId || event.render !== false) render()
      else refreshChapters()
    }
  })
  render()
  return () => {
    if (disposed) return
    disposed = true; root.removeEventListener('change', change); root.removeEventListener('click', click)
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()
    bindings.clear(); commands.clear(); root.remove()
  }
}
