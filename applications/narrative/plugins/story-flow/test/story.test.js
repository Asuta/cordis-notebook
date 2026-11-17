import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { settle, owner } from '../../project/test/helpers.js'
import { validateRuntime } from '../../project/model.js'
import { installStory } from '../story.js'
import flow from '../client.js'
import { mountScene } from '../../scene-ui/renderer.js'
import { lastTrainProject } from '../../project/last-train.js'

async function setup(t) {
  const f=await setupScene(t),ctx=owner(),story=installStory(ctx,f.engine),ui={navigate:async()=>{}}
  f.engine.onEvent(ctx,event=>event==='play.start'?f.engine.go(f.engine.runtime.nodeId):undefined)
  f.scene.register(ctx,{type:'story-flow',visual:false,singleton:true,fields:{},events:['stage','line','choices','chapter','history'],methods:{advance:{fields:{},run:story.advance},choose:{fields:{id:{kind:'string',label:'ID',required:true}},run:(_,v)=>story.choose(v.id)}}})
  f.engine.update(p=>{
    p.variables=[{id:'trust',name:'信任',initial:0,min:0,max:3}]
    const node=(id,type,lines)=>({id,type,title:id,stage:{background:'station',characterId:'lin',expression:'neutral',position:60,scale:100},lines:lines.map(text=>({speaker:'lin',text})),choices:[]})
    p.nodes=[node('opening','story',['第一句完整对白','第二句完整对白']),node('promise','ending',['明年，再一起看星星。']),node('farewell','ending',['愿你一路平安。'])]
    p.nodes[0].choices=[{id:'stay',text:'约定',target:'promise',actions:[{type:'add-variable',variable:'trust',value:1}]},{id:'leave',text:'告别',target:'farewell',actions:[]}]
    p.startNodeId='opening';p.composition={schemaVersion:1,startSceneId:'main',dependencies:[],prefabs:[],scenes:[{id:'main',name:'故事',objects:[{id:'novel',type:'story-flow',props:{},layout:{grow:1}}],connections:[]}]}
  })
  f.engine.select({nodeId:'opening'})
  f.ctx.effect(()=>()=>ctx.dispose())
  return {...f,story,ui,storyOwner:ctx}
}

test('顺序对白、选项闸门、分支变量和两种结局，重开不污染作品',async t=>{
  const f=await setup(t),original=structuredClone(f.engine.project)
  await f.engine.play()
  assert.equal(f.engine.runtime.text.text,'第一句完整对白')
  await assert.rejects(f.scene.call('novel','choose',{id:'stay'}),/读完/)
  await f.scene.call('novel','advance');assert.equal(f.engine.runtime.lineIndex,1)
  await f.scene.call('novel','advance');assert.equal(f.engine.runtime.story.awaiting,true)
  await Promise.all([f.scene.call('novel','choose',{id:'stay'}),f.scene.call('novel','choose',{id:'stay'})])
  assert.equal(f.engine.runtime.variables.trust,1)
  assert.equal(f.engine.runtime.nodeId,'promise')
  await f.scene.call('novel','advance');assert.equal(f.engine.runtime.ended,true)
  assert.equal(f.engine.runtime.transcript.length,4)
  await f.engine.play();await f.story.advance();await f.story.advance();await f.story.choose('leave');await f.story.advance()
  assert.equal(f.engine.runtime.nodeId,'farewell');assert.equal(f.engine.runtime.ended,true);assert.equal(f.engine.runtime.variables.trust,0)
  assert.deepEqual(f.engine.project,{...original,revision:f.engine.project.revision})
})

test('分支等待、读档恢复和错误目标保持原进度',async t=>{
  const f=await setup(t)
  f.engine.update(p=>{p.nodes[0].choices[0].target='missing'})
  await f.engine.play();await f.story.advance();await f.story.advance()
  const snapshot=structuredClone(f.engine.runtime)
  await assert.rejects(f.story.choose('stay'),/有效的剧情/)
  assert.deepEqual(f.engine.runtime,snapshot)
  f.engine.stop();f.engine.restoreRuntime(snapshot)
  assert.equal(f.engine.runtime.story.awaiting,true)
  await f.story.choose('leave')
  assert.equal(f.engine.runtime.text.text,'愿你一路平安。')
  assert.equal(f.engine.runtime.transcript.length,4)
  assert.throws(()=>validateRuntime({...snapshot,lineIndex:0},f.engine.project),/剧情选项进度/)
})

test('条件过滤、无可用选项报错和空白章节能推进',async t=>{
  const f=await setup(t)
  f.engine.update(p=>{for(const c of p.nodes[0].choices)c.condition={type:'variable',variable:'trust',op:'gte',value:1};p.nodes[0].lines=[]})
  await f.engine.play()
  assert.deepEqual(f.story.choices(),[])
  await assert.rejects(f.story.advance(),/没有满足条件/)
  await assert.rejects(f.story.choose('stay'),/不可用/)
  f.engine.stop();f.engine.update(p=>{p.nodes[0].choices=[];p.nodes[0].next='promise'})
  await f.engine.play();await f.story.advance();assert.equal(f.engine.runtime.nodeId,'promise')
})
