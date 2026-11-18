import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setupScene } from '../../scene-runtime/test/helpers.js'
import { owner } from '../../project/test/helpers.js'
import flow from '../client.js'

test('读档、重复推进和显式同步不重复触发等待或结局奖励',async t=>{
  const f=await setup(t)
  f.engine.update(p=>{const s=p.composition.scenes[0];s.objects.push({type:'counter',id:'reward',props:{}});for(const event of ['waiting','ended'])s.connections.push({id:event,source:'novel',event,target:'reward',method:'add',args:{amount:1}})})
  await f.engine.play();await f.advance();await f.advance()
  async function verify(count){
    const snapshot=structuredClone(f.engine.runtime);assert.equal(f.scene.runtime.state('reward').value,count)
    f.engine.stop();f.engine.restoreRuntime(snapshot);await new Promise(resolve=>setImmediate(resolve))
    await f.scene.call('novel','sync');await f.advance();assert.equal(f.scene.runtime.state('reward').value,count)
  }
  await verify(1);await f.choose('stay');await f.advance();await verify(2)
})

test('结局连接可以启动同一个流程',async t=>{
  const f=await setup(t)
  f.engine.update(p=>p.composition.scenes[0].connections.push({id:'restart',source:'novel',event:'ended',target:'novel',method:'start',args:{nodeId:'opening'}}))
  await f.engine.play();await f.advance();await f.advance();await f.choose('stay');await f.advance()
  assert.equal(f.r().nodeId,'opening');assert.equal(f.r().ended,false);assert.equal(f.r().transcript.length,1)
})

test('章节事件只随进入触发，读档直接恢复显示对象',async t=>{
  const f=await setup(t)
  f.engine.update(p=>{const s=p.composition.scenes[0];for(const id of ['chapters','views'])s.objects.push({id,type:'counter'});for(const [id,event] of [['chapters','chapter'],['views','line']])s.connections.push({id,source:'novel',event,target:id,method:'add',args:{amount:1}})})
  await f.engine.play();await f.advance()
  const snapshot=structuredClone(f.engine.runtime)
  f.engine.restoreRuntime(snapshot);await new Promise(resolve=>setImmediate(resolve))
  assert.equal(f.scene.runtime.state('chapters').value,1);assert.equal(f.scene.runtime.state('views').value,2)
  await f.advance();await f.choose('stay');assert.equal(f.scene.runtime.state('chapters').value,2)
})

test('父对象暂停的定向试读被拒绝并保留当前进度',async t=>{
  const f=await setup(t)
  f.engine.update(p=>p.composition.scenes[0].objects.push({id:'paused',type:'container',paused:true},{id:'hidden-flow',type:'story-flow',parent:'paused',props:{storyId:'main-story'}}))
  await f.engine.play();await f.advance();const before=f.scene.runtime
  await assert.rejects(f.engine.play({sceneId:'main',objectId:'hidden-flow',nodeId:'promise'}),/停用或暂停/)
  assert.equal(f.scene.runtime,before);assert.equal(f.r().lineIndex,1)
})

async function setup(t){
  const f=await setupScene(t),ctx=owner();Object.assign(ctx,{narrative:f.engine,sceneRuntime:f.scene});flow(ctx);f.ctx.effect(()=>()=>ctx.dispose())
  f.engine.update(p=>{
    const node=(id,type,lines)=>({id,type,title:id,stage:{background:'station',characterId:'lin',expression:'neutral',position:60,scale:100},lines:lines.map(text=>({speaker:'lin',text})),choices:[]})
    const nodes=[node('opening','story',['第一句完整对白','第二句完整对白']),node('promise','ending',['明年，再一起看星星。']),node('farewell','ending',['愿你一路平安。'])]
    nodes[0].choices=[{id:'stay',text:'约定',target:'promise',actions:[{type:'add-variable',variable:'trust',value:1}]},{id:'leave',text:'告别',target:'farewell',actions:[]}]
    p.stories=[{id:'main-story',name:'测试剧情',startNodeId:'opening',nodes,variables:[{id:'trust',name:'信任',initial:0,min:0,max:3}],rules:[]}]
    p.composition={schemaVersion:1,startSceneId:'main',dependencies:[],prefabs:[],scenes:[{id:'main',name:'故事',objects:[{id:'novel',type:'story-flow',props:{storyId:'main-story'}}],connections:[]}]}
  })
  const r=()=>f.scene.runtime.state('novel'),advance=()=>f.scene.call('novel','advance'),choose=id=>f.scene.call('novel','choose',{id})
  return {...f,r,advance,choose}
}
test('顺序对白、选项闸门、分支变量和结局，重开不污染作品',async t=>{
  const f=await setup(t),original=structuredClone(f.engine.project);await f.engine.play()
  assert.equal(f.r().text.text,'第一句完整对白');await assert.rejects(f.choose('stay'),/读完/)
  await f.advance();assert.equal(f.r().lineIndex,1);await f.advance();assert.equal(f.r().story.awaiting,true)
  await Promise.all([f.choose('stay'),f.choose('stay')]);assert.equal(f.r().variables.trust,1);assert.equal(f.r().nodeId,'promise')
  await f.advance();assert.equal(f.r().ended,true);assert.equal(f.r().transcript.length,4)
  await f.engine.play();await f.advance();await f.advance();await f.choose('leave');await f.advance();assert.equal(f.r().nodeId,'farewell');assert.equal(f.r().variables.trust,0)
  assert.deepEqual(f.engine.project,{...original,revision:f.engine.project.revision});assert.equal(f.engine.runtime.nodeId,undefined)
})
test('坏目标不提交变量；存档恢复不重复对白，损坏位置保留当前进度',async t=>{
  const f=await setup(t);f.engine.update(p=>p.stories[0].nodes[0].choices[0].target='missing')
  await f.engine.play();await f.advance();await f.advance();const snapshot=structuredClone(f.engine.runtime)
  await assert.rejects(f.choose('stay'),/有效的剧情/);assert.deepEqual(f.engine.runtime,snapshot)
  f.engine.stop();f.engine.restoreRuntime(snapshot);await f.choose('leave');assert.equal(f.r().transcript.length,4)
  const before=structuredClone(f.engine.runtime),bad=structuredClone(snapshot);bad.objects.states['main/novel'].lineIndex=0
  assert.throws(()=>f.engine.restoreRuntime(bad),/存档位置/);assert.deepEqual(f.engine.runtime,before)
})
test('条件过滤、空白章节和空白结局仍可推进',async t=>{
  const f=await setup(t);f.engine.update(p=>{const n=p.stories[0].nodes[0];n.lines=[];for(const c of n.choices)c.condition={type:'variable',variable:'trust',op:'gte',value:1}})
  await f.engine.play();await assert.rejects(f.advance(),/没有满足条件/);await assert.rejects(f.choose('stay'),/不可用/)
  f.engine.stop();f.engine.update(p=>{const n=p.stories[0].nodes[0];n.choices=[];n.next='promise'})
  await f.engine.play();await f.advance();assert.equal(f.r().nodeId,'promise')
})
test('同一剧本的两个流程实例进度隔离，定向试读和跨场景存档保持独立',async t=>{
  const f=await setup(t)
  f.engine.update(p=>{p.composition.scenes[0].objects.push({id:'second',type:'story-flow',props:{storyId:'main-story'}});p.composition.scenes.push({id:'room',name:'另一个房间',objects:[{id:'third',type:'story-flow',props:{storyId:'main-story'}}],connections:[]})})
  await f.engine.play();await f.advance();assert.equal(f.r().lineIndex,1);assert.equal(f.scene.runtime.state('second').lineIndex,0)
  await f.advance();await f.choose('stay');assert.equal(f.scene.runtime.state('second').variables.trust,0)
  const before=structuredClone(f.engine.runtime);f.engine.stop();f.engine.restoreRuntime(before)
  assert.equal(f.r().nodeId,'promise');assert.equal(f.scene.runtime.state('second').nodeId,'opening')
  await f.engine.play({sceneId:'main',objectId:'second',nodeId:'farewell',storyId:'main-story'})
  assert.equal(f.scene.runtime.state('second').nodeId,'farewell');assert.equal(f.r().nodeId,'opening')
  await f.engine.play({sceneId:'room',objectId:'third',nodeId:'farewell',storyId:'main-story'})
  assert.equal(f.scene.runtime.state('third').nodeId,'farewell');assert.equal(f.scene.runtime.state('third').transcript.length,1)
})
