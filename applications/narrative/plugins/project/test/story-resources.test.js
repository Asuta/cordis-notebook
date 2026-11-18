import {setup} from './helpers.js'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {migrateStoryResources,validateProject,initialRuntime,validateRuntime} from './fixtures/story-model.js'
import {lastTrainProject} from '../../story-data/last-train.js'
import {templateProject} from '../demo.js'
import {editComposition,expandScene} from '../composition.js'
import {builtInPrefabs} from '../../story-data/story-composition.js'

function oldTemplate(title,id){const {stories:[story],...p}=lastTrainProject(title,id);const {nodes,startNodeId,variables,rules}=story;return {...p,nodes,startNodeId,variables,rules}}

test('旧剧本只迁移一份资源，旧存档归属到对应流程，重复迁移幂等',()=>{
  const legacy=oldTemplate('旧剧本','legacy'),old=initialRuntime(legacy)
  old.story={awaiting:false};old.lineIndex=1;old.text={...legacy.nodes[0].lines[1]}
  old.transcript=[{id:'row',role:'narrator',name:'旁白',text:'已读内容'}]
  const p=migrateStoryResources(structuredClone(legacy)),once=structuredClone(p)
  assert.equal(p.nodes,undefined);assert.equal(p.startNodeId,undefined);assert.equal(p.stories.length,1)
  assert.deepEqual(p.stories[0].nodes,legacy.nodes);assert.deepEqual(migrateStoryResources(p),once)
  const restored=validateRuntime(old,p);assert.equal(restored.nodeId,undefined)
  assert.equal(restored.objects.states['main/novel-flow'].lineIndex,1);assert.equal(restored.objects.states['main/novel-flow'].transcript.length,1)
  assert.deepEqual(validateRuntime(restored,p),restored)
})
test('没有剧情资源的作品及旧会客厅存档可保存和恢复',()=>{
  const p=templateProject('salon',undefined,'salon');assert.equal(p.stories,undefined);assert.equal(p.nodes,undefined)
  assert.doesNotThrow(()=>validateProject(p));assert.deepEqual(initialRuntime(p),{busy:false,error:''})
  const old={...initialRuntime(p),nodeId:'main',lineIndex:0,objects:{schemaVersion:1,sceneId:'main',states:{'main/day':{value:3}},flags:{}}}
  assert.deepEqual(validateRuntime(old,p),{busy:false,error:'',objects:old.objects})
})
test('每份资源独立校验起点、变量和重复ID；组合实例内部连接重写且可拆开',()=>{
  const p=lastTrainProject(undefined,'test')
  const bad=structuredClone(p);bad.stories[0].startNodeId='missing';assert.throws(()=>validateProject(bad),/起始节点/)
  bad.stories=[p.stories[0],p.stories[0]];assert.throws(()=>validateProject(bad),/资源列表/)
  let doc=p.composition;const prefab=builtInPrefabs(p.stories[0].id).find(p=>p.id==='story-stage')
  doc=editComposition(doc,{op:'add-prefab',prefab});for(const id of ['first','second'])doc=editComposition(doc,{op:'instantiate',id,prefabId:prefab.id,prefabVersion:1})
  const expanded=expandScene(doc,'main');assert.ok(expanded.connections.some(c=>c.source==='first--stage-dialogue'&&c.target==='first--stage-flow'))
  assert.ok(!expanded.connections.some(c=>c.source.startsWith('first--')&&c.target.startsWith('second--')))
  doc=editComposition(doc,{op:'unpack',id:'first'});assert.ok(doc.scenes[0].objects.some(o=>o.id==='first--stage-flow'));assert.ok(doc.scenes[0].objects.find(o=>o.id==='second').prefab)
})

test('旧存档无法唯一定位流程时保留当前运行进度',async t=>{
  const f=await setup(t), legacy=oldTemplate('旧作品',f.engine.project.id)
  const p=migrateStoryResources(structuredClone(legacy)), scene=p.composition.scenes[0]
  scene.objects.push({...structuredClone(scene.objects.find(o=>o.type==='story-flow')),id:'other-flow'})
  f.engine.update(next=>Object.assign(next,p));await f.engine.play()
  const running=f.engine.runtime
  assert.throws(()=>f.engine.restoreRuntime(initialRuntime(legacy)),/无法确定/)
  assert.equal(f.engine.runtime,running)
})
