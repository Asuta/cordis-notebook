import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setupScene} from '../../scene-runtime/test/helpers.js'
import {owner,settle} from '../../project/test/helpers.js'
import {lastTrainProject} from '../../story-data/last-train.js'
import {validateProject,migrateStoryResources} from '../../project/test/fixtures/story-model.js'
import {mountScene} from '../../scene-ui/renderer.js'
import {ObjectRuntime,validateScene,validateFields} from '../../scene-runtime/runtime.js'
import flow from '../client.js'
import background from '../../background-view/client.js'
import character from '../../character-view/client.js'
import dialogue from '../../dialogue-view/client.js'
import choices from '../../choice-list/client.js'
import history from '../../history-view/client.js'
import auto from '../../auto-advance/client.js'
import controls from '../../playback-controls/client.js'
import sound from '../../sound/client.js'
const flush=async()=>{for(let i=0;i<4;i++)await settle()}
async function setup(t){
 const f=await setupScene(t),ctx=owner();Object.assign(ctx,{narrative:f.engine,sceneRuntime:f.scene,narrativeUI:{navigate:async()=>{}}})
 for(const plugin of [flow,background,character,dialogue,choices,history,auto,controls])plugin(ctx)
 f.ctx.effect(()=>()=>ctx.dispose())
 f.engine.update(p=>Object.assign(p,migrateStoryResources(lastTrainProject(undefined,p.id)),{revision:p.revision}));f.engine.select({nodeId:'arrival'})
 return {...f,ctx}
}
test('独立对象通过事件完成8条路线，读档恢复不重复对白及变量',async t=>{
 const f=await setup(t);await f.engine.play();await flush();assert.deepEqual(f.scene.validate(),[])
 assert.equal(f.scene.runtime.state('novel-dialogue').text,f.scene.runtime.state('novel-flow').text.text)
 const results=[]
 async function walk(decisions=0){for(let i=0;i<300;i++){
  await flush()
  if(f.scene.runtime.state('novel-flow').ended){results.push([f.scene.runtime.state('novel-flow').nodeId,decisions]);return}
  if(f.scene.runtime.state('novel-flow').story.awaiting){
   const snapshot=structuredClone(f.engine.runtime),items=f.scene.runtime.state('novel-choices').items
   assert.equal(items.length,2)
   for(const c of items){f.engine.restoreRuntime(snapshot);await flush();assert.equal(f.scene.runtime.state('novel-flow').transcript.length,snapshot.objects.states['main/novel-flow'].transcript.length);await f.scene.call('novel-choices','choose',{id:c.id});await walk(decisions+1)}return
  }
  await f.scene.call('novel-dialogue','advance');await flush();await f.scene.call('novel-dialogue','advance')
 }assert.fail('未结束')}
 await walk();assert.equal(results.length,8);assert.deepEqual(new Set(results.map(r=>r[0])),new Set(['promise','quiet']));assert.ok(results.every(r=>r[1]===3));assert.deepEqual(f.toasts,[])
})
test('显示插件不安装剧情插件也可复用，两实例隔离、选项输出给计数器',async t=>{
 const f=await setupScene(t),ctx=owner();Object.assign(ctx,{narrative:f.engine,sceneRuntime:f.scene});for(const p of [dialogue,choices,background,character])p(ctx);f.ctx.effect(()=>()=>ctx.dispose())
 f.engine.update(p=>{p.composition={schemaVersion:1,startSceneId:'main',dependencies:[],prefabs:[],scenes:[{id:'main',name:'调查',objects:[{id:'a',type:'dialogue-view',props:{text:'线索',speed:0}},{id:'b',type:'dialogue-view',props:{text:'物品介绍'}},{id:'options',type:'choice-list',props:{items:[]}},{id:'count',type:'counter',props:{}}],connections:[{id:'pick',source:'options',event:'selected',target:'count',method:'add',args:{amount:1}}]}]}})
 await f.engine.play();await f.scene.call('a','present',{value:{speaker:'说明',text:'门没有上锁'}});assert.equal(f.scene.runtime.state('b').text,'物品介绍')
 await f.scene.call('options','present',{value:[{id:'door',text:'检查房门'}]});await Promise.all([f.scene.call('options','choose',{id:'door'}),f.scene.call('options','choose',{id:'door'})]);assert.equal(f.scene.runtime.state('count').value,1);assert.deepEqual(f.toasts,[])
})
test('真实渲染器中逐字、回看、全屏及卸载不残留推进',async t=>{
 const f=await setup(t),host=document.createElement('main');host.className='ne-app';document.body.append(host)
 const canvas=document.createElement("div");host.append(canvas);const view=mountScene(canvas,{scene:f.scene,engine:f.engine,ui:f.ctx.narrativeUI,design:()=>!f.scene.playing});t.after(()=>view.dispose())
 await f.engine.play();await flush();assert.ok(host.querySelector('[data-object-id="novel-character"]'))
 host.querySelector('.dialogue-next').click();await flush();assert.equal(host.querySelector('.dialogue-text').textContent,f.scene.runtime.state('novel-flow').text.text)
 host.querySelector('.dialogue-next').click();await flush();assert.equal(f.scene.runtime.state('novel-flow').lineIndex,1)
 host.querySelector('.history-view>button').click();await flush();assert.ok(host.querySelector('.history-dialog').open);assert.match(host.querySelector('.history-dialog').textContent,/雨刚停/)
 host.querySelector('.history-dialog>button').click();await flush()
 const fullscreen=[...host.querySelectorAll('.playback-controls button')].find(b=>b.textContent==='全屏');fullscreen.click();await flush();assert.ok(host.querySelector('.playback-focus[open]'));fullscreen.click();await flush();assert.equal(host.querySelector('.playback-focus'),null)
 view.dispose();const before=structuredClone(f.engine.runtime);t.mock.timers.tick(30000);await flush();assert.deepEqual(f.engine.runtime,before)
})
test('能力引用兼容不同类型，缺少目标允许编辑但禁止运行，JSON参数验证',async()=>{
 const types=new Map([['source',{type:'source',refs:{target:{methods:['present'],optional:true}},methods:{send:{run:a=>a.call('target','present',{value:{text:'线索'}})}}}],['other',{type:'other',methods:{present:{fields:{value:{kind:'json',label:'内容',required:true}},run:(a,v)=>a.set(v.value)}}}]])
 const scene={id:'main',objects:[{id:'a',type:'source',refs:{target:'b'}},{id:'b',type:'other'}],connections:[]};const runtime=new ObjectRuntime({scene,types});await runtime.invoke('a','send');assert.equal(runtime.state('b').text,'线索');runtime.dispose()
 delete scene.objects[0].refs.target;assert.doesNotThrow(()=>validateScene(scene,types));types.get('source').refs.target.optional=false;assert.throws(()=>validateScene(scene,types),/引用/);assert.doesNotThrow(()=>validateScene(scene,types,{allowMissing:true}));assert.throws(()=>validateFields({value:{kind:'json',label:'数据'}},{value:{n:NaN}}),/结构化/)
})
test('旧舞台迁移保留ID，迁移幂等',()=>{
 const p=lastTrainProject(undefined,'legacy');p.composition.scenes[0].objects=[{id:'novel',type:'story-player',props:{title:'旧作'},layout:{grow:1}}];p.composition.scenes[0].connections=[];p.composition.dependencies=[{id:'visual-novel',version:'1.0.0'}]
 migrateStoryResources(p);const once=structuredClone(p);validateProject(p);assert.deepEqual(p,once);assert.equal(p.composition.scenes[0].objects[0].id,'novel');assert.ok(p.composition.scenes[0].objects.some(o=>o.type==='dialogue-view'))
})

test('空白章节及空白结局通过画面继续，空白分支仍显示选项',async t=>{
 const f=await setup(t)
 f.engine.update(p=>{const n=p.stories[0].nodes[0];n.lines=[];n.choices=[];n.next='promise';p.stories[0].nodes.find(n=>n.id==='promise').lines=[]})
 const host=document.createElement('main');host.className='ne-app';document.body.append(host)
 const view=mountScene(host,{scene:f.scene,engine:f.engine,ui:f.ctx.narrativeUI});t.after(()=>view.dispose())
 await f.engine.play();await flush()
 assert.equal(f.scene.runtime.state('novel-flow').story.awaiting,false)
 assert.equal(host.querySelector('.dialogue-box').hidden,false)
 host.querySelector('.dialogue-next').click();await flush()
 assert.equal(f.scene.runtime.state('novel-flow').nodeId,'promise');assert.equal(f.scene.runtime.state('novel-flow').ended,false)
 host.querySelector('.dialogue-next').click();await flush()
 assert.equal(f.scene.runtime.state('novel-flow').ended,true);assert.match(host.querySelector('.playback-controls').textContent,/THE END/)
 f.engine.stop();f.engine.update(p=>{p.stories[0].nodes[0].choices=[{id:'end',text:'结束',target:'promise',actions:[]}]})
 await f.engine.play();await flush()
 assert.equal(f.scene.runtime.state('novel-flow').story.awaiting,true);assert.equal(host.querySelector('.dialogue-box').hidden,true)
 host.querySelector('.choice-list button').click();await flush();assert.equal(f.scene.runtime.state('novel-flow').nodeId,'promise')
 assert.deepEqual(f.toasts,[])
})

test('从同一章节重开后首句重新就绪并自动推进',async t=>{
 const f=await setup(t),host=document.createElement('main');host.className='ne-app';document.body.append(host)
 const view=mountScene(host,{scene:f.scene,engine:f.engine,ui:f.ctx.narrativeUI});t.after(()=>view.dispose())
 const state=id=>f.scene.runtime.state('novel-'+id)
 await f.engine.play();await flush()
 await f.scene.call('novel-dialogue','reveal');const key=state('dialogue').key,snapshot=structuredClone(f.engine.runtime)
 assert.equal(state('auto').ready,true)
 await f.scene.call('novel-auto','toggle');await f.scene.call('novel-flow','start',{nodeId:state('flow').nodeId});await flush()
 assert.equal(state('flow').lineIndex,0);assert.notEqual(state('dialogue').key,key)
 assert.equal(state('dialogue').revealed,false);assert.equal(state('auto').ready,false)
 await f.scene.call('novel-dialogue','reveal');assert.equal(state('auto').ready,true)
 t.mock.timers.tick(1800);await flush();assert.equal(state('flow').lineIndex,1)
 f.engine.restoreRuntime(snapshot);await flush();await f.scene.call('novel-flow','sync')
 assert.equal(state('dialogue').key,key);assert.equal(state('dialogue').revealed,true)
})

test('实际声音插件在重开、读档和迟到播放完成后与按钮状态一致',async t=>{
 const f=await setup(t),audios=[],previous=Object.getOwnPropertyDescriptor(globalThis,'Audio')
 class AudioStub{constructor(){this.paused=true;this.ready=Promise.withResolvers();audios.push(this)}play(){this.paused=false;return this.ready.promise}pause(){this.paused=true}removeAttribute(){}load(){}}
 Object.defineProperty(globalThis,'Audio',{configurable:true,value:AudioStub})
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'Audio',previous);else delete globalThis.Audio})
 const soundOwner=owner();Object.assign(soundOwner,{narrative:f.engine,narrativeUI:{registerToolbar(){},registerPanel(){}}});sound(soundOwner,{toast:()=>{}});t.after(()=>soundOwner.dispose())
 const host=document.createElement('main');host.className='ne-app';document.body.append(host)
 const view=mountScene(host,{scene:f.scene,engine:f.engine,ui:f.ctx.narrativeUI});t.after(()=>view.dispose())
 const music=()=>[...host.querySelectorAll('button')].find(b=>/^♫/.test(b.textContent))
 const start=async()=>{music().click();await flush();audios.at(-1).ready.resolve();await flush();assert.equal(music().textContent,'♫ 静音');assert.equal(audios.at(-1).paused,false)}
 await f.engine.play();await flush();await start()
 const snapshot=structuredClone(f.engine.runtime)
 const button=music();[...host.querySelectorAll('button')].find(b=>b.textContent==='重新开始').click();await flush()
 assert.equal(music(),button);assert.equal(audios[0].paused,true);assert.equal(music().textContent,'♫ 音乐')
 await start();f.engine.restoreRuntime(snapshot);await flush()
 assert.equal(audios[1].paused,true);assert.equal(music().textContent,'♫ 音乐');await start()
 music().click();await flush();assert.equal(music().textContent,'♫ 音乐')
 music().click();await flush();const pending=audios.at(-1)
 await f.engine.play();await flush();pending.ready.resolve();await flush()
 assert.equal(pending.paused,true);assert.equal(music().textContent,'♫ 音乐');assert.deepEqual(f.toasts,[])
})

import {investigationProject} from '../../project/investigation.js'
test('雨站调查没有剧情资源或流程插件：三处线索只计一次，读档恢复已调查状态',async t=>{
 const f=await setupScene(t),ctx=owner();Object.assign(ctx,{narrative:f.engine,sceneRuntime:f.scene});for(const p of [background,dialogue,choices])p(ctx);f.ctx.effect(()=>()=>ctx.dispose())
 f.engine.update(p=>{for(const key of Object.keys(p))delete p[key];Object.assign(p,investigationProject(undefined,'first'))})
 assert.equal(f.scene.descriptor('story-flow'),undefined);assert.equal(f.engine.project.stories,undefined)
 await f.engine.play();assert.deepEqual(f.scene.validate(),[])
 for(const id of ['bench','ticket','desk']){
   const before=f.scene.runtime.state('dialogue').text
   assert.equal(await f.scene.call('conclusion','click'),false);assert.equal(f.scene.runtime.state('dialogue').text,before)
   await f.scene.call(id,'choose',{id});await f.scene.call(id,'choose',{id})
 }
 assert.equal(f.scene.runtime.state('count').value,3)
 const snapshot=structuredClone(f.engine.runtime);f.engine.stop();f.engine.restoreRuntime(snapshot)
 assert.deepEqual(f.scene.runtime.state('bench').items,[]);assert.equal(f.scene.runtime.state('count').value,3)
 await f.scene.call('conclusion','click');assert.match(f.scene.runtime.state('dialogue').text,/相机没有失窃/)
 await f.scene.call('bench','choose',{id:'bench'});assert.equal(f.scene.runtime.state('dialogue').key,'solved')
 assert.equal(f.engine.runtime.nodeId,undefined);assert.deepEqual(f.toasts,[])
})
