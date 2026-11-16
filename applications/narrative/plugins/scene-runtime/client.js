import { ObjectRuntime, describeType, validateScene } from './runtime.js'
export default function(ctx,sdk){
  const engine=ctx.narrative,types=new Map(),observers=new Set(),services=new Map()
  let runtime=null,selected=engine.composition.startSceneId,savedRef=null,projectId=engine.project.id,disposed=false,syncing=false,failedRef=Symbol(),failure='',scheduled=false
  const notify=()=>{for(const fn of [...observers])fn()}
  const persist=snapshot=>{if(engine.mode!=='play'||disposed)return;savedRef=snapshot;engine.transact(r=>{r.objects=snapshot})}
  const document=()=>engine.composition
  function validateTypes(doc){
    engine.validateComposition(doc)
    for(const s of doc.scenes)validateScene(engine.expandScene(s.id,doc),types,{allowMissing:true})
  }
  function start(snapshot){
    const id=snapshot?.sceneId||document().startSceneId
    const next=new ObjectRuntime({scene:engine.expandScene(id),types,snapshot,changed:persist,services:{engine,service:name=>services.get(name)}})
    runtime?.dispose();runtime=next;selected=id;persist(runtime.snapshot());notify()
  }
  function sync(event){
    if(disposed||syncing)return
    syncing=true
    try{
    if(projectId!==engine.project.id){projectId=engine.project.id;selected=document().startSceneId}
    if(engine.mode==='play'){if((!runtime||engine.runtime.objects!==savedRef)&&engine.runtime.objects!==failedRef){try{start(engine.runtime.objects);failedRef=Symbol();if(failure&&engine.runtime.error===failure)engine.transact(r=>{r.error=''});failure=''}catch(error){failedRef=engine.runtime.objects;failure=error.message;runtime?.dispose();runtime=null;engine.error(error.message)}}}
    else {runtime?.dispose();runtime=null;savedRef=null;failedRef=Symbol();failure='';if(!document().scenes.some(s=>s.id===selected))selected=document().startSceneId}
    if(event?.type!=='status')notify()
    }finally{syncing=false}
  }
  const api={
    get runtime(){return runtime},get selected(){return selected},get document(){return document()},get playing(){return engine.mode==='play'},
    types:()=>[...types.values()].map(describeType),descriptor:type=>types.get(type),
    register(owner,d){
      if(types.has(d.type))throw Error('对象类型重复：'+d.type)
      types.set(d.type,d);failedRef=Symbol()
      if(engine.mode==='play'){if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;sync()})}}else sync()
      owner.effect(()=>()=>{types.delete(d.type);runtime?.dispose();runtime=null;notify()})
    },
    provide(owner,name,value){if(services.has(name))throw Error('场景服务重复：'+name);services.set(name,value);notify();owner.effect(()=>()=>{services.delete(name);notify()})},
    service:name=>services.get(name),
    observe(owner,fn){observers.add(fn);const off=()=>observers.delete(fn);owner.effect(()=>off);return off},
    select(id){if(!document().scenes.some(s=>s.id===id))throw Error('场景不存在');if(engine.mode==='play')throw Error('请使用切换场景方法');selected=id;notify()},
    switchScene(id){if(engine.mode!=='play')throw Error('请先开始试玩');if(!document().scenes.some(s=>s.id===id))throw Error('场景不存在');const snapshot=runtime?.snapshot();start({...snapshot,sceneId:id})},
    expanded(id=selected){return engine.expandScene(id)},
    edit(command,version=engine.version){const result=engine.sceneCommand(command,version,validateTypes);notify();return result},
    undo(){engine.sceneUndo();notify()},redo(){engine.sceneRedo();notify()},
    async call(id,method,args){if(!runtime)throw Error('请先开始试玩');return runtime.invoke(id,method,args)},
    validate(){const issues=[];for(const s of document().scenes){let expanded;try{expanded=engine.expandScene(s.id)}catch(e){issues.push(e.message);continue}
      try{validateScene(expanded,types)}catch(e){issues.push(s.name+'：'+e.message)}}
      return issues},
  }
  sdk.provide('sceneRuntime',api)
  engine.observe(ctx,sync)
  const read=()=>({projectId:engine.project.id,version:engine.version,mode:engine.mode,selectedSceneId:selected,document:document(),types:api.types(),issues:api.validate(),runtime:runtime?.snapshot()||null})
  sdk.agent?.register({name:'narrative_scene_read',description:'读取场景、预制体、公开对象类型/字段/方法/事件、版本和诊断。场景对象与剧情节点不同。',inputSchema:{type:'object',properties:{}}},read)
  sdk.agent?.register({name:'narrative_scene_edit',description:'用与属性面板相同的操作修改场景。先 read；支持 add/patch/move/remove/clone/connect/disconnect/save-prefab/instantiate/unpack/add-scene/start-scene/rename-scene。所有操作整体校验，成功后保存。',inputSchema:{type:'object',properties:{version:{type:'integer'},command:{type:'object'}},required:['version','command']}},async input=>{api.edit(input.command,input.version);await engine.save();return read()})
  sdk.agent?.register({name:'narrative_scene_call',description:'仅在试玩中调用对象声明的方法。方法和参数来自 narrative_scene_read.types。',inputSchema:{type:'object',properties:{id:{type:'string'},method:{type:'string'},args:{type:'object'}},required:['id','method']}},async input=>{await api.call(input.id,input.method,input.args||{});return read()})
  ctx.effect(()=>()=>{disposed=true;runtime?.dispose();observers.clear();services.clear();types.clear()})
}
