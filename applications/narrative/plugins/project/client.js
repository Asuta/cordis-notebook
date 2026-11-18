import { projectFormats, validateRuntime, validateProject, compositionTools } from './model.js'
import { defaultComposition, expandScene, editComposition, validateComposition } from './composition.js'

export default async function(ctx,sdk) {
  const formats=projectFormats(), normalize=p=>formats.normalize(p)
  const selectionFor=p=>Object.assign({characterId:p.characters[0]?.id || ''},...formats.all().map(f=>f.selection?.(p)))
  let summaries = await sdk.request('/api/narrative/projects')
  const preferred = sdk.storage.local.getItem('current-project')
  let project = normalize(await sdk.request('/api/narrative/projects/' + encodeURIComponent(summaries.find(p=>p.id===preferred)?.id || summaries[0].id)))
  let runtime = null, mode = 'edit', selection = selectionFor(project)
  let status = '已保存', version = 0, dirty = false, held = false, stopped = false, timer, pending, operation
  const observers = new Set(), events = new Set(), actionTypes = new Map(), conditionTypes = new Map(), resources = new Map(), runtimeValidators = new Map()
  const undoScenes=[], redoScenes=[]
  const composition = (target=project) => structuredClone(target.composition || defaultComposition(target))
  function sceneCommand(command, expectedVersion=version, validate=()=>{}) {
    if(expectedVersion!==version)throw Error('版本已变化，请重新读取')
    const before=composition(),after=editComposition(before,command);validate(after)
    engine.update(p=>{p.composition=after});undoScenes.push({before,after});if(undoScenes.length>50)undoScenes.shift();redoScenes.length=0
    return composition()
  }
  function sceneHistory(source,target) {
    const entry=source.at(-1);if(!entry)return
    const expected=source===undoScenes?entry.after:entry.before
    if(JSON.stringify(composition())!==JSON.stringify(expected))throw Error('场景已被其他编辑修改，不能覆盖，请重新编辑')
    engine.update(p=>{p.composition=structuredClone(source===undoScenes?entry.before:entry.after)});source.pop();target.push(entry)
  }
  async function prepareResources() {
    const stamp = version, next = structuredClone(project)
    for (const resource of resources.values()) await resource.prepare?.(next)
    if (stamp !== version) throw Error('作品已改变，请重试保存角色')
    if (JSON.stringify(next) !== JSON.stringify(project)) { normalize(next); project = next; mark(); notify('project', { render: false }) }
  }
  function notify(type,extra={}) { for (const fn of [...observers]) fn({type,...extra}) }
  function error(message) { if (runtime) runtime.error = String(message); sdk.toast(String(message)); notify('runtime') }
  const draftKey = () => 'draft:' + project.id
  function remember() { try { sdk.storage.local.setItem(draftKey(),JSON.stringify(project)) } catch { status='草稿备份失败，请立即导出'; sdk.toast(status) } }
  function setStatus(next) { status=next; notify('status') }
  function mark() { dirty=true; version++; remember(); setStatus('正在保存…'); clearTimeout(timer); timer=setTimeout(()=>save().catch(e=>{setStatus('保存失败 · 草稿已保留');sdk.toast(e.message)}),500) }
  async function save() {
    clearTimeout(timer)
    if (pending) return pending
    pending = (async()=> {
      while(dirty && !stopped) {
        const stamp=version, snapshot=structuredClone(project)
        const saved=await sdk.request('/api/narrative/projects/'+encodeURIComponent(snapshot.id),'PUT',snapshot)
        if (stopped) return
        project.revision=saved.revision
        if(stamp===version) {dirty=false;sdk.storage.local.removeItem(draftKey());setStatus('已保存')}
        else remember()
      }
    })().finally(()=>{pending=null})
    return pending
  }
  try {
    const draft = JSON.parse(sdk.storage.local.getItem(draftKey()) || 'null')
    if(draft && draft.revision===project.revision) { project=normalize(draft); mark(); status='已恢复草稿，正在保存…' }
    else if(draft) sdk.toast('发现另一版本的草稿，已保留在本机；可在作品面板导出后处理')
  } catch { sdk.toast('作品草稿无法读取；服务器版本已载入') }
  function register(map,owner,descriptor,key) {
    if (map.has(descriptor[key])) throw Error('能力重复登记：'+descriptor[key])
    map.set(descriptor[key],descriptor); notify('registry')
    owner.effect(()=>()=> { if(map.get(descriptor[key])===descriptor) {map.delete(descriptor[key]);notify('registry')} })
  }
  async function emit(event,payload={}) { for(const fn of [...events]) await fn(event,payload) }
  async function exclusive(fn) {
    if(held || stopped || operation) throw Error('正在保存或切换作品，请稍后再试')
    operation=Promise.resolve().then(async()=>{await prepareResources();return fn()})
    try{return await operation}finally{operation=null}
  }
  async function load(id) {
    await save()
    const next=normalize(await sdk.request('/api/narrative/projects/'+encodeURIComponent(id)))
    project=next;mode='edit';runtime=null;selection=selectionFor(next);version++;dirty=false;status='已保存';undoScenes.length=0;redoScenes.length=0
    sdk.storage.local.setItem('current-project',next.id); notify('mode');notify('project')
  }
  function checkedRuntime(snapshot,targetProject,restoring=false){
    const next=validateRuntime(snapshot,targetProject,formats.all())
    if(runtimeValidators.size){
      const context={project:targetProject,composition:composition(targetProject),restoring}
      for(const d of runtimeValidators.values())d.validate(next,context)
    }
    return next
  }
  const engine={
    registerProjectFormat(owner,format){
      const next=structuredClone(project);format.validate(next);format.migrate?.(next,compositionTools);validateProject(next)
      formats.register(owner,format);project=next;Object.assign(selection,format.selection?.(project));notify('registry')
      owner.effect(()=>()=>queueMicrotask(()=>{if(!stopped)notify('registry')}))
    },
    hasProjectFormat(id){return !!formats.get(id)},
    prefabPresets(){return formats.all().flatMap(f=>f.prefabs?.(project)||[])},
    get composition(){return composition()},expandScene(id,doc=composition()){return expandScene(doc,id)},sceneCommand,
    validateComposition,sceneUndo(){sceneHistory(undoScenes,redoScenes)},sceneRedo(){sceneHistory(redoScenes,undoScenes)},
    get sceneHistory(){return{undo:undoScenes.length,redo:redoScenes.length}},
    get project(){return project},get runtime(){return runtime},get mode(){return mode},get selection(){return selection},get status(){return status},get version(){return version},get held(){return held},
    canRunObject(objects,id){
      const byId=new Map(objects.map(o=>[o.id,o]))
      let o=byId.get(id);if(!o)return false
      while(o){if(o.enabled===false||o.paused===true)return false;o=byId.get(o.parent)}
      return true
    },
    observe(owner,fn){observers.add(fn);owner.effect(()=>()=>observers.delete(fn));return()=>observers.delete(fn)},
    update(fn,{render=true}={}) {if(held||stopped||mode==='play'||operation)throw Error('请先返回编辑器'); const next=structuredClone(project);fn(next);normalize(next);project=next;mark();notify('project',{render})},
    select(patch){selection={...selection,...patch};notify('selection')},
    asset(id){return project.assets.find(a=>a.id===id)?.url || ''},
    transact(fn){if(!runtime)return;fn(runtime);notify('runtime')},
    play(options){return exclusive(async()=>{
      const request=typeof options==='string'?Object.assign({},...formats.all().map(f=>f.playRequest?.(options,selection))):options||{}
      await save();const next={busy:false,error:''}
      if(request.sceneId){if(!composition().scenes.some(s=>s.id===request.sceneId))throw Error('场景不存在');next.objects={schemaVersion:1,sceneId:request.sceneId,states:{},flags:{}}}
      if(request.objectId)await emit('play.validate',request)
      runtime=next;mode='play';notify('mode',{startingPlay:true})
      try {await emit('play.start',request)} catch(e){error(e.message)}
    })},
    stop(){mode='edit';runtime=null;notify('mode')},
    registerAction(owner,d){register(actionTypes,owner,d,'type')},actions(){return[...actionTypes.values()]},
    registerCondition(owner,d){register(conditionTypes,owner,d,'type')},
    test(c){if(!c)return true;const handler=conditionTypes.get(c.type||'variable');return handler?!!handler.test(c):false},
    async runActions(rows,payload={}){for(const a of rows)if(!actionTypes.has(a.type))throw Error('动作插件未启用：'+a.type);for(const a of rows){const handler=actionTypes.get(a.type);if(!handler)throw Error('动作插件未启用：'+a.type);await handler.execute(a,payload)}},
    onEvent(owner,fn){events.add(fn);owner.effect(()=>()=>events.delete(fn))},emit,
    save,error,issues(){return formats.issues(project)},
    async list(){summaries=await sdk.request('/api/narrative/projects');return summaries},
    open(id){return exclusive(()=>load(id))},
    create(template,title){return exclusive(async()=>{await save();const p=await sdk.request('/api/narrative/projects','POST',{template,...(title?{title}:{})});await load(p.id);return p})},
    importProject(value){return exclusive(async()=>{await save();const next=structuredClone(value),bundles=next.resourceBundles||{};delete next.resourceBundles;normalize(next);for(const [id,bundle] of Object.entries(bundles)){const resource=resources.get(id);if(!resource)throw Error('请先启用资源插件：'+id);await resource.import(next,bundle)}normalize(next);const p=await sdk.request('/api/narrative/import','POST',next);await load(p.id);return p})},
    exportProject(){return structuredClone(project)},
    exportBundle(){return exclusive(async()=>{await save();const next=structuredClone(project);next.resourceBundles={};for(const resource of resources.values()){const value=await resource.export?.(next);if(value)next.resourceBundles[resource.id]=value}if(next.characters.some(c=>c.meshAvatar)&&!resources.has('mesh-studio'))throw Error('此旧作品含动态立绘资源，当前精简版不支持完整导出');return next})},
    registerResources(owner,d){register(resources,owner,d,'id')},
    registerRuntimeValidator(owner,d){register(runtimeValidators,owner,d,'id')},
    validateSave(snapshot,saveProject=project){checkedRuntime(snapshot,saveProject)},
    restoreRuntime(snapshot){runtime=checkedRuntime(snapshot,project,true);mode='play';notify('mode');notify('runtime')},
  }
  sdk.provide('narrative',engine)
  ctx.on('plugins/before-stop',async request=>{held=true;notify('status');request.hold(()=>{held=false;notify('status')});if(operation)await operation;await prepareResources();await save()})
  ctx.on('plugins/remote-stop',()=>{if(dirty)remember()})
  sdk.listen(window,'beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}})
  ctx.effect(()=>()=>{stopped=true;clearTimeout(timer);if(dirty)remember();observers.clear();events.clear()})
  const schema={type:'object',properties:{},additionalProperties:false}
  sdk.agent?.register({name:'narrative_read',description:'读取当前叙事引擎作品、选中节点、版本、已注册插件能力和剧情检查结果。',inputSchema:schema},()=>({project:structuredClone(project),version,mode,selection,issues:formats.issues(project),actions:engine.actions().map(a=>({type:a.type,label:a.label}))}))
  sdk.agent?.register({name:'narrative_edit',description:'替换当前叙事作品。先 narrative_read，再提交完整 project 和读取到的 version；仅编辑模式，自动校验并保存。不得添加 API 密钥。',inputSchema:{type:'object',properties:{version:{type:'integer'},project:{type:'object'}},required:['version','project']}},async input=>{if(input.version!==version||input.project?.id!==project.id)throw Error('版本已变化，请重新读取');engine.update(next=>{Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,input.project)});await save();return{version,revision:project.revision,issues:formats.issues(project)}})
}
