import { diagnose } from './model.js'
import { el, button, input, area, select, field, heading, uid } from './ui.js'

const none = label => [{ value: '', label }]
const named = items => items.map(item => ({ value: item.id, label: item.name || item.title }))
const sceneOptions = p => [...none('选择目标场景'), ...named(p.scenes)]
const imageOptions = p => [...none('无'), ...p.assets.filter(a => a.kind === 'image').map(a => ({ value: a.id, label: a.name }))]
const audioOptions = p => [...none('无'), ...p.assets.filter(a => a.kind === 'audio').map(a => ({ value: a.id, label: a.name }))]
const castOptions = p => [...none('旁白 / 无'), ...named(p.cast)]
const variableOptions = p => [...none('不设置'), ...named(p.variables)]
const numberInput = (value, action) => { const node = input(String(value ?? 0), v => action(Number(v) || 0)); node.type = 'number'; node.step = '1'; return node }
const checkbox = (checked, action) => { const node = el('input'); node.type = 'checkbox'; node.checked = !!checked; node.addEventListener('change', () => action(node.checked)); return node }
const group = (...items) => el('div', 'novel-control-row', ...items)
const panel = (...children) => el('section', 'novel-panel', ...children)

export function renderEditor({ project: p, view, update, openScene, play, uploadAsset, assetUrl }) {
  const shell = el('div', 'novel-editor')
  const nav = el('aside', 'novel-editor-nav')
  nav.append(el('div', 'novel-side-title', '创作目录'))
  for (const [section, label] of [['story','剧本与分支'],['flow','剧情流向'],['cast','角色设定'],['variables','变量与好感度'],['assets','素材库'],['settings','作品设置']]) nav.append(button(label, () => { view.section = section; update(() => {}, true, false) }, 'novel-nav-item ' + (view.section === section ? 'active' : '')))
  nav.append(el('div', 'novel-side-title novel-side-separator', '场景 · ' + p.scenes.length))
  for (const s of p.scenes) nav.append(button((s.ending ? '◆ ' : '◇ ') + s.title, () => openScene(s.id), 'novel-scene-link ' + (s.id === view.sceneId && view.section === 'story' ? 'active' : '')))
  nav.append(button('＋ 新建场景', () => { const id = uid(); view.sceneId = id; view.section = 'story'; update(project => project.scenes.push({ id, title: '新场景', backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', ending: false, lines: [{ id: uid(), speakerId: '', text: '' }], choices: [] }), true) }, 'novel-secondary'))
  const content = el('div', 'novel-editor-content')
  if (view.section === 'flow') content.append(flow(p, openScene, play))
  else if (view.section === 'cast') content.append(cast(p, update, assetUrl))
  else if (view.section === 'variables') content.append(variables(p, update))
  else if (view.section === 'assets') content.append(assets(p, uploadAsset, assetUrl))
  else if (view.section === 'settings') content.append(settings(p, update))
  else content.append(story(p, view, update, play))
  shell.append(nav, content); return shell
}

function story(p, view, update, play) {
  const s = p.scenes.find(s => s.id === view.sceneId) || p.scenes[0]
  view.sceneId = s.id
  const main = el('div', 'novel-story-main'), inspector = el('aside', 'novel-inspector')
  main.append(el('div', 'novel-story-header', el('div', '', el('span', 'novel-eyebrow', 'SCENE / 场景'), el('h2', '', s.title)), button('▶ 从此处试玩', () => play(s.id), 'novel-accent')))
  main.append(field('场景标题', input(s.title, value => update(project => { project.scenes.find(x => x.id === s.id).title = value || '未命名场景' }))))
  const script = panel(heading('对白脚本', s.lines.length + ' 条台词'))
  for (let i = 0; i < s.lines.length; i++) {
    const line = s.lines[i], row = el('div', 'novel-line-row')
    const speaker = select(line.speakerId, castOptions(p), value => update(project => { project.scenes.find(x => x.id === s.id).lines.find(x => x.id === line.id).speakerId = value }))
    const text = area(line.text, value => update(project => { project.scenes.find(x => x.id === s.id).lines.find(x => x.id === line.id).text = value }), '输入旁白或对白…')
    text.rows = 2
    row.append(el('span', 'novel-line-number', String(i + 1).padStart(2, '0')), el('div', 'novel-line-edit', speaker, text), el('div', 'novel-line-actions',
      button('↑', () => update(project => { const a = project.scenes.find(x => x.id === s.id).lines; if (i) [a[i-1],a[i]] = [a[i],a[i-1]] }, true), 'novel-icon'),
      button('↓', () => update(project => { const a = project.scenes.find(x => x.id === s.id).lines; if (i < a.length - 1) [a[i+1],a[i]] = [a[i],a[i+1]] }, true), 'novel-icon'),
      button('×', () => update(project => { const a = project.scenes.find(x => x.id === s.id).lines; a.splice(i, 1) }, true), 'novel-icon danger')))
    script.append(row)
  }
  script.append(button('＋ 添加台词', () => update(project => project.scenes.find(x => x.id === s.id).lines.push({ id: uid(), speakerId: '', text: '' }), true), 'novel-secondary'))
  main.append(script)
  const branching = panel(heading('分支选项', s.ending ? '结局场景不显示选项' : '玩家在台词结束后选择'))
  for (const c of s.choices) branching.append(choiceEditor(p, s, c, update))
  branching.append(button('＋ 添加选项', () => update(project => project.scenes.find(x => x.id === s.id).choices.push({ id: uid(), text: '新的选择', targetId: '', condition: null, effects: [] }), true), 'novel-secondary'))
  main.append(branching)
  inspector.append(heading('场景设置'))
  inspector.append(field('背景画面', select(s.backgroundId, imageOptions(p), value => update(project => { project.scenes.find(x => x.id === s.id).backgroundId = value }))))
  inspector.append(field('循环音乐', select(s.musicId, audioOptions(p), value => update(project => { project.scenes.find(x => x.id === s.id).musicId = value }))))
  inspector.append(field('左侧立绘', select(s.leftCharacterId, castOptions(p), value => update(project => { project.scenes.find(x => x.id === s.id).leftCharacterId = value }))))
  inspector.append(field('右侧立绘', select(s.rightCharacterId, castOptions(p), value => update(project => { project.scenes.find(x => x.id === s.id).rightCharacterId = value }))))
  inspector.append(field('标记为结局', checkbox(s.ending, value => update(project => { project.scenes.find(x => x.id === s.id).ending = value }, true))))
  inspector.append(field('设为作品起点', checkbox(p.startSceneId === s.id, checked => { if (checked) update(project => { project.startSceneId = s.id }, true) })))
  inspector.append(button('删除此场景', () => {
    if (p.scenes.length === 1) return alert('至少保留一个场景')
    if (!confirm('删除场景后，指向它的选项会被标记为无效。确定删除？')) return
    update(project => { project.scenes = project.scenes.filter(x => x.id !== s.id); if (project.startSceneId === s.id) project.startSceneId = project.scenes[0].id; view.sceneId = project.scenes[0].id }, true)
  }, 'novel-danger-button'))
  return el('div', 'novel-story-grid', main, inspector)
}

function valueControl(def, value, action) { return def?.kind === 'boolean' ? checkbox(value, action) : numberInput(value, action) }
function choiceEditor(p, s, c, update) {
  const card = el('div', 'novel-choice-card')
  const edit = (fn, rerender = false) => update(project => fn(project.scenes.find(x => x.id === s.id).choices.find(x => x.id === c.id)), rerender)
  card.append(el('div', 'novel-choice-top', el('span', 'novel-eyebrow', 'CHOICE / 选择'), button('移除', () => update(project => { const a = project.scenes.find(x => x.id === s.id).choices; a.splice(a.findIndex(x => x.id === c.id), 1) }, true), 'novel-text-danger')))
  card.append(field('选项文字', input(c.text, value => edit(choice => { choice.text = value || '新的选择' }))))
  card.append(field('前往场景', select(c.targetId, sceneOptions(p), value => edit(choice => { choice.targetId = value }))))
  const conditionId = c.condition?.variableId || ''
  card.append(field('显示条件', select(conditionId, variableOptions(p), value => edit(choice => { const def = p.variables.find(v => v.id === value); choice.condition = def ? { variableId: value, op: def.kind === 'boolean' ? 'eq' : 'gte', value: def.kind === 'boolean' ? true : 1 } : null }, true)), '条件不满足时，玩家看不到这个选项。'))
  if (c.condition) {
    const def = p.variables.find(v => v.id === conditionId)
    card.append(group(select(c.condition.op, def?.kind === 'boolean' ? [{value:'eq',label:'等于'},{value:'neq',label:'不等于'}] : [{value:'eq',label:'等于'},{value:'neq',label:'不等于'},{value:'gte',label:'大于等于'},{value:'lte',label:'小于等于'}], value => edit(choice => { choice.condition.op = value })), valueControl(def, c.condition.value, value => edit(choice => { choice.condition.value = value }))))
  }
  card.append(el('div', 'novel-small-heading', '选择后的变量变化'))
  for (let i = 0; i < c.effects.length; i++) {
    const e = c.effects[i], def = p.variables.find(v => v.id === e.variableId)
    card.append(group(select(e.variableId, named(p.variables), value => edit(choice => { const next = p.variables.find(v => v.id === value); choice.effects[i].variableId = value; choice.effects[i].op = next?.kind === 'boolean' ? 'set' : 'add'; choice.effects[i].value = next?.kind === 'boolean' ? true : 1 }, true)),
      select(e.op, def?.kind === 'boolean' ? [{value:'set',label:'设为'}] : [{value:'add',label:'增加'},{value:'set',label:'设为'}], value => edit(choice => { choice.effects[i].op = value })),
      valueControl(def, e.value, value => edit(choice => { choice.effects[i].value = value })),
      button('×', () => edit(choice => { choice.effects.splice(i, 1) }, true), 'novel-icon danger')))
  }
  card.append(button('＋ 添加数值变化', () => { if (!p.variables.length) return alert('请先在「变量与好感度」中创建变量'); edit(choice => { const v = p.variables[0]; choice.effects.push({ variableId: v.id, op: v.kind === 'boolean' ? 'set' : 'add', value: v.kind === 'boolean' ? true : 1 }) }, true) }, 'novel-inline-action'))
  return card
}

function flow(p, openScene, play) {
  const box = el('div', 'novel-flow')
  box.append(heading('剧情流向', '从起点到结局的场景关系'))
  const issues = diagnose(p)
  box.append(el('div', 'novel-diagnostics ' + (issues.length ? 'has-issues' : ''), issues.length ? issues.map(item => el('div', '', '⚠ ' + item)) : '✓ 所有场景和素材引用通过检查'))
  const grid = el('div', 'novel-flow-grid')
  for (const s of p.scenes) {
    const card = el('div', 'novel-flow-card', el('span', 'novel-eyebrow', s.id === p.startSceneId ? 'START / 起点' : s.ending ? 'ENDING / 结局' : 'SCENE / 场景'), el('h3', '', s.title), el('p', '', s.lines.length + ' 条台词 · ' + s.choices.length + ' 个选项'))
    for (const c of s.choices) card.append(el('div', 'novel-flow-edge', c.text + '  →  ' + (p.scenes.find(x => x.id === c.targetId)?.title || '未连接')))
    card.append(group(button('编辑', () => openScene(s.id), 'novel-secondary'), button('试玩', () => play(s.id), 'novel-inline-action')))
    grid.append(card)
  }
  box.append(grid); return box
}

function cast(p, update, assetUrl) {
  const box = el('div', 'novel-collection', heading('角色设定', '角色可以在场景左右两侧登场'))
  for (const c of p.cast) {
    const card = panel(el('div', 'novel-cast-preview', c.portraitId ? el('img') : el('span', '', '无立绘')))
    if (c.portraitId) card.querySelector('img').src = assetUrl(c.portraitId)
    card.append(field('角色姓名', input(c.name, value => update(project => { project.cast.find(x => x.id === c.id).name = value || '未命名角色' }))))
    card.append(field('角色立绘', select(c.portraitId, imageOptions(p), value => update(project => { project.cast.find(x => x.id === c.id).portraitId = value }, true))))
    card.append(field('名字颜色', input(c.color, value => update(project => { project.cast.find(x => x.id === c.id).color = value }))))
    card.append(button('移除角色', () => update(project => { project.cast = project.cast.filter(x => x.id !== c.id) }, true), 'novel-text-danger'))
    box.append(card)
  }
  box.append(button('＋ 添加角色', () => update(project => project.cast.push({ id: uid(), name: '新角色', portraitId: '', color: '#f5d1ac' }), true), 'novel-secondary'))
  return box
}

function variables(p, update) {
  const box = el('div', 'novel-collection', heading('变量与好感度', '用变量控制选项显示及选择后的变化'))
  for (const v of p.variables) {
    const card = panel(el('span', 'novel-eyebrow', v.kind === 'affinity' ? 'AFFINITY / 好感度' : 'VARIABLE / 变量'))
    card.append(field('名称', input(v.name, value => update(project => { project.variables.find(x => x.id === v.id).name = value || '未命名变量' }))))
    card.append(field('类型', select(v.kind, [{value:'number',label:'数字'},{value:'affinity',label:'好感度'},{value:'boolean',label:'是 / 否'}], value => update(project => { const item = project.variables.find(x => x.id === v.id); item.kind = value; item.initial = value === 'boolean' ? false : 0 }, true))))
    card.append(field('初始值', valueControl(v, v.initial, value => update(project => { project.variables.find(x => x.id === v.id).initial = value }))))
    card.append(button('移除变量', () => update(project => { project.variables = project.variables.filter(x => x.id !== v.id) }, true), 'novel-text-danger'))
    box.append(card)
  }
  box.append(button('＋ 添加变量', () => update(project => project.variables.push({ id: uid(), name: '新变量', kind: 'number', initial: 0 }), true), 'novel-secondary'))
  return box
}

function assets(p, uploadAsset, assetUrl) {
  const box = el('div', 'novel-assets', heading('素材库', 'PNG / JPEG / WebP 图片，WAV / MP3 / OGG 音乐；单文件最大 8 MB'))
  const picker = el('input'); picker.type = 'file'; picker.accept = 'image/png,image/jpeg,image/webp,audio/wav,audio/mpeg,audio/ogg'; picker.multiple = true
  picker.addEventListener('change', async () => { for (const file of picker.files) await uploadAsset(file); picker.value = '' })
  box.append(field('添加背景、立绘或音乐', picker))
  const grid = el('div', 'novel-asset-grid')
  for (const a of p.assets) grid.append(el('div', 'novel-asset-card', a.kind === 'image' ? (() => { const img = el('img'); img.src = assetUrl(a.id); img.alt = a.name; return img })() : el('div', 'novel-audio-mark', '♫'), el('strong', '', a.name), el('small', '', a.kind === 'audio' ? '音乐' : '图片')))
  box.append(grid); return box
}

function settings(p, update) {
  const box = el('div', 'novel-collection', heading('作品设置', '作品标题和简介也会写入可导入的作品包'))
  const card = panel(field('作品标题', input(p.title, value => update(project => { project.title = value || '未命名作品' }))), field('作品简介', area(p.description, value => update(project => { project.description = value }), '写一句让读者想打开的介绍。')))
  box.append(card)
  return box
}
