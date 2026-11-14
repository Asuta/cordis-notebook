const object = v => v && typeof v === 'object' && !Array.isArray(v)
const text = (v, max = 4000) => typeof v === 'string' && v.length <= max
const idOK = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v)
const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const list = (v, max) => Array.isArray(v) && v.length <= max
const unique = rows => new Set(rows.map(row => row?.id)).size === rows.length && rows.every(row => object(row) && idOK(row.id))
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000
const safeUrl = value => {
  if (!text(value, 8 * 1024 * 1024)) return false
  if (/^\/builtin\/project\/assets\/[a-z]+\.png$/.test(value) || value === '/builtin/project/assets/rain-theme.wav') return true
  if (/^data:(image\/(png|jpeg|webp)|audio\/(mpeg|wav|ogg));base64,[a-zA-Z0-9+/]+=*$/.test(value)) return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
function condition(value) {
  if (value == null) return
  if (!object(value) || !idOK(value.type || 'variable') || !idOK(value.variable) || !['gte','lte','eq','gt','lt'].includes(value.op) || !finite(value.value)) fail('条件配置无效')
}
function actions(rows) {
  if (!list(rows, 30)) fail('动作数量过多')
  for (const row of rows) {
    if (!object(row) || !idOK(row.type) || JSON.stringify(row).length > 8000) fail('动作配置无效')
    if (['add-variable','set-variable'].includes(row.type) && (!idOK(row.variable) || !finite(row.value))) fail('数值动作配置无效')
    if (row.type === 'expression' && !text(row.value, 100)) fail('表情动作无效')
    if (row.type === 'goto' && !idOK(row.target)) fail('跳转动作无效')
  }
}
export function validateProject(p) {
  if (!object(p) || p.schemaVersion !== 1 || !idOK(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 0 || !text(p.title, 120) || !p.title.trim() || !text(p.description, 2000) || !idOK(p.startNodeId) || !text(p.template, 40)) fail('作品基本信息无效')
  for (const [key, max] of [['characters',40],['assets',100],['variables',80],['nodes',300],['rules',200]]) if (!list(p[key], max) || !unique(p[key])) fail('作品的' + key + '列表或标识无效')
  if (!p.nodes.length || !p.nodes.some(n => n.id === p.startNodeId)) fail('请选择有效的起始节点')
  if (JSON.stringify(p).length > 24 * 1024 * 1024) fail('作品总大小不能超过 24 MB')
  for (const a of p.assets) if (!text(a.name, 160) || !['image','audio'].includes(a.kind) || !safeUrl(a.url)) fail('素材名称、类型或地址无效')
  for (const c of p.characters) {
    if (!text(c.name, 80) || !text(c.description, 8000) || !text(c.personality, 8000) || !text(c.portrait, 80) || !object(c.expressions) || !/^#[a-f0-9]{6}$/i.test(c.color)) fail('角色配置无效')
    for (const [key,value] of Object.entries(c.expressions)) if (!text(key, 80) || !text(value, 80)) fail('角色表情配置无效')
    if (c.live2d != null && (!object(c.live2d) || JSON.stringify(c.live2d).length > 16000)) fail('Live2D 配置无效')
    if (c.meshAvatar != null && (!object(c.meshAvatar) || !/^[a-f0-9]{64}$/.test(c.meshAvatar.archiveId || '') || !text(c.meshAvatar.name,120) || !Number.isSafeInteger(c.meshAvatar.size) || c.meshAvatar.size < 1 || c.meshAvatar.size > 64*1024*1024)) fail('动态立绘配置无效')
  }
  for (const v of p.variables) if (!text(v.name,80) || !finite(v.initial) || !finite(v.min) || !finite(v.max) || v.min > v.max || v.initial < v.min || v.initial > v.max) fail('属性范围或初始值无效')
  for (const n of p.nodes) {
    if (!idOK(n.type) || !text(n.title,160) || !object(n.stage) || !text(n.stage.background,80) || !text(n.stage.characterId,80) || !text(n.stage.expression,80) || !finite(n.stage.position) || n.stage.position < 0 || n.stage.position > 100 || !finite(n.stage.scale) || n.stage.scale < 30 || n.stage.scale > 180) fail('节点或舞台配置无效')
    if (!list(n.lines,200) || n.lines.some(l => !object(l) || !text(l.speaker,80) || !text(l.text,8000)) || !list(n.choices,20) || !unique(n.choices)) fail('对白或选项无效')
    if (n.next != null && !text(n.next,80)) fail('后续节点无效')
    for (const c of n.choices) {
      if (!text(c.text,600) || !text(c.target,80)) fail('选项文字或目标无效')
      condition(c.condition); actions(c.actions)
    }
    if (n.chat != null && (!object(n.chat) || !text(n.chat.characterId,80) || !text(n.chat.prompt,8000) || !Number.isInteger(n.chat.maxTurns) || n.chat.maxTurns < 1 || n.chat.maxTurns > 100 || !text(n.chat.next,80) || !text(n.chat.label,160) || !list(n.chat.demoReplies,100) || n.chat.demoReplies.some(r => !text(r,8000)))) fail('自由对话配置无效')
  }
  for (const r of p.rules) {
    if (!text(r.name,160) || !text(r.event,100) || !text(r.nodeId || '',80) || typeof r.once !== 'boolean') fail('事件规则无效')
    condition(r.condition); actions(r.actions)
  }
  if (!object(p.settings) || !['novel','chat'].includes(p.settings.dialogueStyle) || !/^#[a-f0-9]{6}$/i.test(p.settings.accent) || !text(p.settings.worldInfo,16000)) fail('作品设置无效')
  if (p.settings.volume !== undefined && (!finite(p.settings.volume) || p.settings.volume < 0 || p.settings.volume > 1) || p.settings.bgm !== undefined && !text(p.settings.bgm,80)) fail('背景音乐配置无效')
  return p
}
export function diagnose(p) {
  const issues = [], nodes = new Set(p.nodes.map(n => n.id)), vars = new Set(p.variables.map(v => v.id)), assets = new Set(p.assets.map(a => a.id)), chars = new Set(p.characters.map(c => c.id))
  const target = (id, label) => { if (id && !nodes.has(id)) issues.push(label + '引用了不存在的节点') }
  for (const n of p.nodes) {
    target(n.next, n.title); target(n.chat?.next, n.title)
    if (n.stage.background && !assets.has(n.stage.background)) issues.push(n.title + '的背景素材缺失')
    if (n.stage.characterId && !chars.has(n.stage.characterId)) issues.push(n.title + '的角色缺失')
    for (const c of n.choices) { target(c.target, n.title + '的选项'); if (!c.target) issues.push(n.title + '有未连接的选项'); if (c.condition && !vars.has(c.condition.variable)) issues.push(n.title + '引用了不存在的属性') }
  }
  return [...new Set(issues)]
}
export function initialRuntime(project, nodeId = project.startNodeId) {
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) fail('剧情节点不存在')
  return { nodeId, lineIndex: 0, text: { speaker: '', text: '' }, variables: Object.fromEntries(project.variables.map(v => [v.id,v.initial])), stage: structuredClone(node.stage), transcript: [], chatTurns: 0, ended: false, busy: false, error: '', visited: [], firedRules: [], log: [] }
}
export function validateRuntime(value, project) {
  if (!object(value) || !project.nodes.some(n => n.id === value.nodeId) || !Number.isSafeInteger(value.lineIndex) || value.lineIndex < 0 || !object(value.variables) || !object(value.stage) || !object(value.text) || !text(value.text.speaker,80) || !text(value.text.text,8000) || !list(value.transcript,1000) || !list(value.visited,1000) || !list(value.firedRules,1000) || !list(value.log,1000) || !Number.isSafeInteger(value.chatTurns) || value.chatTurns < 0 || typeof value.ended !== 'boolean') fail('存档数据无效')
  for (const v of project.variables) if (!finite(value.variables[v.id]) || value.variables[v.id] < v.min || value.variables[v.id] > v.max) fail('存档属性超出范围')
  if (value.transcript.some(m => !object(m) || !['user','assistant','narrator'].includes(m.role) || !text(m.name,80) || !text(m.text,8000))) fail('存档对话无效')
  const node = project.nodes.find(n => n.id === value.nodeId)
  if (value.lineIndex >= Math.max(1,node.lines.length)) fail('存档对白位置无效')
  if (!text(value.stage.background,80) || !text(value.stage.characterId,80) || !text(value.stage.expression,80) || !finite(value.stage.position) || value.stage.position < 0 || value.stage.position > 100 || !finite(value.stage.scale) || value.stage.scale < 30 || value.stage.scale > 180 || value.visited.some(id => !idOK(id)) || value.firedRules.some(id => !idOK(id))) fail('存档舞台数据无效')
  return { ...structuredClone(value), busy: false, error: '' }
}
