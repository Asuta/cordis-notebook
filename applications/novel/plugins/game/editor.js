import { director } from './director.js'
import { graph } from './graph.js'
import { animationEditor } from './animation-editor.js'
import { modelStudio } from './live2d/studio.js'
import { meshStudio } from './mesh-avatar/studio.js'
import { diagnose, outlineTree, storyTree, descendants } from './model.js'
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

export function renderEditor({ project: p, view, update, openScene, play, uploadAsset, assetUrl, modelController, meshController, appSession, request, notify }) {
  const shell = el('div', 'novel-editor')
  const nav = el('aside', 'novel-editor-nav')
  nav.append(el('div', 'novel-side-title', '创作目录'))
  const navigate = async (section, action) => { try { await meshController?.flush(); view.section = section; action?.(); update(() => {}, true, false) } catch (e) { notify(e.message) } }
  for (const [section, label] of [['story','剧本与分支'],['flow','剧情树'],['cast','角色设定'],['mesh-models','Mesh Avatar Studio'],['models','角色工作室'],['variables','变量与好感度'],['assets','素材库'],['animations','关键帧动画'],['settings','作品设置']]) nav.append(button(label, () => navigate(section), 'novel-nav-item ' + (view.section === section ? 'active' : '')))
  const tree = outlineTree(p)
  nav.append(el('div', 'novel-side-title novel-side-separator', '剧情树 · ' + p.scenes.length))
  for (const item of tree.items) {
    const link = button((item.scene.ending ? '◆ ' : '◇ ') + item.scene.title, () => openScene(item.id), 'novel-scene-link ' + (item.id === view.sceneId && view.section === 'story' ? 'active' : ''))
    link.style.paddingLeft = 12 + Math.min(item.depth, 5) * 11 + 'px'
    nav.append(link)
  }
  for (const scene of tree.unreachable) nav.append(button('⚠ ' + scene.title, () => openScene(scene.id), 'novel-scene-link novel-unlinked ' + (scene.id === view.sceneId && view.section === 'story' ? 'active' : '')))
  nav.append(button('＋ 新建场景', () => { const id = uid(); view.sceneId = id; view.section = 'story'; update(project => project.scenes.push({ id, title: '新场景', backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', ending: false, lines: [], commands: [{ id: uid(), type: 'say', speakerId: '', text: '' }], choices: [] }), true) }, 'novel-secondary'))
  const content = el('div', 'novel-editor-content')
  if (view.section === 'flow') {
    content.append(el('div', 'novel-flow-switch', button('连线画布', () => { view.flowMode = 'graph'; update(() => {}, true, false) }, 'novel-secondary'), button('剧情树', () => { view.flowMode = 'tree'; update(() => {}, true, false) }, 'novel-secondary')))
    content.append(view.flowMode === 'tree' ? flow(p, view, openScene, play) : graph(p, view, update, openScene, play))
  }
  else if (view.section === 'cast') content.append(cast(p, update, assetUrl))
  else if (view.section === 'variables') content.append(variables(p, update))
  else if (view.section === 'assets') content.append(assets(p, uploadAsset, assetUrl))
  else if (view.section === 'animations') content.append(animationEditor(p, view, update, assetUrl))
  else if (view.section === 'models') { const studio = modelStudio({ project: p, controller: modelController, assetUrl, request, notify, update }); view.disposePreview = studio.dispose; content.append(studio.root) }
  else if (view.section === 'mesh-models') { const studio = meshStudio({ project: p, controller: meshController, request, notify, session: appSession, selectedId: view.meshModelId, selectModel: id => { view.meshModelId = id; update(() => {}, true, false) }, play: () => play(p.startSceneId) }); view.disposePreview = studio.dispose; content.append(studio.root) }
  else if (view.section === 'settings') content.append(settings(p, update))
  else content.append(story(p, view, update, play, assetUrl))
  shell.append(nav, content); return shell
}

function story(p, view, update, play, assetUrl) {
  return director(p, view, update, play, assetUrl, choiceEditor)
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

const opLabel = { eq: '=', neq: '≠', gte: '≥', lte: '≤' }
const effectLabel = { add: '+', set: '=' }
const showValue = (def, value) => def?.kind === 'boolean' ? (value ? '是' : '否') : String(value)
const sceneChars = scene => scene.lines.reduce((total, line) => total + Array.from(line.text).length, 0)

function edgeRow(choice, p) {
  const row = el('div', 'novel-tree-edge', el('span', 'novel-tree-choice', '「' + choice.text + '」'))
  const chips = []
  if (choice.condition) {
    const def = p.variables.find(v => v.id === choice.condition.variableId)
    chips.push(el('span', 'novel-tree-chip condition', (def?.name || '未知变量') + ' ' + (opLabel[choice.condition.op] || choice.condition.op) + ' ' + showValue(def, choice.condition.value)))
  }
  for (const effect of choice.effects) {
    const def = p.variables.find(v => v.id === effect.variableId)
    chips.push(el('span', 'novel-tree-chip effect', (def?.name || '未知变量') + ' ' + (effectLabel[effect.op] || effect.op) + ' ' + showValue(def, effect.value)))
  }
  if (chips.length) row.append(el('span', 'novel-tree-chips', ...chips))
  return row
}

function treeNode(node, choice, ctx, trail) {
  const { p, view, collapsed, openScene, play, anchors } = ctx
  const scene = node.scene, item = el('li', 'novel-tree-item' + (node.ref ? ' ref' : ''))
  if (choice) item.append(edgeRow(choice, p))
  if (node.ref) {
    item.append(button('↩ ' + scene.title, () => {
      for (const ancestor of trail) { ancestor.item.classList.remove('collapsed'); collapsed.delete(ancestor.id) }
      const anchor = anchors.get(node.id)
      if (!anchor) return
      anchor.scrollIntoView({ block: 'center', behavior: 'smooth' })
      anchor.classList.remove('flash'); void anchor.offsetWidth; anchor.classList.add('flash')
    }, 'novel-tree-ref'))
    return item
  }
  const kind = scene.id === p.startSceneId ? 'START / 起点' : scene.ending ? 'ENDING / 结局' : 'SCENE / 场景'
  const card = el('div', 'novel-tree-card' + (scene.id === view.sceneId ? ' current' : '') + (scene.ending ? ' ending' : ''))
  const head = el('div', 'novel-tree-head', el('span', 'novel-eyebrow', kind), el('span', 'novel-tree-seq', '#' + String(node.seq).padStart(2, '0')))
  card.append(head, el('h3', 'novel-tree-title', scene.title),
    el('div', 'novel-tree-meta', el('span', '', scene.lines.length + ' 句台词'), el('span', '', scene.choices.length + ' 个选项'), el('span', '', sceneChars(scene) + ' 字')),
    el('div', 'novel-tree-actions', button('编辑', () => openScene(scene.id), 'novel-secondary'), button('▶ 试玩', () => play(scene.id), 'novel-inline-action')))
  card.tabIndex = 0
  card.addEventListener('click', event => { if (!event.target.closest('button')) openScene(scene.id) })
  card.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); openScene(scene.id) } })
  anchors.set(scene.id, card)
  item.append(card)
  if (node.children.length) {
    const list = el('ul', 'novel-tree-children')
    for (const child of node.children) list.append(child.node ? treeNode(child.node, child.choice, ctx, [...trail, { item, id: scene.id }]) : unlinkedNode(child, ctx))
    const toggle = button('▾', () => {
      const collapsedNow = item.classList.toggle('collapsed')
      if (collapsedNow) collapsed.add(scene.id)
      else collapsed.delete(scene.id)
      toggle.textContent = collapsedNow ? '▸' : '▾'
    }, 'novel-tree-toggle')
    toggle.title = '折叠 / 展开后续场景'
    head.append(toggle)
    if (collapsed.has(scene.id)) { item.classList.add('collapsed'); toggle.textContent = '▸' }
    item.append(list, el('div', 'novel-tree-tail', '展开 ' + descendants(node) + ' 个后续场景'))
  }
  return item
}

function unlinkedNode(child, ctx) {
  const item = el('li', 'novel-tree-item')
  item.append(edgeRow(child.choice, ctx.p), el('div', 'novel-tree-card missing', el('span', 'novel-eyebrow', 'UNLINKED / 未连接'), el('strong', '', child.missing)))
  return item
}

function flow(p, view, openScene, play) {
  if (!view.collapsed) view.collapsed = new Set()
  const collapsed = view.collapsed
  const box = el('div', 'novel-flow'), { root, unreachable } = storyTree(p)
  const stat = (label, value) => el('div', 'novel-flow-stat', el('span', '', label), el('strong', '', String(value)))
  box.append(heading('剧情树', '从起点沿选项展开；↩ 表示回到已展开的场景，虚线框表示未连接的目标'))
  box.append(el('div', 'novel-flow-stats',
    stat('场景', p.scenes.length), stat('台词', p.scenes.reduce((total, scene) => total + scene.lines.length, 0)),
    stat('字数', p.scenes.reduce((total, scene) => total + sceneChars(scene), 0)), stat('结局', p.scenes.filter(scene => scene.ending).length),
    stat('起点', p.scenes.find(scene => scene.id === p.startSceneId)?.title || '未设置')))
  const issues = diagnose(p)
  box.append(el('div', 'novel-diagnostics ' + (issues.length ? 'has-issues' : ''), issues.length ? issues.map(item => el('div', '', '⚠ ' + item)) : '✓ 所有场景和素材引用通过检查'))
  const tree = el('div', 'novel-tree')
  if (root) tree.append(el('ul', 'novel-tree-list', treeNode(root, null, { p, view, collapsed, openScene, play, anchors: new Map() }, [])))
  else tree.append(el('p', 'novel-tree-empty', '还没有可用的起点场景：请先在场景设置里指定起点。'))
  box.append(tree)
  if (unreachable.length) {
    const warning = el('section', 'novel-unreachable', el('h3', '', '无法从起点到达 · ' + unreachable.length), el('p', '', '这些场景不会出现在剧情树里：检查是否有选项漏设目标，或把它们设为起点。'))
    const list = el('div', 'novel-unreachable-list')
    for (const scene of unreachable) list.append(button((scene.ending ? '◆ ' : '◇ ') + scene.title, () => openScene(scene.id), 'novel-secondary'))
    warning.append(list); box.append(warning)
  }
  return box
}

function cast(p, update, assetUrl) {
  const box = el('div', 'novel-collection', heading('角色设定', '角色可以在场景左右两侧登场'))
  for (const c of p.cast) {
    const card = panel(el('div', 'novel-cast-preview', c.portraitId ? el('img') : el('span', '', '无立绘')))
    if (c.portraitId) card.querySelector('img').src = assetUrl(c.portraitId)
    card.append(field('角色姓名', input(c.name, value => update(project => { project.cast.find(x => x.id === c.id).name = value || '未命名角色' }))))
    card.append(field('角色立绘', select(c.portraitId, imageOptions(p), value => update(project => { project.cast.find(x => x.id === c.id).portraitId = value }, true))))
    card.append(field('动态角色模型', select(c.modelId || '', [...none('使用静态立绘'), ...named(p.models || [])], value => update(project => { project.cast.find(x => x.id === c.id).modelId = value }, true)), '在角色工作室制作；登场后可插入「动态角色演出」控制表情、动作和参数。'))
    card.append(field('名字颜色', input(c.color, value => update(project => { project.cast.find(x => x.id === c.id).color = value }))))
    card.append(button('移除角色', () => update(project => { project.cast = project.cast.filter(x => x.id !== c.id) }, true), 'novel-text-danger'))
    const expressions = el('div', '', heading('表情差分'))
    for (const e of c.expressions || []) expressions.append(field('表情名称', input(e.name, value => update(project => { project.cast.find(x => x.id === c.id).expressions.find(x => x.id === e.id).name = value }))), field('表情图片', select(e.portraitId, imageOptions(p), value => update(project => { project.cast.find(x => x.id === c.id).expressions.find(x => x.id === e.id).portraitId = value }))), button('移除表情', () => update(project => { const character = project.cast.find(x => x.id === c.id); character.expressions = character.expressions.filter(x => x.id !== e.id) }, true), 'novel-icon danger'))
    expressions.append(button('＋ 添加表情', () => update(project => { const character = project.cast.find(x => x.id === c.id); (character.expressions ||= []).push({ id: uid(), name: '新表情', portraitId: '' }) }, true), 'novel-secondary'))
    card.append(expressions); box.append(card)
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
    card.append(field('保存范围', select(v.scope || 'save', [{ value: 'save', label: '随存档恢复' }, { value: 'global', label: '跨周目保留（回退和读档不重置）' }], value => update(project => { project.variables.find(x => x.id === v.id).scope = value }))))
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
