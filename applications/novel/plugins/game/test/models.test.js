import test from 'node:test'
import assert from 'node:assert/strict'
import { blankModel, addImagePart, autoRig, validateModel, applyModelEdits, modelSummary, defaults, sampleMotion, inspectModel } from '../live2d/document.js'
import { resolveArtMesh, evaluateRigParts, resolveRigFrame } from '../live2d/vendor/standrig/runtime.js'
import { inspectionValues } from '../live2d/poses.js'
import { actorParameters } from '../live2d/renderer.js'
import { createModelController, registerModelTools } from '../live2d/controller.js'
import { blankProject, upgradeProject } from '../model.js'
import { initialState, advance, restoreCheckpoint } from '../engine.js'
import { packageBytes, importPackage } from '../package.js'

function fixture() {
  const m = blankModel('角色', 'model-one', 512, 768)
  for (const role of ['face','eye-left','mouth','hair-front','torso']) addImagePart(m, { id: 'image', name: role, width: 120, height: 180 }, role)
  m.revision = 1
  return autoRig(m)
}
test('模型编辑整批验证，锁定、层级循环、关键形越界和悬空顶点不会破坏原文档', () => {
  const m = fixture(), id = m.rig.parts[0].id, original = structuredClone(m)
  assert.throws(() => applyModelEdits(m, [{type:'rename',name:'不应写入'},{type:'set_keyform',id,parameter:'ParamAngleX',input:40,offsets:[]}]), /越界/)
  assert.deepEqual(m, original)
  const locked = applyModelEdits(m,[{type:'set_part',id,patch:{locked:true}}])
  assert.throws(() => applyModelEdits(locked,[{type:'transform',id,patch:{x:99}}]), /锁定/)
  assert.throws(() => applyModelEdits(m,[{type:'set_part',id,patch:{parentId:id}}]), /循环/)
  assert.throws(() => applyModelEdits(m,[{type:'set_keyform',id,parameter:'ParamAngleX',input:0,offsets:[{vertexId:'missing',x:0,y:0}]}]), /顶点/)
  const removed = applyModelEdits(m,[{type:'remove_vertex',id,vertexId:m.rig.parts[0].artMesh.vertices[0].id}]); validateModel(removed)
  assert.equal(removed.rig.parts[0].artMesh.vertices.length,m.rig.parts[0].artMesh.vertices.length-1)
})

test('剧情动态角色状态进入检查点，表情动作和覆盖参数按顺序合成', () => {
  const m = fixture(), p = upgradeProject(blankProject('动态角色','test-project')), scene = p.scenes[0]
  p.assets = [{id:'image',name:'立绘',kind:'image',mime:'image/png',size:3}]; p.models = [modelSummary(m)]
  p.cast = [{id:'girl',name:'角色',portraitId:'image',modelId:m.id,color:'#fff'}]
  scene.commands = [{id:'show',type:'show',characterId:'girl',expressionId:'',x:50,y:0,scale:1,opacity:1,duration:0},{id:'pose',type:'model',characterId:'girl',expressionId:'shy',motionId:'greeting',parameters:{ParamAngleX:9},idle:true},{id:'say',type:'say',speakerId:'girl',text:'你好'}]
  const state = advance(p,initialState(p)), restored = restoreCheckpoint(p,{revision:p.revision,state:structuredClone(state)})
  assert.deepEqual(restored.stage.portraits.girl.modelState,state.stage.portraits.girl.modelState)
  const values = actorParameters(m,restored.stage.portraits.girl.modelState,770,.8)
  assert.equal(values.ParamAngleX,9); assert.equal(values.ParamEyeLOpen,.65); assert.equal(values.ParamMouthOpen,.8)
  assert.equal(sampleMotion(m.motions[0],770).ParamAngleY,-15)
  assert.notEqual(actorParameters(m,{idle:true},500).ParamBreath,actorParameters(m,{idle:true},1000).ParamBreath)
})

test('手工与 Agent 共用模型版本、撤销历史，冲突保留草稿且重做不会退回 revision', async () => {
  const model=fixture(), p={id:'project',assets:[{id:'image',kind:'image'}],models:[modelSummary(model)]}, cache=new Map(), tools=new Map();let server=structuredClone(model), conflict=false
  const c=createModelController({getProject:()=>p,write:fn=>fn(),acceptProject:()=>{},notify:()=>{},storage:{setItem:(k,v)=>cache.set(k,v),getItem:k=>cache.get(k),removeItem:k=>cache.delete(k)},request:async(path,method,body)=>{if(method!=='PUT')return structuredClone(server);if(conflict)throw Error('模型已被其他页面修改');assert.equal(body.expectedRevision,server.revision);server=structuredClone(body.model);server.revision++;return{project:p,model:structuredClone(server)}}})
  try {
    registerModelTools({agent:{register:(d,fn)=>tools.set(d.name,fn)}},c,{getProject:()=>p,showStudio:()=>{}})
    await c.open(model.id);const before=c.version;c.edit([{type:'rename',name:'手工修改'}])
    await assert.rejects(tools.get('novel_model_edit')({modelId:model.id,localVersion:before,operations:[{type:'rename',name:'陈旧覆盖'}]}),/变化/)
    await tools.get('novel_model_edit')({modelId:model.id,localVersion:c.version,operations:[{type:'rename',name:'Agent 修改'}]})
    assert.equal(server.name,'Agent 修改');const revision=server.revision;c.history('undo');await c.save();assert.equal(server.name,'手工修改');assert.equal(server.revision,revision+1)
    c.history('redo');conflict=true;await assert.rejects(c.save(),/其他页面/);assert.equal(c.model.name,'Agent 修改');assert.equal(c.dirty,true);assert.ok(cache.size)
    c.preview({ParamAngleX:12});assert.equal(c.snapshot().preview.idle,false)
  } finally {c.dispose()}
})

test('作品包携带完整可编辑模型，独立重映射模型、纹理和生成阶段素材', async () => {
  const m=fixture(),p=upgradeProject(blankProject('往返','original'));m.sourceAssetId='image';m.generation={sourceAssetId:'image',segmentationAssetId:'image',repairAssetId:'image',featureAssetId:'image'}
  p.assets=[{id:'image',name:'图片',kind:'image',mime:'image/png',size:3}];p.models=[modelSummary(m)];p.cast=[{id:'girl',name:'角色',color:'#fff',portraitId:'image',modelId:m.id}]
  const bytes=await packageBytes(p,async path=>path.includes('/assets/')?new Uint8Array([1,2,3]):new TextEncoder().encode(JSON.stringify(m)))
  let created=blankProject('副本','copy'),savedModel
  const imported=await importPackage(new File([bytes],'test.novel.zip'),async(path,method,body)=>{
    if(path==='/api/novel/projects')return structuredClone(created)
    if(path.endsWith('/assets')){created.assets=[{...p.assets[0],id:'new-image'}];created.revision++;return structuredClone(created)}
    if(path.endsWith('/models')){savedModel=validateModel({...body.model,id:'new-model',revision:1},new Set(['new-image']));created.models=[modelSummary(savedModel)];created.revision++;return{project:structuredClone(created),model:savedModel}}
    if(method==='PUT')return body;throw Error(path)
  })
  assert.equal(imported.cast[0].modelId,'new-model');assert.equal(savedModel.rig.assets[0].src,'asset:new-image');assert.equal(savedModel.sourceAssetId,'new-image');assert.equal(savedModel.generation.repairAssetId,'new-image');assert.equal(savedModel.generation.featureAssetId,'new-image');assert.deepEqual(savedModel.rig.parts,JSON.parse(JSON.stringify(m.rig.parts)));assert.deepEqual(savedModel.motions,m.motions)
})

test('眼嘴素材在开合端点互斥，视线保留眼角，发梢运动不移动发根',()=>{
  const m=blankModel('素材绑定','variant-model',512,768)
  for(const role of ['face','eye-left','eye-right','eye-left-closed','eye-right-closed','mouth','mouth-open','hair-front','hair-back','accessory'])addImagePart(m,{id:'image',name:role,width:120,height:80},role)
  const built=autoRig(m),matrix={a:1,b:0,c:0,d:1,e:0,f:0},pose=id=>evaluateRigParts(built.rig,inspectionValues(built,id),matrix)
  for(const [id,shown,hidden]of [['neutral','eye-left','eye-left-closed'],['blink','eye-left-closed','eye-left'],['neutral','mouth','mouth-open'],['mouth','mouth-open','mouth']]){const states=pose(id),part=role=>built.rig.parts.find(p=>p.role===role);assert.equal(states.get(part(shown).id).opacity,1);assert.equal(states.get(part(hidden).id).opacity,0)}
  for(const role of ['eye-left','hair-front']){const p=built.rig.parts.find(p=>p.role===role),param=role==='eye-left'?'ParamEyeBallX':'ParamHairFront',mesh=resolveArtMesh(p,120,80,{...defaults(built),[param]:1});assert.equal(mesh.vertices[0].x,p.artMesh.vertices[0].x);assert.ok(mesh.vertices.some((v,i)=>v.x!==p.artMesh.vertices[i].x))}
  assert.ok(built.rig.physics.chains.find(c=>c.parameterOutput?.parameter==='ParamRibbon'))
  const frame=resolveRigFrame(built.rig,{...defaults(built),ParamAngleX:25},matrix,{physicsTime:2});assert.ok(Number.isFinite(frame.values.ParamHairFront));assert.notEqual(frame.values.ParamHairFront,0)
  assert.deepEqual(inspectModel(built).issues,[])
})

test('重新自动绑定保留手工关键形、锁定部件和自定义层级',()=>{
  const m=fixture(),p=m.rig.parts[0],binding=p.artMesh.multiBindings[0],edited=applyModelEdits(m,[{type:'set_keyform',id:p.id,parameters:binding.parameters,inputs:{ParamAngleX:30,ParamAngleY:30},offsets:[{vertexId:p.artMesh.vertices[0].id,x:7,y:9}]}])
  const hair=edited.rig.parts.find(p=>p.role==='hair-front');hair.locked=true
  edited.rig.parts[0].deformerId='body-root'
  const result=autoRig(edited)
  assert.deepEqual(result.rig.parts[0].artMesh.multiBindings,edited.rig.parts[0].artMesh.multiBindings)
  assert.equal(result.rig.parts[0].deformerId,'body-root')
  assert.deepEqual(result.rig.parts.find(p=>p.id===hair.id),hair)
})

test('诊断定位缺少素材与翻折姿态，Agent 检查冻结并在编辑后清空返修记录',async()=>{
  const m=fixture(),p=m.rig.parts[0],v=p.artMesh.vertices[0];p.artMesh.bindings=[{parameter:'ParamMouthOpen',keys:[{input:0,offsets:[]},{input:1,offsets:[{vertexId:v.id,x:10000,y:10000}]}]}]
  const report=inspectModel(m);assert.ok(report.findings.some(f=>f.code==='missing-closed-eye'));assert.ok(report.findings.some(f=>f.code==='folded-mesh'&&f.poseId==='mouth'&&f.partId===p.id))
  const project={id:'project',assets:[{id:'image',kind:'image'}],models:[modelSummary(m)]},c=createModelController({getProject:()=>project,request:async()=>m,write:fn=>fn(),acceptProject:()=>{},notify:()=>{}}),tools=new Map()
  try{registerModelTools({agent:{register:(d,fn)=>tools.set(d.name,fn)}},c,{getProject:()=>project,showStudio:()=>{}});await c.open(m.id);const result=tools.get('novel_model_check')({poseId:'blink',verdict:'repair',note:'检查眼缘'});assert.equal(result.preview.parameters.ParamEyeLOpen,0);assert.equal(result.preview.idle,false);assert.equal(result.preview.playing,false);assert.equal(c.dirty,false);assert.equal(result.preview.poseReviews.blink.verdict,'repair');c.edit([{type:'rename',name:'返修中'}]);assert.deepEqual(c.state.poseReviews,{});assert.throws(()=>c.checkPose('missing'),/不存在/)}finally{c.dispose()}
})
