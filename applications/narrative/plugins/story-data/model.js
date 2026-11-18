import { storyComposition, migrateStoryComposition } from './story-composition.js'
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const text = (v, max = 4000) => typeof v === 'string' && v.length <= max
const idOK = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v)
const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const list = (v, max) => Array.isArray(v) && v.length <= max
const unique = rows => new Set(rows.map(row => row?.id)).size === rows.length && rows.every(row => object(row) && idOK(row.id))
const finite = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000000
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
const legacyKeys=['startNodeId','nodes','variables','rules']
function validateScript(p) {
  for (const [key, max] of [['variables',80],['nodes',300],['rules',200]]) if (!list(p[key], max) || !unique(p[key])) fail('作品的' + key + '列表或标识无效')
  if (!p.nodes.length || !p.nodes.some(n => n.id === p.startNodeId)) fail('请选择有效的起始节点')
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
}
export function validateStories(p) {
  if (p.stories === undefined) { if (legacyKeys.some(k=>k in p)) validateScript(p); return }
  if (legacyKeys.some(k=>k in p)) fail('作品不能同时包含全局剧情和剧情资源')
  if (!list(p.stories,40) || !unique(p.stories)) fail('剧情资源列表或标识无效')
  for (const s of p.stories) {
    if (!text(s.name,160) || !s.name.trim()) fail('剧情资源名称无效')
    validateScript(s)
  }
}
export function diagnose(p) {
  if(p.stories)return p.stories.flatMap(s=>diagnose({...p,stories:undefined,...s}).map(message=>s.name+'：'+message))
  if(!p.nodes)return []
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
export function initialLegacyRuntime(project, nodeId=project.startNodeId) {
  const node = project.nodes.find(n => n.id === nodeId)
  if (!node) fail('剧情节点不存在')
  return { nodeId, lineIndex: 0, text: { speaker: '', text: '' }, variables: Object.fromEntries(project.variables.map(v => [v.id,v.initial])), stage: structuredClone(node.stage), transcript: [], chatTurns: 0, ended: false, busy: false, error: '', visited: [], firedRules: [], log: [] }
}
export function validateLegacyRuntime(value,project) {
  if (!object(value) || !project.nodes.some(n => n.id === value.nodeId) || !Number.isSafeInteger(value.lineIndex) || value.lineIndex < 0 || !object(value.variables) || !object(value.stage) || !object(value.text) || !text(value.text.speaker,80) || !text(value.text.text,8000) || !list(value.transcript,1000) || !list(value.visited,1000) || !list(value.firedRules,1000) || !list(value.log,1000) || !Number.isSafeInteger(value.chatTurns) || value.chatTurns < 0 || typeof value.ended !== 'boolean') fail('存档数据无效')
  for (const v of project.variables) if (!finite(value.variables[v.id]) || value.variables[v.id] < v.min || value.variables[v.id] > v.max) fail('存档属性超出范围')
  if (value.transcript.some(m => !object(m) || !['user','assistant','narrator'].includes(m.role) || !text(m.name,80) || !text(m.text,8000))) fail('存档对话无效')
  const node = project.nodes.find(n => n.id === value.nodeId)
  if (value.story !== undefined && (!object(value.story) || typeof value.story.awaiting !== "boolean" || value.story.awaiting && value.lineIndex !== Math.max(0,node.lines.length-1))) fail("剧情选项进度无效")
  if (value.lineIndex >= Math.max(1,node.lines.length)) fail('存档对白位置无效')
  if (!text(value.stage.background,80) || !text(value.stage.characterId,80) || !text(value.stage.expression,80) || !finite(value.stage.position) || value.stage.position < 0 || value.stage.position > 100 || !finite(value.stage.scale) || value.stage.scale < 30 || value.stage.scale > 180 || value.visited.some(id => !idOK(id)) || value.firedRules.some(id => !idOK(id))) fail('存档舞台数据无效')
  return { ...structuredClone(value), busy: false, error: '' }
}

function restore(next,project,{defaultComposition,expandScene}) {
  if (!next.nodeId) return next
  const story = project.stories?.find(s=>s.id==='main-story') || project.stories?.[0]
  if (story) {
    const old = validateLegacyRuntime({...next,objects:undefined},story)
    delete old.objects
    const doc=project.composition || defaultComposition(project)
    next.objects ??= {schemaVersion:1,sceneId:doc.startSceneId,states:{},flags:{}}
    const flows=expandScene(doc,next.objects.sceneId).objects.filter(o=>o.type==='story-flow' && (o.props?.storyId || project.stories[0].id)===story.id)
    if(flows.length!==1)fail('旧存档无法确定对应的剧情流程')
    const node=story.nodes.find(n=>n.id===old.nodeId)
    next.objects.states[next.objects.sceneId+'/'+flows[0].id]={...old,story:old.story||{awaiting:!node.lines.length && node.choices.length>0},storyId:story.id,started:true}
  }
  return {busy:false,error:'',...(next.objects?{objects:next.objects}:{})}
}
export function legacyComposition(project,{defaultComposition}) {
  const node=project.nodes.find(n=>n.id===project.startNodeId)
  const doc=storyComposition(project.title,node.stage,node.lines[0])
  doc.prefabs=defaultComposition(project).prefabs
  return doc
}
export function migrateStoryResources(project,tools) {
  if (project.nodes !== undefined) {
    validateStories(project)
    project.composition ??= legacyComposition(project,tools)
    project.stories=[{id:'main-story',name:project.title,startNodeId:project.startNodeId,nodes:project.nodes,variables:project.variables,rules:project.rules}]
    for(const group of [...project.composition.scenes,...project.composition.prefabs])for(const o of group.objects){
      if(o.type==='story-flow' && !o.props?.storyId)o.props={...o.props,storyId:'main-story'}
    }
    for(const key of legacyKeys)delete project[key]
  }
  if(project.composition)migrateStoryComposition(project)
  return project
}
export const storyFormat={id:'stories',validate:validateStories,migrate:migrateStoryResources,diagnose,restore,
  playRequest:(nodeId,selection)=>({nodeId,storyId:selection.storyId}),
  selection:p=>({storyId:p.stories?.[0]?.id||'',nodeId:p.stories?.[0]?.startNodeId||''})}
