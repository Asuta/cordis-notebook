export function createSkillsSettings({ document, request }) {
  const $ = id => document.getElementById(id)
  let rules = new Map(), apps = [], generation = 0
  const element = (tag, text, className) => {
    const node = document.createElement(tag)
    if (text !== undefined) node.textContent = text
    if (className) node.className = className
    return node
  }
  const value = () => ({ directory: $('skills-directory').value.trim(), rules: [...rules.values()] })
  function renderSkill(skill) {
    const card = element('article', undefined, 'skill-card')
    const rule = rules.get(skill.path) || { path: skill.path, enabled: true, apps: null }
    const update = () => rules.set(skill.path, { ...rule, apps: rule.apps === null ? null : [...rule.apps] })
    const title = element('label', undefined, 'checkbox skill-title')
    const enabled = element('input'); enabled.type = 'checkbox'; enabled.checked = rule.enabled
    enabled.setAttribute('aria-label', '启用 ' + skill.name)
    enabled.onchange = () => { rule.enabled = enabled.checked; update() }
    title.append(enabled, element('strong', skill.name)); card.append(title)
    card.append(element('p', skill.description), element('code', skill.path, 'skill-path'))
    if (skill.manualOnly) card.append(element('p', '仅手动调用：/skill:' + skill.name, 'skill-manual'))
    const scopeLabel = element('label', '适用范围')
    const scope = element('select'); scope.setAttribute('aria-label', skill.name + ' 适用范围')
    for (const [id, text] of [['all', '所有应用'], ['selected', '指定应用']]) {
      const option = element('option', text); option.value = id; scope.append(option)
    }
    scope.value = rule.apps === null ? 'all' : 'selected'
    scopeLabel.append(scope); card.append(scopeLabel)
    const choices = element('div', undefined, 'skill-apps'); card.append(choices)
    function renderApps() {
      choices.replaceChildren(); choices.hidden = rule.apps === null
      if (rule.apps === null) return
      const known = new Set(apps.map(app => app.id))
      const candidates = [...apps, ...rule.apps.filter(id => !known.has(id)).map(id => ({ id, name: id + '（当前不可用）' }))]
      for (const app of candidates) {
        const label = element('label', undefined, 'checkbox'), checkbox = element('input')
        checkbox.type = 'checkbox'; checkbox.checked = rule.apps.includes(app.id)
        checkbox.setAttribute('aria-label', skill.name + '：' + app.name)
        checkbox.onchange = () => {
          rule.apps = checkbox.checked ? [...new Set([...rule.apps, app.id])] : rule.apps.filter(id => id !== app.id)
          update()
        }
        label.append(checkbox, document.createTextNode(app.name)); choices.append(label)
      }
      choices.append(element('p', '至少选择一个应用。'))
    }
    scope.onchange = () => { rule.apps = scope.value === 'all' ? null : []; update(); renderApps() }
    renderApps()
    return card
  }
  function clear(message) {
    $('skills-list').replaceChildren(); $('skills-diagnostics').replaceChildren(); $('skills-status').textContent = message
  }
  async function refresh() {
    const current = ++generation, directory = $('skills-directory').value.trim()
    clear(directory ? '正在读取技能目录…' : '未指定目录，技能加载已关闭。')
    if (!directory) return
    $('skills-refresh').disabled = true
    try {
      const catalog = await request({ directory })
      if (current !== generation) return
      $('skills-status').textContent = catalog.skills.length ? `发现 ${catalog.skills.length} 个技能；设置保存后从下一轮生效。` : '未发现可加载的技能，请检查目录和下方提示。'
      $('skills-list').replaceChildren(...catalog.skills.map(renderSkill))
      $('skills-diagnostics').replaceChildren(...catalog.diagnostics.map(diagnostic =>
        element('p', `${diagnostic.path}：${diagnostic.message}`, 'skill-diagnostic')))
    } catch (error) {
      if (current === generation) clear('读取失败：' + error.message)
    } finally { if (current === generation) $('skills-refresh').disabled = false }
  }
  $('skills-refresh').onclick = refresh
  $('skills-directory').oninput = () => {
    generation++; $('skills-refresh').disabled = false
    clear('目录已修改，点击“读取 / 刷新”查看技能。')
  }
  return {
    async open(config = { directory: '', rules: [] }, applications = []) {
      generation++; apps = applications; rules = new Map((config.rules || []).map(rule => [rule.path, { ...rule, apps: rule.apps === null ? null : [...rule.apps] }]))
      $('skills-directory').value = config.directory || ''; $('skills-refresh').disabled = false
      await refresh()
    },
    value() {
      const result = value()
      if (result.rules.some(rule => rule.apps !== null && rule.apps.length === 0)) throw Error('请为限定应用的技能至少选择一个应用')
      return result
    },
    close() { generation++; $('skills-refresh').disabled = false },
  }
}
