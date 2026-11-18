import {test} from 'node:test'
import assert from 'node:assert/strict'
import {setupScene} from './helpers.js'
import {owner} from '../../project/test/helpers.js'

test('事件记录含来源、目标、参数和错误；限量、暂停、清空及Agent读取不改作品',async t=>{
 const f=await setupScene(t),ctx=owner();f.ctx.effect(()=>()=>ctx.dispose())
 f.scene.register(ctx,{type:'failure',methods:{fail:{fields:{},run(){throw Error('模拟错误')}}},events:[]})
 f.scene.edit({op:'add',id:'failure',type:'failure'})
 f.scene.edit({op:'connect',source:'next-day',event:'clicked',target:'failure',method:'fail'})
 await f.engine.play();const version=f.engine.version,project=structuredClone(f.engine.project)
 await assert.rejects(f.scene.call('next-day','click'),/模拟错误/)
 const rows=f.scene.traces();assert.ok(rows.some(r=>r.source==='next-day'&&r.target==='day'&&r.status==='success'&&r.args.includes('amount')))
 assert.ok(rows.some(r=>r.source==='next-day'&&r.target==='failure'&&r.status==='error'&&r.error==='模拟错误'))
 f.scene.setTracing(false);const count=f.scene.traces().length;await f.scene.call('day','add',{amount:1});assert.equal(f.scene.traces().length,count)
 f.scene.setTracing(true);for(let i=0;i<210;i++)await f.scene.call('day','set',{value:1});assert.equal(f.scene.traces().length,200)
 const read=f.tools.get('narrative_scene_trace')();read.entries[0].status='changed';assert.notEqual(f.scene.traces()[0].status,'changed')
 f.scene.clearTraces();assert.deepEqual(f.scene.traces(),[]);assert.equal(f.engine.version,version);assert.deepEqual(f.engine.project,project)
})

test('无法构建读档目标或试玩场景不存在时继续使用当前场景',async t=>{
 const f=await setupScene(t);f.engine.update(p=>p.composition.scenes.push({id:'broken',name:'缺少插件',objects:[{id:'missing',type:'uninstalled'}],connections:[]}))
 await f.engine.play();await f.scene.call('day','add',{amount:1})
 const before=f.engine.runtime,scene=f.scene.runtime,snapshot=structuredClone(before);snapshot.objects.sceneId='broken'
 assert.throws(()=>f.engine.restoreRuntime(snapshot));await assert.rejects(f.engine.play({sceneId:'missing'}),/场景不存在/)
 assert.equal(f.engine.runtime,before);assert.equal(f.scene.runtime,scene);assert.equal(scene.state('day').value,2)
 await f.scene.call('day','add',{amount:1});assert.equal(scene.state('day').value,3)
})

test('清空记录后，迟到的方法完成通知不会重新创建记录',async t=>{
 const f=await setupScene(t),ctx=owner(),gate=Promise.withResolvers();f.ctx.effect(()=>()=>ctx.dispose())
 f.scene.register(ctx,{type:'delay',methods:{wait:{fields:{},run:()=>gate.promise}}})
 f.scene.edit({op:'add',id:'slow',type:'delay'});await f.engine.play()
 const pending=f.scene.call('slow','wait');assert.equal(f.scene.traces().at(-1).status,'pending')
 f.scene.clearTraces();gate.resolve();await pending;assert.deepEqual(f.scene.traces(),[])
})

test('暂停记录期间已发起的方法仍更新结果，暂停后发起的方法不产生记录',async t=>{
 const f=await setupScene(t),ctx=owner(),pendingGate=Promise.withResolvers(),pausedGate=Promise.withResolvers();f.ctx.effect(()=>()=>ctx.dispose())
 f.scene.register(ctx,{type:'delay',methods:{wait:{fields:{},run:()=>pendingGate.promise},waitPaused:{fields:{},run:()=>pausedGate.promise}}})
 f.scene.edit({op:'add',id:'slow',type:'delay'});await f.engine.play()
 const pending=f.scene.call('slow','wait'),entry=f.scene.traces().at(-1)
 assert.equal(entry.status,'pending');f.scene.setTracing(false)
 const paused=f.scene.call('slow','waitPaused');pendingGate.resolve();await pending
 f.scene.setTracing(true);pausedGate.resolve();await paused
 const rows=f.scene.traces().filter(row=>row.target==='slow')
 assert.equal(rows.length,1);assert.equal(rows[0].id,entry.id);assert.equal(rows[0].status,'success')
})
