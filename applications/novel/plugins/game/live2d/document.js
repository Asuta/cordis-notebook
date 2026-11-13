import { createRectArtMesh, addArtMeshVertex, removeArtMeshVertex, retriangulateArtMesh, DEFAULT_PARAMETERS, DEFAULT_TRANSFORM, defaultWarpDeformer, resolveArtMesh } from './vendor/standrig/runtime.js'
import { rigSemanticParts } from './rigging.js'
import { inspectionPoses, inspectionValues } from './poses.js'
import { validateMeshModel } from '../mesh-avatar/document.js'

export const modelIdOK = id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/i.test(id)
const finite = (v, min = -100000, max = 100000) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const unique = rows => Array.isArray(rows) && new Set(rows.map(x => x?.id)).size === rows.length && rows.every(x => modelIdOK(x?.id))
const copy = x => structuredClone(x)
export const parameterLabels = { ParamAngleX: '转头 X', ParamAngleY: '抬头 Y', ParamAngleZ: '歪头 Z', ParamBodyAngleX: '身体转向', ParamBodyAngleY: '身体俯仰', ParamBodyAngleZ: '身体倾斜', ParamEyeBallX: '视线 X', ParamEyeBallY: '视线 Y', ParamEyeLOpen: '左眼开合', ParamEyeROpen: '右眼开合', ParamMouthOpen: '嘴巴开合', ParamMouthForm: '嘴型', ParamMouthSmile: '微笑', ParamBreath: '呼吸', ParamHairFront: '前发摆动' }
Object.assign(parameterLabels, { ParamCheek: '脸红', ParamEyeLSmile: '左眼笑意', ParamEyeRSmile: '右眼笑意', ParamBrowLY: '左眉上下', ParamBrowRY: '右眉上下', ParamBrowLX: '左眉左右', ParamBrowRX: '右眉左右', ParamBrowLAngle: '左眉倾斜', ParamBrowRAngle: '右眉倾斜', ParamBrowLForm: '左眉形状', ParamBrowRForm: '右眉形状', ParamHairSide: '侧发摆动', ParamHairBack: '后发摆动', ParamSkirt: '裙摆', ParamRibbon: '缎带' })
export const roles = [['torso','身体'],['face','脸部'],['hair-back','后发'],['hair-front','前发'],['eye-left','左眼'],['eye-right','右眼'],['eye-left-closed','左眼闭眼'],['eye-right-closed','右眼闭眼'],['brow-left','左眉'],['brow-right','右眉'],['mouth','闭嘴'],['mouth-open','张嘴'],['accessory','饰品'],['unknown','其他']]
export function blankModel(name = '新角色模型', id = crypto.randomUUID(), width = 768, height = 1024) {
  return { schemaVersion: 1, id, name, revision: 0, sourceAssetId: '', rig: { schemaVersion: '0.1.0', name, stage: { width, height, background: 'transparent' }, assets: [], parameters: copy(DEFAULT_PARAMETERS), parts: [], deformers: [], physics: { enabled: true, chains: [] } }, expressions: [], motions: [], generation: null }
}
export const modelAssetIds = model => [...new Set([model.sourceAssetId, ...model.rig.assets.map(a => a.src.slice(6))].filter(Boolean))]
export const modelSummary = model => ({ id: model.id, name: model.name, revision: model.revision, assetIds: modelAssetIds(model), sourceAssetId: model.sourceAssetId || '', ...(model.engine === 'mesh-avatar' ? { engine: model.engine, editorProject: model.editorProject } : {}) })
export const defaults = model => Object.fromEntries(model.rig.parameters.map(p => [p.id, p.default]))
export function validateModel(m, imageIds) {
  if (m?.engine === 'mesh-avatar') return validateMeshModel(m)
  if (!m || m.schemaVersion !== 1 || !modelIdOK(m.id) || !Number.isSafeInteger(m.revision) || m.revision < 0 || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 120 || !Array.isArray(m.expressions) || !Array.isArray(m.motions)) fail('角色模型基本信息无效')
  const r = m.rig
  if (!r || r.schemaVersion !== '0.1.0' || !finite(r.stage?.width, 16, 8192) || !finite(r.stage?.height, 16, 8192) || !unique(r.parts) || r.parts.length > 120 || !unique(r.assets) || r.assets.length > 180 || !unique(r.parameters) || r.parameters.length > 100 || !unique(r.deformers || [])) fail('模型舞台、部件或参数无效')
  const assets = new Map(r.assets.map(a => [a.id, a])), params = new Map(r.parameters.map(p => [p.id, p])), partIds = new Set(r.parts.map(p => p.id)), deformerIds = new Set((r.deformers || []).map(d => d.id))
  if (m.sourceAssetId && (!modelIdOK(m.sourceAssetId) || imageIds && !imageIds.has(m.sourceAssetId))) fail('模型原图不存在')
  for (const a of r.assets) if (typeof a.src !== 'string' || !a.src.startsWith('asset:') || !modelIdOK(a.src.slice(6)) || imageIds && !imageIds.has(a.src.slice(6)) || !finite(a.width, 1, 8192) || !finite(a.height, 1, 8192)) fail('模型纹理必须引用本作品的图片素材')
  for (const p of r.parameters) if (!finite(p.min) || !finite(p.max) || p.max <= p.min || !finite(p.default, p.min, p.max) || typeof p.label !== 'string' || p.label.length > 120) fail('模型参数范围无效')
  const bindings = (list, mesh = false) => {
    if (list === undefined) return
    if (!Array.isArray(list) || list.length > 80) fail('参数绑定数量无效')
    for (const b of list) {
      const dimensions = b.parameters || [b.parameter]
      if (!Array.isArray(dimensions) || !dimensions.length || dimensions.length > 3 || new Set(dimensions).size !== dimensions.length || dimensions.some(id => !params.has(id))) fail('绑定引用了不存在或重复的参数')
      const keys = b.keyforms || b.keys
      if (!Array.isArray(keys) || !keys.length || keys.length > 100) fail('参数关键形无效')
      for (const k of keys) {
        if (b.parameters ? dimensions.some(id => !finite(k.inputs?.[id], params.get(id).min, params.get(id).max)) : !finite(k.input, params.get(b.parameter).min, params.get(b.parameter).max)) fail('关键形参数值越界')
        if (mesh ? !Array.isArray(k.offsets) || k.offsets.some(o => !modelIdOK(o.vertexId) || !finite(o.x) || !finite(o.y)) : !finite(k.value)) fail('关键形数据无效')
      }
    }
  }
  const hierarchy = (rows, field, ids) => { for (const item of rows) { let at = item, seen = new Set([item.id]); while (at[field]) { if (!ids.has(at[field]) || seen.has(at[field])) fail('模型层级存在循环或悬空引用'); seen.add(at[field]); at = rows.find(x => x.id === at[field]) } } }
  hierarchy(r.parts, 'parentId', partIds); hierarchy(r.deformers || [], 'parentId', deformerIds)
  for (const p of r.parts) {
    if (typeof p.name !== 'string' || p.name.length > 120 || !['image','group'].includes(p.kind) || p.kind === 'image' && !assets.has(p.assetId) || p.deformerId && !deformerIds.has(p.deformerId) || !finite(p.drawOrder) || typeof p.visible !== 'boolean') fail('模型部件数据无效')
    if (!p.transform || ['x','y','rotation','scaleX','scaleY','pivotX','pivotY','opacity'].some(k => !finite(p.transform[k]))) fail('模型部件变换无效')
    if (p.clip && (p.clip.mode !== 'alpha' || [p.clip.maskPartId, ...(p.clip.maskPartIds || [])].filter(Boolean).some(id => !partIds.has(id) || id === p.id))) fail('模型遮罩引用无效')
    bindings(p.bindings); bindings(p.multiBindings)
    if (p.artMesh) {
      const mesh = p.artMesh
      if (!unique(mesh.vertices) || mesh.vertices.length < 3 || mesh.vertices.length > 2500 || !Array.isArray(mesh.triangles) || mesh.triangles.length % 3 || mesh.triangles.length > 15000 || mesh.triangles.some(i => !Number.isInteger(i) || i < 0 || i >= mesh.vertices.length) || mesh.vertices.some(v => !finite(v.x) || !finite(v.y) || !finite(v.u,0,1) || !finite(v.v,0,1))) fail('模型网格无效')
      bindings(mesh.bindings, true); bindings(mesh.multiBindings, true)
      const vertexIds = new Set(mesh.vertices.map(v => v.id))
      for (const b of [...mesh.bindings || [], ...mesh.multiBindings || []]) for (const k of b.keys || b.keyforms) if (k.offsets.some(o => !vertexIds.has(o.vertexId))) fail('关键形引用了不存在的顶点')
    }
  }
  for (const d of r.deformers || []) { if (!['rotate','warp','group'].includes(d.kind) || !d.transform || Object.values(d.transform).some(v => !finite(v))) fail('变形器无效'); bindings(d.bindings); bindings(d.multiBindings) }
  if (!r.physics || !Array.isArray(r.physics.chains) || r.physics.chains.length > 40) fail('物理配置无效')
  for (const chain of r.physics.chains) if (!modelIdOK(chain.id) || !Array.isArray(chain.targetPartIds) || chain.targetPartIds.some(id => !partIds.has(id)) || !finite(chain.stiffness,0,1000) || !finite(chain.damping,0,100) || !finite(chain.mass,.001,1000) || !finite(chain.gravity,-1000,1000) || !finite(chain.wind,-1000,1000) || !chain.output || !finite(chain.output.scale) || !Array.isArray(chain.sourceParameters) || chain.sourceParameters.some(s => !params.has(s.parameter) || !finite(s.scale))) fail('物理链参数无效')
  for (const chain of r.physics.chains) if (chain.parameterOutput && (!params.has(chain.parameterOutput.parameter) || !finite(chain.parameterOutput.scale) || !finite(chain.parameterOutput.min) || !finite(chain.parameterOutput.max) || chain.parameterOutput.min > chain.parameterOutput.max)) fail('物理输出参数无效')
  if (!unique(m.expressions) || m.expressions.length > 50 || !unique(m.motions) || m.motions.length > 50) fail('表情或动作无效')
  const valuesOK = values => values && typeof values === 'object' && !Array.isArray(values) && Object.entries(values).every(([id,v]) => params.has(id) && finite(v,params.get(id).min,params.get(id).max))
  for (const e of m.expressions) if (!valuesOK(e.values)) fail('表情参数无效')
  for (const motion of m.motions) {
    if (!finite(motion.duration,100,60000) || !Array.isArray(motion.tracks) || motion.tracks.length > 100) fail('动作时长或轨道无效')
    for (const t of motion.tracks) { if (!params.has(t.parameter) || !Array.isArray(t.keys) || !t.keys.length || t.keys.length > 120) fail('动作轨道无效'); let last = -1; for (const k of t.keys) { if (!finite(k.at,0,1) || k.at <= last || !finite(k.value,params.get(t.parameter).min,params.get(t.parameter).max) || !['linear','smooth','hold'].includes(k.easing || 'linear')) fail('动作关键帧无效'); last = k.at } }
  }
  if (new TextEncoder().encode(JSON.stringify(m)).length > 12 * 1024 * 1024) fail('角色工程不能超过 12 MB')
  return m
}

export function addImagePart(m, asset, role = 'unknown', x = m.rig.stage.width / 2, y = m.rig.stage.height / 2) {
  const id = crypto.randomUUID(), textureId = crypto.randomUUID()
  m.rig.assets.push({ id: textureId, name: asset.name, type: 'image', src: 'asset:' + asset.id, width: asset.width, height: asset.height })
  m.rig.parts.push({ id, name: asset.name, kind: 'image', assetId: textureId, parentId: null, visible: true, locked: false, role, drawOrder: m.rig.parts.length * 10, transform: { ...DEFAULT_TRANSFORM, x, y }, bindings: [], artMesh: createRectArtMesh(asset.width, asset.height, { preset: 'face-feature', columns: 4, rows: 4 }) })
  return id
}
function part(m, id) { return m.rig.parts.find(p => p.id === id) || fail('部件不存在') }
export function applyModelEdits(source, operations, imageIds) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 100) fail('请提供 1–100 个模型编辑操作')
  const m = copy(source)
  for (const op of operations) {
    const target = m.rig.parts.find(p => p.id === op.id || p.id === op.value?.id)
    if (target?.locked && (op.type !== 'set_part' || Object.keys(op.patch || {}).some(k => !['locked','visible'].includes(k)))) fail('部件已锁定，请先解锁')
    if (op.type === 'rename') { m.name = op.name; m.rig.name = op.name }
    else if (op.type === 'set_part') { const p = part(m,op.id); for (const k of Object.keys(op.patch || {})) if (!['name','visible','locked','drawOrder','parentId','deformerId','role','clip','blendMode','assetId'].includes(k)) fail('部件字段无效'); Object.assign(p,op.patch) }
    else if (op.type === 'transform') { if (Object.keys(op.patch || {}).some(k => !Object.hasOwn(DEFAULT_TRANSFORM,k))) fail('变换字段无效'); Object.assign(part(m,op.id).transform,op.patch) }
    else if (op.type === 'upsert_part') { const at = m.rig.parts.findIndex(p => p.id === op.value.id); if (at < 0) m.rig.parts.push(copy(op.value)); else m.rig.parts[at] = copy(op.value) }
    else if (op.type === 'add_image') addImagePart(m,op.asset,op.role,op.x,op.y)
    else if (op.type === 'remove_part') { m.rig.parts = m.rig.parts.filter(p => p.id !== op.id); for (const p of m.rig.parts) { if (p.parentId === op.id) p.parentId = null; if (p.clip?.maskPartId === op.id || p.clip?.maskPartIds?.includes(op.id)) delete p.clip } for (const c of m.rig.physics.chains) c.targetPartIds = c.targetPartIds.filter(id => id !== op.id); for(const d of m.rig.deformers)if(d.targetPartIds)d.targetPartIds=d.targetPartIds.filter(id=>id!==op.id) }
    else if (op.type === 'generate_mesh') { const columns=op.columns??6,rows=op.rows??6;if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns>40||rows>40)fail('网格行列必须在 1–40 之间');const p = part(m,op.id), a = m.rig.assets.find(a => a.id === p.assetId);if(!a)fail('部件没有纹理'); p.artMesh = createRectArtMesh(a.width,a.height,{ preset: 'face-feature', columns, rows }) }
    else if (op.type === 'move_vertex') { const p = part(m,op.id); if (p.locked) fail('部件已锁定'); const v = p.artMesh.vertices.find(v => v.id === op.vertexId); if (!v) fail('顶点不存在'); v.x = op.x; v.y = op.y }
    else if (op.type === 'add_vertex') { const mesh = part(m,op.id).artMesh; addArtMeshVertex(mesh,op.value); retriangulateArtMesh(mesh) }
    else if (op.type === 'remove_vertex') { const mesh = part(m,op.id).artMesh; removeArtMeshVertex(mesh,mesh.vertices.findIndex(v => v.id === op.vertexId)); retriangulateArtMesh(mesh) }
    else if (op.type === 'set_triangles') part(m,op.id).artMesh.triangles = copy(op.triangles)
    else if (op.type === 'mirror_mesh') { const p = part(m,op.id), a = m.rig.assets.find(a => a.id === p.assetId); for (const v of p.artMesh.vertices) v.x = a.width - v.x; for (let i=0;i<p.artMesh.triangles.length;i+=3) [p.artMesh.triangles[i],p.artMesh.triangles[i+1]] = [p.artMesh.triangles[i+1],p.artMesh.triangles[i]] }
    else if (op.type === 'set_keyform') {
      const p = part(m,op.id), multi = op.parameters?.length > 1, list = (p.artMesh[multi ? 'multiBindings' : 'bindings'] ||= []), ids = op.parameters || [op.parameter]
      let b = list.find(b => multi ? JSON.stringify(b.parameters) === JSON.stringify(ids) : b.parameter === ids[0])
      if (!b) { b = multi ? {parameters:ids,keyforms:[],interpolation:'linear'} : {parameter:ids[0],keys:[],interpolation:'linear'}; list.push(b) }
      delete b.generatedBy
      const keys = multi ? b.keyforms : b.keys, value = multi ? {inputs:copy(op.inputs),offsets:copy(op.offsets)} : {input:op.input,offsets:copy(op.offsets)}
      const at = keys.findIndex(k => multi ? ids.every(id => k.inputs[id] === op.inputs[id]) : k.input === op.input)
      if (at < 0) keys.push(value); else keys[at] = value
      if (!multi) keys.sort((a,b) => a.input-b.input)
    }
    else if (op.type === 'remove_keyform') {
      const p=part(m,op.id),ids=op.parameters||[op.parameter],multi=ids.length>1,field=multi?'multiBindings':'bindings',list=p.artMesh[field]||[]
      for(const b of list)if(multi?JSON.stringify(b.parameters)===JSON.stringify(ids):b.parameter===ids[0]) { const key=multi?'keyforms':'keys';b[key]=b[key].filter(k=>multi?!ids.every(id=>k.inputs[id]===op.inputs[id]):k.input!==op.input) }
      p.artMesh[field]=list.filter(b=>(b.keys||b.keyforms).length)
    }
    else if (op.type === 'bind_transform') { const p = part(m,op.id); if (!Object.hasOwn(DEFAULT_TRANSFORM,op.binding.property)) fail('绑定目标属性无效'); p.bindings ||= []; p.bindings = p.bindings.filter(b => b.parameter !== op.binding.parameter || b.property !== op.binding.property); p.bindings.push(copy(op.binding)) }
    else if (op.type === 'remove_binding') { const p = part(m,op.id); p.bindings = (p.bindings || []).filter(b => b.parameter !== op.parameter || b.property !== op.property) }
    else if (op.type === 'upsert_parameter') { const at = m.rig.parameters.findIndex(p => p.id === op.value.id); if (at < 0) m.rig.parameters.push(copy(op.value)); else m.rig.parameters[at] = copy(op.value) }
    else if (op.type === 'upsert_deformer') { const at = m.rig.deformers.findIndex(d => d.id === op.value.id); if (at < 0) m.rig.deformers.push(copy(op.value)); else m.rig.deformers[at] = copy(op.value) }
    else if (op.type === 'remove_deformer') { m.rig.deformers = m.rig.deformers.filter(d => d.id !== op.id); for (const p of m.rig.parts) if (p.deformerId === op.id) p.deformerId = null; for (const d of m.rig.deformers) if (d.parentId === op.id) d.parentId = null }
    else if (['upsert_expression','upsert_motion','upsert_physics'].includes(op.type)) { const rows = op.type === 'upsert_expression' ? m.expressions : op.type === 'upsert_motion' ? m.motions : m.rig.physics.chains; const at = rows.findIndex(x => x.id === op.value.id); if (at < 0) rows.push(copy(op.value)); else rows[at] = copy(op.value) }
    else if (['remove_expression','remove_motion','remove_physics'].includes(op.type)) { const rows = op.type === 'remove_expression' ? m.expressions : op.type === 'remove_motion' ? m.motions : m.rig.physics.chains; const at = rows.findIndex(x => x.id === op.id); if (at >= 0) rows.splice(at,1) }
    else fail('未知模型编辑操作：' + op.type)
  }
  return validateModel(m,imageIds)
}

export function autoRig(source) {
  const m = copy(source), r = m.rig, w = r.stage.width, h = r.stage.height
  const face = r.parts.find(p=>p.role==='face'), origin = face ? {x:face.transform.x,y:face.transform.y} : {x:w/2,y:h*.3}
  const roots = [{ id: 'body-root', name: '身体跟随', kind: 'rotate', parentId: null, transform: {...DEFAULT_TRANSFORM}, origin: {x:w/2,y:h*.75}, bindings: [{parameter:'ParamBodyAngleX',property:'rotation',keys:[{input:-30,value:-3},{input:0,value:0},{input:30,value:3}]},{parameter:'ParamBreath',property:'scaleY',keys:[{input:0,value:0},{input:1,value:.008}]}] }, { id: 'head-root', name: '头部旋转', kind: 'rotate', parentId: 'body-root', transform: {...DEFAULT_TRANSFORM}, origin, bindings: [{parameter:'ParamAngleZ',property:'rotation',keys:[{input:-30,value:-12},{input:0,value:0},{input:30,value:12}]}] }]
  roots[0].bindings.push({parameter:'ParamBodyAngleY',property:'scaleY',keys:[{input:-30,value:-.015},{input:0,value:0},{input:30,value:.01}]},{parameter:'ParamBodyAngleZ',property:'rotation',keys:[{input:-10,value:-4},{input:0,value:0},{input:10,value:4}]})
  for(const d of roots)if(!r.deformers.some(x=>x.id===d.id))r.deformers.push(d)
  rigSemanticParts(m, origin)
  if (!m.expressions.length) m.expressions = [{id:'smile',name:'微笑',values:{ParamMouthSmile:1,ParamAngleZ:5}},{id:'surprise',name:'惊讶',values:{ParamMouthOpen:.8,ParamEyeLOpen:1,ParamEyeROpen:1}},{id:'shy',name:'害羞',values:{ParamAngleX:-12,ParamAngleZ:-7,ParamEyeLOpen:.65,ParamEyeROpen:.65}}]
  if (!m.motions.length) m.motions = [{id:'greeting',name:'轻轻点头',duration:2200,loop:false,tracks:[{parameter:'ParamAngleY',keys:[{at:0,value:0},{at:.35,value:-15},{at:.7,value:6},{at:1,value:0}]}]}]
  return validateModel(m)
}
export function sampleMotion(motion,time) {
  const at = motion.loop ? ((time % motion.duration)+motion.duration)%motion.duration/motion.duration : Math.max(0,Math.min(1,time/motion.duration)), values = {}
  for (const track of motion.tracks) { const keys = track.keys; let a=keys[0], b=keys.at(-1); if (at <= a.at) { values[track.parameter]=a.value; continue } if (at >= b.at) { values[track.parameter]=b.value; continue } for (let i=1;i<keys.length;i++) if (at <= keys[i].at) { a=keys[i-1];b=keys[i];break } let t=(at-a.at)/(b.at-a.at); if(a.easing==='hold')t=0;else if(a.easing==='smooth')t=t*t*(3-2*t); values[track.parameter]=a.value+(b.value-a.value)*t }
  return values
}
export function inspectModel(m) {
  const issues = []; if (!m.rig.parts.length) issues.push('模型还没有部件'); if (m.rig.parts.length === 1) issues.push('只有一个部件，建议拆出眼睛、嘴巴和头发以获得独立演出')
  const counts = {parts:m.rig.parts.length,vertices:0,triangles:0,keyforms:0}
  for (const p of m.rig.parts) { if (!p.artMesh) continue; counts.vertices+=p.artMesh.vertices.length;counts.triangles+=p.artMesh.triangles.length/3;counts.keyforms+=(p.artMesh.bindings||[]).reduce((n,b)=>n+b.keys.length,0)+(p.artMesh.multiBindings||[]).reduce((n,b)=>n+b.keyforms.length,0) }
  const findings=[],add=(code,message,part,poseId)=>findings.push({code,message,partId:part?.id||'',poseId:poseId||''})
  for (const role of ['eye-left','eye-right']) { const p=m.rig.parts.find(p=>p.role===role&&p.visible);if(p&&!m.rig.parts.some(p=>p.role===role+'-closed'&&p.visible))add('missing-closed-eye',p.name+'缺少闭眼素材，目前使用缩放代替闭眼',p,'blink') }
  const mouth=m.rig.parts.find(p=>p.role==='mouth'&&p.visible)
  if(mouth&&!m.rig.parts.some(p=>p.role==='mouth-open'&&p.visible))add('missing-open-mouth','缺少独立张嘴素材，建议补画后检查嘴型',mouth,'mouth')
  for(const p of m.rig.parts.filter(p=>p.role?.startsWith('hair')&&p.visible))if(!m.rig.physics.enabled||!m.rig.physics.chains.some(c=>c.enabled&&c.targetPartIds.includes(p.id)))add('missing-hair-physics',p.name+'没有启用摆动物理',p,'hair')
  const poses=inspectionPoses.map(pose=>{
    const before=findings.length
    for(const p of m.rig.parts){
      const a=m.rig.assets.find(a=>a.id===p.assetId);if(!p.artMesh||!a)continue
      const mesh=resolveArtMesh(p,a.width,a.height,inspectionValues(m,pose.id));if(!mesh){add('invalid-mesh',p.name+'的网格不能渲染',p,pose.id);continue}
      const vertices=mesh.vertices,area=(points,i)=>{const [a,b,c]=p.artMesh.triangles.slice(i,i+3).map(n=>points[n]);return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)}
      if(vertices.some(v=>!finite(v.x)||!finite(v.y)))add('invalid-vertex',p.name+'出现无效顶点',p,pose.id)
      else for(let i=0;i<p.artMesh.triangles.length;i+=3){const base=area(p.artMesh.vertices,i);if(Math.abs(base)>1e-4&&area(vertices,i)*Math.sign(base)<Math.abs(base)*.025){add('folded-mesh',p.name+'在「'+pose.name+'」发生网格翻折或挤压',p,pose.id);break}}
    }
    return {...pose,issueCount:findings.length-before}
  })
  issues.push(...findings.map(f=>f.message))
  return {counts,issues:[...new Set(issues)],findings,poses}
}
export { DEFAULT_TRANSFORM, defaultWarpDeformer }
