import { cameraDefaults, filterDefaults, animationOK, presentationOK } from './effects.js'
const bad = message => { throw Object.assign(Error(message), { status: 400 }) }
const idOK = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value)
const str = (value, max) => typeof value === 'string' && value.length <= max
const unique = items => items.every(item => item && typeof item === 'object') && new Set(items.map(item => item.id)).size === items.length
const numeric = kind => kind === 'number' || kind === 'affinity'

export function blankProject(title = '未命名作品', id = crypto.randomUUID()) {
  const sceneId = crypto.randomUUID()
  return { schemaVersion: 1, id, revision: 0, title, description: '', startSceneId: sceneId, variables: [], cast: [], assets: [], animations: [], scenes: [{ id: sceneId, title: '序章', backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', ending: false, lines: [{ id: crypto.randomUUID(), speakerId: '', text: '故事从这里开始。' }], choices: [] }] }
}

export function validateProject(p) {
  if (!p || ![1, 2].includes(p.schemaVersion) || !idOK(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 0 || !str(p.title, 120) || !p.title.trim() || !str(p.description, 1000) || !idOK(p.startSceneId)) bad('作品基本信息无效')
  if (!Array.isArray(p.variables) || p.variables.length > 60 || !unique(p.variables) || !Array.isArray(p.cast) || p.cast.length > 30 || !unique(p.cast) || !Array.isArray(p.scenes) || !p.scenes.length || p.scenes.length > 300 || !unique(p.scenes) || !Array.isArray(p.assets) || p.assets.length > 800 || !unique(p.assets)) bad('作品规模或标识无效')
  for (const v of p.variables) if (!idOK(v.id) || !str(v.name, 60) || !v.name.trim() || !['number','boolean','affinity'].includes(v.kind) || (numeric(v.kind) ? !Number.isFinite(v.initial) || Math.abs(v.initial) > 9999 : typeof v.initial !== 'boolean')) bad('变量定义无效')
  for (const c of p.cast) if (!idOK(c.id) || !str(c.name, 60) || !c.name.trim() || !str(c.portraitId, 80) || !str(c.color, 20)) bad('角色定义无效')
  for (const a of p.assets) if (!idOK(a.id) || !['image','audio'].includes(a.kind) || !['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg','audio/ogg'].includes(a.mime) || !str(a.name, 120) || !a.name.trim() || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > 8 * 1024 * 1024) bad('素材清单无效')
  if (p.assets.reduce((size, a) => size + a.size, 0) > 256 * 1024 * 1024) bad('作品素材总量不能超过 256 MB')
  if (p.models !== undefined && (!Array.isArray(p.models) || p.models.length > 30 || !unique(p.models) || p.models.some(m => !idOK(m.id) || !str(m.name,120) || !Number.isSafeInteger(m.revision) || m.revision < 1 || !Array.isArray(m.assetIds) || m.assetIds.some(id => !p.assets.some(a => a.id === id && a.kind === 'image'))))) bad('角色模型清单无效')
  for (const c of p.cast) if (c.modelId && !p.models?.some(m => m.id === c.modelId)) bad('角色引用的模型不存在')
  if (new TextEncoder().encode(JSON.stringify(p)).length > 1024 * 1024) bad('作品剧情数据不能超过 1 MB')
  for (const s of p.scenes) {
    if (!idOK(s.id) || !str(s.title, 120) || !s.title.trim() || !str(s.backgroundId, 80) || !str(s.musicId, 80) || !str(s.leftCharacterId, 80) || !str(s.rightCharacterId, 80) || typeof s.ending !== 'boolean' || !Array.isArray(s.lines) || s.lines.length > 200 || !unique(s.lines) || !Array.isArray(s.choices) || s.choices.length > 20 || !unique(s.choices)) bad('场景数据无效')
    for (const l of s.lines) if (!idOK(l.id) || !str(l.speakerId, 80) || !str(l.text, 4000)) bad('台词数据无效')
    for (const c of s.choices) {
      if (!idOK(c.id) || !str(c.text, 500) || !c.text.trim() || !str(c.targetId, 80) || !Array.isArray(c.effects) || c.effects.length > 10 || (c.condition && (!idOK(c.condition.variableId) || !['eq','neq','gte','lte'].includes(c.condition.op) || !['number','boolean'].includes(typeof c.condition.value)))) bad('选项数据无效')
      if (c.condition && typeof c.condition.value === 'number' && (!Number.isFinite(c.condition.value) || Math.abs(c.condition.value) > 9999)) bad('选项条件数值无效')
      for (const e of c.effects) if (!e || !idOK(e.variableId) || !['set','add'].includes(e.op) || !['number','boolean'].includes(typeof e.value) || (typeof e.value === 'number' && (!Number.isFinite(e.value) || Math.abs(e.value) > 9999))) bad('选项效果无效')
    }
  }
  validateCommands(p)
  return p
}

export function diagnose(p) {
  const issues = [], scenes = new Map(p.scenes.map(s => [s.id,s])), assets = new Map(p.assets.map(a => [a.id,a])), cast = new Set(p.cast.map(c => c.id)), variables = new Map(p.variables.map(v => [v.id,v]))
  if (!scenes.has(p.startSceneId)) issues.push('起始场景不存在')
  const seen = new Set(), walk = id => { if (seen.has(id) || !scenes.has(id)) return; seen.add(id); for (const c of scenes.get(id).choices) walk(c.targetId); for (const c of scenes.get(id).commands || []) if (c.type === 'jump') walk(c.targetId) }
  walk(p.startSceneId)
  for (const s of p.scenes) {
    if (!seen.has(s.id)) issues.push('「' + s.title + '」无法从开场到达')
    if (!s.ending && !s.choices.length && !s.commands?.some(c => c.type === 'jump')) issues.push('「' + s.title + '」没有后续选项或结局标记')
    if (s.backgroundId && assets.get(s.backgroundId)?.kind !== 'image') issues.push('「' + s.title + '」的背景不存在')
    if (s.musicId && assets.get(s.musicId)?.kind !== 'audio') issues.push('「' + s.title + '」的音乐不存在')
    for (const id of [s.leftCharacterId,s.rightCharacterId]) if (id && !cast.has(id)) issues.push('「' + s.title + '」引用了不存在的角色')
    for (const l of s.lines) if (l.speakerId && !cast.has(l.speakerId)) issues.push('「' + s.title + '」有未知说话人')
    for (const c of s.choices) {
      if (!scenes.has(c.targetId)) issues.push('「' + s.title + '」的选项「' + c.text + '」没有有效目标')
      if (c.condition && !variables.has(c.condition.variableId)) issues.push('「' + s.title + '」的选项条件引用了未知变量')
      if (c.condition && variables.get(c.condition.variableId)?.kind === 'boolean' && (['gte','lte'].includes(c.condition.op) || typeof c.condition.value !== 'boolean')) issues.push('「' + s.title + '」的布尔条件类型不匹配')
      if (c.condition && numeric(variables.get(c.condition.variableId)?.kind) && typeof c.condition.value !== 'number') issues.push('「' + s.title + '」的数字条件类型不匹配')
      for (const e of c.effects) {
        const def = variables.get(e.variableId)
        if (!def) issues.push('「' + s.title + '」的选项效果引用了未知变量')
        else if (numeric(def.kind) ? typeof e.value !== 'number' : e.op !== 'set' || typeof e.value !== 'boolean') issues.push('「' + s.title + '」的选项效果类型不匹配')
      }
    }
  }
  for (const c of p.cast) if (c.portraitId && assets.get(c.portraitId)?.kind !== 'image') issues.push('角色「' + c.name + '」的立绘不存在')
  return issues
}

// 从起点沿选项展开剧情结构：首次到达的场景展开子节点，重复到达记为 ref，环不会无限递归
const missingTarget = choice => !choice.targetId ? '这个选项没有设置目标场景' : '目标场景已不存在'

export function storyTree(p) {
  const scenes = new Map(p.scenes.map(scene => [scene.id, scene])), expanded = new Set()
  let seq = 0
  const visit = id => {
    const scene = scenes.get(id)
    if (!scene) return null
    if (expanded.has(id)) return { id, ref: true, scene }
    expanded.add(id)
    const node = { id, scene, seq: ++seq, children: [] }
    for (const choice of scene.choices) {
      if (!scenes.has(choice.targetId)) node.children.push({ choice, missing: missingTarget(choice) })
      else node.children.push({ choice, node: visit(choice.targetId) })
    }
    return node
  }
  const root = scenes.has(p.startSceneId) ? visit(p.startSceneId) : null
  return { root, unreachable: p.scenes.filter(scene => !expanded.has(scene.id)) }
}

// 侧栏使用：按剧情树先序列出可到达场景及层级，重复到达的场景只出现在第一次的位置
// 统计某节点下的后续节点数，供折叠时显示「展开 N 个后续场景」
export function descendants(node) {
  let total = 0
  for (const child of node.children || []) {
    if (!child.node) continue
    total += 1
    if (!child.node.ref) total += descendants(child.node)
  }
  return total
}

export function outlineTree(p) {
  const { root, unreachable } = storyTree(p), items = []
  const walk = (node, depth) => {
    if (!node || node.ref) return
    items.push({ id: node.id, depth, scene: node.scene })
    for (const child of node.children) if (child.node) walk(child.node, depth + 1)
  }
  walk(root, 0)
  return { items, unreachable }
}

export function passes(condition, values) {
  if (!condition) return true
  const left = values[condition.variableId], right = condition.value
  if (left === undefined || typeof left !== typeof right) return false
  if (condition.op === 'eq') return left === right
  if (condition.op === 'neq') return left !== right
  if (condition.op === 'gte') return typeof left === 'number' && left >= right
  if (condition.op === 'lte') return typeof left === 'number' && left <= right
  return false
}

export function followChoice(choice, values, variables) {
  if (!passes(choice.condition, values)) throw Error('此选项的条件未满足')
  const next = { ...values }
  for (const effect of choice.effects) {
    const def = variables.find(v => v.id === effect.variableId)
    if (!def) continue
    if (effect.op === 'add' && numeric(def.kind) && typeof effect.value === 'number') next[def.id] = Math.max(-9999, Math.min(9999, Number(next[def.id] || 0) + effect.value))
    if (effect.op === 'set' && (numeric(def.kind) ? typeof effect.value === 'number' : typeof effect.value === 'boolean')) next[def.id] = effect.value
  }
  return next
}

export const commandNames = { say: '对白', background: '背景', show: '人物登场 / 表情', hide: '人物退场', transform: '人物移动', model: '动态角色演出', camera: '背景镜头', shake: '画面震动', weather: '天气', filter: '画面滤镜', animate: '关键帧动画', music: '音乐', sound: '音效', wait: '等待', set: '修改变量', choice: '分支选择', jump: '跳转场景' }
export function newCommand(type, p) {
  const defaults = {
    say: { speakerId: '', text: '' }, background: { assetId: '', duration: 600 },
    show: { characterId: p.cast[0]?.id || '', expressionId: '', x: 30, y: 0, scale: 1, opacity: 1, duration: 500 },
    hide: { characterId: p.cast[0]?.id || '', duration: 400 },
    transform: { characterId: p.cast[0]?.id || '', x: 65, y: 0, scale: 1, opacity: 1, duration: 700 },
    music: { assetId: '', volume: .6, duration: 800 }, sound: { assetId: '', volume: .7 },
    wait: { duration: 600 }, set: { variableId: p.variables[0]?.id || '', op: 'set', value: p.variables[0]?.initial ?? 0 },
    choice: {}, jump: { targetId: '' },
    camera: cameraDefaults(), shake: { strength: 1, duration: 600, frequency: 14 },
    weather: { effect: 'rain', intensity: .5, speed: 1 }, filter: filterDefaults(),
    animate: { target: 'background', characterId: '', animationId: p.animations?.[0]?.id || '' },
    model: { characterId: p.cast.find(c => c.modelId)?.id || '', expressionId: '', motionId: '', parameters: {}, idle: true },
  }
  return { id: crypto.randomUUID(), type, ...defaults[type] }
}

// Legacy fields remain a projection for old tools and the existing story tree.
export function syncLegacy(scene) {
  if (!scene.commands) return scene
  scene.lines = scene.commands.filter(c => c.type === 'say').map(({ id, speakerId, text }) => ({ id, speakerId, text }))
  scene.backgroundId = scene.commands.find(c => c.type === 'background')?.assetId || ''
  scene.musicId = scene.commands.find(c => c.type === 'music')?.assetId || ''
  return scene
}

export function upgradeProject(source) {
  validateProject(source)
  const p = structuredClone(source)
  p.schemaVersion = 2
  p.animations ||= []
  for (const s of p.scenes) {
    if (s.commands) continue
    let index = 0
    const command = (type, fields = {}) => ({ id: 'legacy-' + type + '-' + index++, type, ...fields })
    s.commands = [command('background', { assetId: s.backgroundId, duration: 600 }), command('music', { assetId: s.musicId, volume: .6, duration: 800 })]
    for (const [characterId, x] of [[s.leftCharacterId, 30], [s.rightCharacterId, 70]]) if (characterId) s.commands.push(command('show', { characterId, expressionId: '', x, y: 0, scale: 1, opacity: 1, duration: 500 }))
    s.commands.push(...s.lines.map(l => ({ ...l, type: 'say' })))
    if (!s.ending) s.commands.push(command('choice'))
  }
  return p
}

function validateCommands(p) {
  const bounded = (v, min, max) => Number.isFinite(v) && v >= min && v <= max
  if (p.animations !== undefined && (!Array.isArray(p.animations) || p.animations.length > 60 || !unique(p.animations) || p.animations.some(a => !idOK(a.id) || !str(a.name, 60) || !a.name.trim() || !animationOK(a)))) bad('关键帧动画定义无效')
  for (const v of p.variables) if (v.scope !== undefined && !['save', 'global'].includes(v.scope)) bad('变量保存范围无效')
  for (const c of p.cast) if (c.expressions !== undefined && (!Array.isArray(c.expressions) || c.expressions.length > 30 || !unique(c.expressions) || c.expressions.some(e => !idOK(e.id) || !str(e.name, 60) || !str(e.portraitId, 80)))) bad('角色表情无效')
  for (const s of p.scenes) {
    if (s.position !== undefined && (!bounded(s.position.x, 0, 10000) || !bounded(s.position.y, 0, 10000))) bad('场景画布位置无效')
    if (s.commands === undefined && p.schemaVersion === 1) continue
    if (!Array.isArray(s.commands) || s.commands.length > 1000 || !unique(s.commands)) bad('演出指令序列无效')
    for (const c of s.commands) {
      if (!idOK(c.id) || !Object.hasOwn(commandNames, c.type)) bad('演出指令类型无效')
      if (!presentationOK(c)) bad('演出效果或文字样式参数无效')
      if (c.type === 'model' && (!str(c.characterId,80) || !str(c.expressionId,80) || !str(c.motionId,80) || typeof c.idle !== 'boolean' || !c.parameters || typeof c.parameters !== 'object' || Array.isArray(c.parameters) || Object.keys(c.parameters).length > 100 || Object.entries(c.parameters).some(([id,v]) => !idOK(id) || !bounded(v,-10000,10000)))) bad('动态角色演出参数无效')
      if (c.condition && (!idOK(c.condition.variableId) || !['eq', 'neq', 'gte', 'lte'].includes(c.condition.op) || !['number', 'boolean'].includes(typeof c.condition.value) || typeof c.condition.value === 'number' && !bounded(c.condition.value, -9999, 9999))) bad('指令条件无效')
      if (['background', 'music', 'sound'].includes(c.type) && !str(c.assetId, 80)) bad('指令素材无效')
      if (['background', 'music', 'wait', 'show', 'hide', 'transform'].includes(c.type) && !bounded(c.duration, 0, 30000)) bad('指令时长无效')
      if (['music', 'sound'].includes(c.type) && !bounded(c.volume, 0, 1)) bad('指令音量无效')
      if (c.type === 'say' && (!str(c.speakerId, 80) || !str(c.text, 4000))) bad('指令对白无效')
      if (c.type === 'say' && c.voiceId !== undefined && !str(c.voiceId,80)) bad('对白语音无效')
      if (['show', 'hide', 'transform'].includes(c.type) && !str(c.characterId, 80)) bad('指令角色无效')
      if (c.type === 'show' && !str(c.expressionId, 80)) bad('指令表情无效')
      if (['show', 'transform'].includes(c.type) && (!bounded(c.x, -50, 150) || !bounded(c.y, -100, 100) || !bounded(c.scale, .1, 3) || !bounded(c.opacity, 0, 1))) bad('人物变换无效')
      if (c.type === 'jump' && !str(c.targetId, 80)) bad('跳转目标无效')
      if (c.type === 'set' && (!str(c.variableId, 80) || !['set', 'add'].includes(c.op) || !['number', 'boolean'].includes(typeof c.value) || typeof c.value === 'number' && !bounded(c.value, -9999, 9999))) bad('变量指令无效')
    }
  }
}

export function commandIssues(p) {
  const issues = [], assets = new Map(p.assets.map(a => [a.id, a])), cast = new Map(p.cast.map(c => [c.id, c]))
  for (const s of p.scenes) for (const c of s.commands || []) {
    const prefix = '「' + s.title + '」' + commandNames[c.type] + '：'
    if (['background', 'music', 'sound'].includes(c.type) && c.assetId && assets.get(c.assetId)?.kind !== (c.type === 'background' ? 'image' : 'audio')) issues.push(prefix + '素材不存在或类型不匹配')
    if (['show', 'hide', 'transform', 'model'].includes(c.type) && !cast.has(c.characterId)) issues.push(prefix + '角色不存在')
    if (c.type === 'model' && cast.has(c.characterId) && !cast.get(c.characterId).modelId) issues.push(prefix + '角色尚未关联动态模型')
    if (c.type === 'say' && c.voiceId && assets.get(c.voiceId)?.kind !== 'audio') issues.push(prefix + '语音素材不存在或类型不匹配')
    if (c.type === 'show' && c.expressionId && !cast.get(c.characterId)?.expressions?.some(e => e.id === c.expressionId)) issues.push(prefix + '表情不存在')
    if (c.type === 'jump' && !p.scenes.some(s => s.id === c.targetId)) issues.push(prefix + '目标场景不存在')
    if (c.type === 'animate' && c.animationId && !p.animations?.some(a => a.id === c.animationId)) issues.push(prefix + '动画不存在')
    if (c.type === 'animate' && c.target === 'character' && !cast.has(c.characterId)) issues.push(prefix + '动画角色不存在')
    if (c.condition) {
      const v = p.variables.find(v => v.id === c.condition.variableId)
      if (!v || (v.kind === 'boolean' ? typeof c.condition.value !== 'boolean' || ['gte', 'lte'].includes(c.condition.op) : typeof c.condition.value !== 'number')) issues.push(prefix + '执行条件的变量或类型不匹配')
    }
    if (c.type === 'set') {
      const v = p.variables.find(v => v.id === c.variableId)
      if (!v || (v.kind === 'boolean' ? typeof c.value !== 'boolean' || c.op !== 'set' : typeof c.value !== 'number')) issues.push(prefix + '变量或数值类型不匹配')
    }
  }
  for (const c of p.cast) for (const e of c.expressions || []) if (e.portraitId && assets.get(e.portraitId)?.kind !== 'image') issues.push('角色「' + c.name + '」的表情「' + e.name + '」素材不存在')
  return issues
}
