const bad = message => { throw Object.assign(Error(message), { status: 400 }) }
const idOK = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value)
const str = (value, max) => typeof value === 'string' && value.length <= max
const unique = items => items.every(item => item && typeof item === 'object') && new Set(items.map(item => item.id)).size === items.length
const numeric = kind => kind === 'number' || kind === 'affinity'

export function blankProject(title = '未命名作品', id = crypto.randomUUID()) {
  const sceneId = crypto.randomUUID()
  return { schemaVersion: 1, id, revision: 0, title, description: '', startSceneId: sceneId, variables: [], cast: [], assets: [], scenes: [{ id: sceneId, title: '序章', backgroundId: '', musicId: '', leftCharacterId: '', rightCharacterId: '', ending: false, lines: [{ id: crypto.randomUUID(), speakerId: '', text: '故事从这里开始。' }], choices: [] }] }
}

export function validateProject(p) {
  if (!p || p.schemaVersion !== 1 || !idOK(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 0 || !str(p.title, 120) || !p.title.trim() || !str(p.description, 1000) || !idOK(p.startSceneId)) bad('作品基本信息无效')
  if (!Array.isArray(p.variables) || p.variables.length > 60 || !unique(p.variables) || !Array.isArray(p.cast) || p.cast.length > 30 || !unique(p.cast) || !Array.isArray(p.scenes) || !p.scenes.length || p.scenes.length > 300 || !unique(p.scenes) || !Array.isArray(p.assets) || p.assets.length > 100 || !unique(p.assets)) bad('作品规模或标识无效')
  for (const v of p.variables) if (!idOK(v.id) || !str(v.name, 60) || !v.name.trim() || !['number','boolean','affinity'].includes(v.kind) || (numeric(v.kind) ? !Number.isFinite(v.initial) || Math.abs(v.initial) > 9999 : typeof v.initial !== 'boolean')) bad('变量定义无效')
  for (const c of p.cast) if (!idOK(c.id) || !str(c.name, 60) || !c.name.trim() || !str(c.portraitId, 80) || !str(c.color, 20)) bad('角色定义无效')
  for (const a of p.assets) if (!idOK(a.id) || !['image','audio'].includes(a.kind) || !['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg','audio/ogg'].includes(a.mime) || !str(a.name, 120) || !a.name.trim() || !Number.isSafeInteger(a.size) || a.size < 1 || a.size > 8 * 1024 * 1024) bad('素材清单无效')
  if (p.assets.reduce((size, a) => size + a.size, 0) > 50 * 1024 * 1024) bad('作品素材总量不能超过 50 MB')
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
  return p
}

export function diagnose(p) {
  const issues = [], scenes = new Map(p.scenes.map(s => [s.id,s])), assets = new Map(p.assets.map(a => [a.id,a])), cast = new Set(p.cast.map(c => c.id)), variables = new Map(p.variables.map(v => [v.id,v]))
  if (!scenes.has(p.startSceneId)) issues.push('起始场景不存在')
  const seen = new Set(), walk = id => { if (seen.has(id) || !scenes.has(id)) return; seen.add(id); for (const c of scenes.get(id).choices) walk(c.targetId) }
  walk(p.startSceneId)
  for (const s of p.scenes) {
    if (!seen.has(s.id)) issues.push('「' + s.title + '」无法从开场到达')
    if (!s.ending && !s.choices.length) issues.push('「' + s.title + '」没有后续选项或结局标记')
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
