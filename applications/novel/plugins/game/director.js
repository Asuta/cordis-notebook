import { commandNames, newCommand, syncLegacy, passes } from './model.js'
import { previewState, initialValues } from './engine.js'
import { createStage } from './stage.js'
import { effectsInspector } from './effects-inspector.js'
import { weatherNames, dialogueModes } from './effects.js'
import { el, button, input, area, select, field, heading, uid } from './ui.js'

export function director(p, view, update, play, assetUrl, choiceEditor) {
  const s = p.scenes.find(s => s.id === view.sceneId) || p.scenes[0]; view.sceneId = s.id
  if (!s.commands.some(c => c.id === view.commandId)) view.commandId = (s.commands.find(c => c.type === 'say') || s.commands[0])?.id
  const c = s.commands.find(c => c.id === view.commandId), root = el('div', 'novel-director'), main = el('div', 'novel-story-main')
  const live = el('aside', 'novel-live'), stage = createStage(p, assetUrl)
  const previewChoices = el('div', 'novel-player-choices novel-preview-choices'); stage.root.append(previewChoices)
  let previewPlaying = false, previewNonce = 0
  let scrollFrame
  view.disposePreview = () => { window.cancelAnimationFrame(scrollFrame); stage.dispose() }
  const options = (items, label = '无') => [{ value: '', label }, ...items.map(x => ({ value: x.id, label: x.name || x.title }))]
  const images = options(p.assets.filter(a => a.kind === 'image')), audios = options(p.assets.filter(a => a.kind === 'audio'))
  const cast = options(p.cast, '旁白 / 无'), scenes = options(p.scenes, '选择目标场景')
  const mutate = (fn, rerender = false) => update(project => { const scene = project.scenes.find(x => x.id === s.id); fn(scene, project); syncLegacy(scene) }, rerender)
  const patch = (key, value, rerender = false) => mutate(scene => { const command = scene.commands.find(x => x.id === view.commandId); if (command) command[key] = value }, rerender)
  const numeric = (label, key, min, max, step = 1) => {
    const node = input(c[key], value => { const number = Number(value); if (Number.isFinite(number)) patch(key, Math.max(min, Math.min(max, number))) })
    node.type = 'number'; node.min = min; node.max = max; node.step = step
    return field(label, node)
  }
  main.append(el('div', 'novel-story-header', el('div', '', el('span', 'novel-eyebrow', 'DIRECTOR / 演出编排'), el('h2', '', s.title)), button('▶ 从选中指令试玩', () => play(s.id, view.commandId), 'novel-accent')))
  main.append(field('场景标题', input(s.title, value => mutate(scene => { scene.title = value || '未命名场景' }))))
  const addBar = el('div', 'novel-command-add'), addType = select('say', Object.entries(commandNames).map(([value, label]) => ({ value, label })), () => {})
  addType.setAttribute('aria-label', '新指令类型')
  addBar.append(addType, button('＋ 插入指令', () => mutate(scene => { const command = newCommand(addType.value, p); const at = scene.commands.findIndex(x => x.id === view.commandId); scene.commands.splice(at + 1, 0, command); view.commandId = command.id }, true), 'novel-primary'))
  main.append(addBar)
  const list = el('div', 'novel-command-list'); list.setAttribute('aria-label', '演出指令列表')
  const selectCommand = id => { view.commandId = id; view.commandScroll = { sceneId: s.id, top: list.scrollTop }; update(() => {}, true, false) }
  list.addEventListener('scroll', () => { view.commandScroll = { sceneId: s.id, top: list.scrollTop } })
  const summaries = new Map()
  const summary = command => {
    if (command.type === 'say') return (command.mode && command.mode !== 'dialogue' ? dialogueModes[command.mode] + ' · ' : '') + (p.cast.find(x => x.id === command.speakerId)?.name || '旁白') + '：' + (command.text || '……')
    if (command.type === 'camera') return '偏移 ' + command.x + '% / ' + command.y + '% · 缩放 ' + command.scale + ' · ' + command.duration + ' ms'
    if (command.type === 'shake') return '强度 ' + command.strength + '% · ' + command.duration + ' ms'
    if (command.type === 'weather') return weatherNames[command.effect] + ' · 密度 ' + Math.round(command.intensity * 100) + '%'
    if (command.type === 'filter') return '亮度 ' + command.brightness + ' · 饱和 ' + command.saturation + ' · 黑白 ' + command.grayscale + ' · 模糊 ' + command.blur
    if (command.type === 'animate') return (command.animationId ? p.animations?.find(a => a.id === command.animationId)?.name || '缺失动画' : '停止动画') + ' → ' + ({ background: '背景', stage: '整个场景', character: p.cast.find(x => x.id === command.characterId)?.name || '未选角色' }[command.target])
    if (command.type === 'choice') return s.choices.length + ' 个选项'
    if (command.type === 'jump') return p.scenes.find(x => x.id === command.targetId)?.title || '未连接'
    if (command.type === 'wait') return command.duration + ' ms'
    if (command.type === 'set') return (p.variables.find(v => v.id === command.variableId)?.name || '未设置变量') + ' ' + command.op + ' ' + command.value
    return p.assets.find(x => x.id === command.assetId)?.name || p.cast.find(x => x.id === command.characterId)?.name || '无素材'
  }
  function move(id, delta) { mutate(scene => { const at = scene.commands.findIndex(x => x.id === id), to = Math.max(0, Math.min(scene.commands.length - 1, at + delta)); const [item] = scene.commands.splice(at, 1); scene.commands.splice(to, 0, item) }, true) }
  for (const [index, command] of s.commands.entries()) {
    const row = el('div', 'novel-command-row' + (command.id === c?.id ? ' selected' : '')); row.dataset.commandId = command.id; row.draggable = true
    const detail = el('span', 'novel-command-summary', summary(command)); summaries.set(command.id, detail)
    row.append(button(String(index + 1).padStart(2, '0') + '  ' + commandNames[command.type], () => selectCommand(command.id), 'novel-command-select'), detail, el('div', 'novel-command-order', button('↑', () => move(command.id, -1), 'novel-icon'), button('↓', () => move(command.id, 1), 'novel-icon'), button('×', () => mutate(scene => { scene.commands = scene.commands.filter(x => x.id !== command.id) }, true), 'novel-icon danger')))
    row.addEventListener('click', event => { if (!event.target.closest('button')) selectCommand(command.id) })
    row.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', command.id))
    row.addEventListener('dragover', event => event.preventDefault())
    row.addEventListener('drop', event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); mutate(scene => { const at = scene.commands.findIndex(x => x.id === id), to = scene.commands.findIndex(x => x.id === command.id); if (at >= 0 && to >= 0) { const [item] = scene.commands.splice(at, 1); scene.commands.splice(to, 0, item) } }, true) })
    list.append(row)
  }
  main.append(list)
  const branch = el('details', 'novel-panel novel-branch-editor', el('summary', '', '分支选项 · ' + s.choices.length + ' 个选项'), el('p', 'novel-preview-note', '执行到「分支选择」指令时出现'))
  for (const choice of s.choices) branch.append(choiceEditor(p, s, choice, update))
  branch.append(button('＋ 添加选项', () => mutate(scene => scene.choices.push({ id: uid(), text: '新的选择', targetId: '', condition: null, effects: [] }), true), 'novel-secondary'))
  const ending = el('input'); ending.type = 'checkbox'; ending.checked = s.ending; ending.addEventListener('change', () => mutate(scene => { scene.ending = ending.checked }, true))
  branch.append(field('指令结束后标记为结局', ending), button('设为作品起点', () => update(project => { project.startSceneId = s.id }, true), 'novel-inline-action'))
  branch.append(button('删除此场景', () => { if (p.scenes.length === 1) return alert('至少保留一个场景'); if (confirm('删除场景？指向它的连接会标记为无效。')) update(project => { project.scenes = project.scenes.filter(x => x.id !== s.id); if (project.startSceneId === s.id) project.startSceneId = project.scenes[0].id; view.sceneId = project.scenes[0].id }, true) }, 'novel-danger-button'))
  main.append(branch)
  const playPreview = button('▶ 播放演出', () => { previewPlaying = !previewPlaying; previewNonce++; playPreview.textContent = previewPlaying ? '停止演出' : '▶ 播放演出'; refresh() }, 'novel-secondary')
  live.append(heading('画面预览', '16:9 · 与播放器共用渲染'), stage.root, el('div', 'novel-preview-actions', playPreview), el('p', 'novel-preview-note', '当前场景内重建演出；播放演出可查看天气、震动和动画，不写入游玩进度。人物登场 / 移动指令支持拖动立绘。'))
  const inspector = el('section', 'novel-command-inspector', heading('指令属性', c ? commandNames[c.type] : '选择或插入一条指令'))
  if (c) {
    if (c.type === 'say') {
      const dialogue = area(c.text, value => patch('text', value), '输入旁白或对白…'); dialogue.disabled = !!c.segments
      inspector.append(field('说话人', select(c.speakerId, cast, value => patch('speakerId', value))), field('对白', dialogue, c.segments ? '已开启分段样式，请在下方编辑各段文字。' : ''))
      inspector.append(field('对白语音', select(c.voiceId || '', audios, value => patch('voiceId', value)), '动态模型根据语音音量驱动口型；无语音时随逐字显示开合。'))
    }
    if (['camera', 'shake', 'weather', 'filter', 'animate', 'say'].includes(c.type)) inspector.append(effectsInspector({ p, c, patch, mutate, openLibrary: () => { view.section = 'animations'; update(() => {}, true, false) } }))
    if (['background', 'music', 'sound'].includes(c.type)) inspector.append(field('素材', select(c.assetId, c.type === 'background' ? images : audios, value => patch('assetId', value))))
    if (['show', 'hide', 'transform', 'model'].includes(c.type)) inspector.append(field('角色', select(c.characterId, cast, value => patch('characterId', value, true))))
    if (c.type === 'model') {
      const mid = p.cast.find(x => x.id === c.characterId)?.modelId, summary = p.models?.find(x => x.id === mid)
      const controls = el('div'); inspector.append(controls)
      if (!summary) controls.append(el('p', 'rig-warning', '请先在角色设定中关联动态模型，并在此指令之前安排人物登场。'))
      else {
        let active = true; const previousDispose = view.disposePreview; view.disposePreview = () => { active = false; previousDispose?.() }
        void fetch('/api/novel/projects/' + p.id + '/models/' + mid + '?revision=' + summary.revision).then(r => { if (!r.ok) throw Error('模型读取失败'); return r.json() }).then(m => {
          if (!active) return
          controls.append(field('动态表情', select(c.expressionId, options(m.expressions, '默认表情'), value => patch('expressionId', value))), field('动作', select(c.motionId, options(m.motions, '无动作'), value => patch('motionId', value))))
          const idle = el('input'); idle.type = 'checkbox'; idle.checked = c.idle; idle.addEventListener('change', () => patch('idle', idle.checked)); controls.append(field('呼吸与自动眨眼', idle))
          for (const def of m.rig.parameters) { const enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = Object.hasOwn(c.parameters, def.id); enabled.addEventListener('change', () => { const parameters = { ...c.parameters }; if (enabled.checked) parameters[def.id] = def.default; else delete parameters[def.id]; patch('parameters', parameters, true) }); controls.append(field('覆盖 ' + def.label, enabled)); if (enabled.checked) { const range = input(c.parameters[def.id], value => patch('parameters', { ...c.parameters, [def.id]: Number(value) })); range.type = 'range'; range.min = def.min; range.max = def.max; range.step = def.step || .01; controls.append(range) } }
        }).catch(e => { if (active) controls.textContent = e.message })
      }
    }
    if (c.type === 'show') inspector.append(field('表情', select(c.expressionId, options(p.cast.find(x => x.id === c.characterId)?.expressions || [], '默认立绘'), value => patch('expressionId', value))))
    if (['show', 'transform'].includes(c.type)) inspector.append(el('div', 'novel-property-grid', numeric('水平位置 %', 'x', -50, 150), numeric('垂直位置 %', 'y', -100, 100), numeric('缩放', 'scale', .1, 3, .05), numeric('透明度', 'opacity', 0, 1, .05)))
    if (['background', 'music', 'show', 'hide', 'transform', 'wait'].includes(c.type)) inspector.append(numeric(c.type === 'wait' ? '等待时长 ms' : '过渡时长 ms', 'duration', 0, 30000, 100))
    if (['music', 'sound'].includes(c.type)) inspector.append(numeric('音量', 'volume', 0, 1, .05))
    if (c.type === 'jump') inspector.append(field('目标场景', select(c.targetId, scenes, value => patch('targetId', value))))
    if (c.type === 'set') {
      const def = p.variables.find(v => v.id === c.variableId)
      inspector.append(field('变量', select(c.variableId, options(p.variables), value => mutate(scene => { const command = scene.commands.find(x => x.id === c.id), v = p.variables.find(v => v.id === value); command.variableId = value; command.value = v?.initial ?? 0; command.op = 'set' }, true))), field('操作', select(c.op, (def?.kind === 'boolean' ? ['set'] : ['set', 'add']).map(value => ({ value, label: value === 'set' ? '设为' : '增加' })), value => patch('op', value))))
      if (def?.kind === 'boolean') inspector.append(field('值', select(String(c.value), [{ value: 'true', label: '是' }, { value: 'false', label: '否' }], value => patch('value', value === 'true'))))
      else inspector.append(numeric('值', 'value', -9999, 9999))
    }
    if (c.type === 'choice') inspector.append(el('p', 'novel-preview-note', '在左侧分支面板编辑选项、条件和变量效果。选择后跳转到目标场景。'))
    const condition = c.condition
    inspector.append(field('执行条件', select(condition?.variableId || '', options(p.variables, '始终执行'), value => patch('condition', value ? { variableId: value, op: 'eq', value: p.variables.find(v => v.id === value)?.initial ?? 0 } : null, true))))
    if (condition) {
      const v = p.variables.find(v => v.id === condition.variableId)
      inspector.append(field('比较', select(condition.op, (v?.kind === 'boolean' ? ['eq', 'neq'] : ['eq', 'neq', 'gte', 'lte']).map(value => ({ value, label: { eq: '等于', neq: '不等于', gte: '大于等于', lte: '小于等于' }[value] })), value => patch('condition', { ...condition, op: value }))))
      const control = v?.kind === 'boolean' ? select(String(condition.value), [{ value: 'true', label: '是' }, { value: 'false', label: '否' }], value => patch('condition', { ...c.condition, value: value === 'true' })) : input(condition.value, value => patch('condition', { ...c.condition, value: Number(value) || 0 }))
      inspector.append(field('条件值', control))
    }
  }
  live.append(inspector)
  const tests = el('details', 'novel-test-values', el('summary', '', '变量检查与测试值'))
  view.testValues ||= {}
  for (const v of p.variables) {
    const control = v.kind === 'boolean' ? select(String(view.testValues[v.id] ?? v.initial), [{ value: 'true', label: '是' }, { value: 'false', label: '否' }], value => { view.testValues[v.id] = value === 'true'; refresh() }) : input(view.testValues[v.id] ?? v.initial, value => { view.testValues[v.id] = Number(value) || 0; refresh() })
    tests.append(field(v.name, control))
  }
  const values = el('div', 'novel-preview-values'); tests.append(values); live.append(tests)
  function refresh() {
    const scene = p.scenes.find(x => x.id === view.sceneId)
    if (!scene) return
    const state = previewState(p, scene.id, view.commandId, { ...initialValues(p), ...view.testValues })
    if (state.stage.shake) state.stage.shake.nonce += previewNonce
    state.stage.camera.nonce = (state.stage.camera.nonce || 0) + previewNonce
    state.stage.filter.nonce = (state.stage.filter.nonce || 0) + previewNonce
    for (const track of Object.values(state.stage.animations)) track.nonce += previewNonce
    stage.render(state, { instant: !previewPlaying, showLastSay: true })
    previewChoices.replaceChildren()
    if (state.current?.type === 'choice') {
      for (const choice of scene.choices.filter(c => passes(c.condition, state.values))) previewChoices.append(el('div', 'novel-player-choice', choice.text))
      if (!previewChoices.childNodes.length) previewChoices.append(el('div', 'novel-preview-note', '当前测试变量下没有可用选项'))
    }
    values.textContent = p.variables.map(v => v.name + ': ' + state.values[v.id]).join(' · ')
    for (const command of scene.commands) { const node = summaries.get(command.id); if (node) node.textContent = summary(command) }
  }
  stage.root.addEventListener('pointerdown', event => {
    const actor = event.target.closest('.novel-actor'), command = s.commands.find(x => x.id === view.commandId)
    if (!actor || !['show', 'transform'].includes(command?.type) || command.characterId !== actor.dataset.characterId) return
    event.preventDefault(); actor.setPointerCapture(event.pointerId)
    const rect = stage.root.getBoundingClientRect(), began = { x: event.clientX, y: event.clientY, left: command.x, bottom: command.y }
    let x = command.x, y = command.y
    const move = e => { x = Math.max(-50, Math.min(150, began.left + (e.clientX - began.x) / rect.width * 100)); y = Math.max(-100, Math.min(100, began.bottom - (e.clientY - began.y) / rect.height * 100)); actor.style.left = x + '%'; actor.style.bottom = y + '%' }
    const done = () => { actor.removeEventListener('pointermove', move); actor.removeEventListener('pointerup', done); actor.removeEventListener('pointercancel', done); mutate(scene => Object.assign(scene.commands.find(x => x.id === command.id), { x: Math.round(x), y: Math.round(y) }), true) }
    actor.addEventListener('pointermove', move); actor.addEventListener('pointerup', done); actor.addEventListener('pointercancel', done)
  })
  view.refreshPreview = refresh; refresh(); root.append(main, live)
  scrollFrame = window.requestAnimationFrame(() => {
    if (!root.isConnected) return
    if (view.commandScroll?.sceneId === s.id) list.scrollTop = view.commandScroll.top
    const selected = list.querySelector('.selected')
    if (selected) {
      const row = selected.getBoundingClientRect(), box = list.getBoundingClientRect()
      if (row.top < box.top) list.scrollTop -= box.top - row.top
      else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom
    }
  })
  return root
}
