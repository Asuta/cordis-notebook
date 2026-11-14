import { validateProject, initialRuntime, validateRuntime, diagnose } from './model.js'

export default async function(ctx,sdk) {
  let summaries = await sdk.request('/api/narrative/projects')
  const preferred = sdk.storage.local.getItem('current-project')
  let project = await sdk.request('/api/narrative/projects/' + encodeURIComponent(summaries.find(p=>p.id===preferred)?.id || summaries[0].id))
  let runtime = null, mode = 'edit', selection = {nodeId:project.startNodeId,characterId:project.characters[0]?.id || ''}
  let status = '已保存', version = 0, dirty = false, held = false, stopped = false, timer, pending, operation, transitionDepth = 0
  const observers = new Set(), events = new Set(), nodeTypes = new Map(), actionTypes = new Map(), conditionTypes = new Map(), resources = new Map()
  async function prepareResources() {
    const stamp = version, next = structuredClone(project)
    for (const resource of resources.values()) await resource.prepare?.(next)
    if (stamp !== version) throw Error('作品已改变，请重试保存角色')
    if (JSON.stringify(next) !== JSON.stringify(project)) { validateProject(next); project = next; mark(); notify('project', { render: false }) }
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
    if(draft && draft.revision===project.revision) { project=validateProject(draft); mark(); status='已恢复草稿，正在保存…' }
    else if(draft) sdk.toast('发现另一版本的草稿，已保留在本机；可在作品面板导出后处理')
  } catch { sdk.toast('作品草稿无法读取；服务器版本已载入') }
  function register(map,owner,descriptor,key) {
    if (map.has(descriptor[key])) throw Error('能力重复登记：'+descriptor[key])
    map.set(descriptor[key],descriptor); notify('registry')
    owner.effect(()=>()=> { if(map.get(descriptor[key])===descriptor) {map.delete(descriptor[key]);notify('registry')} })
  }
  async function emit(event,payload={}) { for(const fn of [...events]) await fn(event,payload) }
  async function go(id) {
    if(mode!=='play' || stopped) return
    const n=project.nodes.find(n=>n.id===id)
    if(!n) throw Error('找不到目标节点，请检查剧情连接')
    const handler=nodeTypes.get(n.type)
    if(!handler) throw Error('缺少“'+n.type+'”节点插件，请在插件管理中启用')
    if(++transitionDepth>30) {transitionDepth--;throw Error('事件跳转次数过多，请检查循环规则')}
    try {
      runtime={...runtime,nodeId:id,lineIndex:0,stage:structuredClone(n.stage),text:{speaker:'',text:''},ended:false,error:'',busy:false,chatTurns:0}
      runtime.visited.push(id); if(runtime.visited.length>1000) runtime.visited.shift()
      await handler.enter?.(n)
      await emit('node.enter',{nodeId:id,node:n})
      notify('runtime')
    } finally {transitionDepth--}
  }
  async function exclusive(fn) {
    if(held || stopped || operation) throw Error('正在保存或切换作品，请稍后再试')
    operation=Promise.resolve().then(async()=>{await prepareResources();return fn()})
    try{return await operation}finally{operation=null}
  }
  async function load(id) {
    await save()
    const next=validateProject(await sdk.request('/api/narrative/projects/'+encodeURIComponent(id)))
    project=next;mode='edit';runtime=null;selection={nodeId:next.startNodeId,characterId:next.characters[0]?.id || ''};version++;dirty=false;status='已保存'
    sdk.storage.local.setItem('current-project',next.id); notify('mode');notify('project')
  }
  const engine={
    get project(){return project},get runtime(){return runtime},get mode(){return mode},get selection(){return selection},get status(){return status},get version(){return version},get held(){return held},
    observe(owner,fn){observers.add(fn);owner.effect(()=>()=>observers.delete(fn));return()=>observers.delete(fn)},
    update(fn,{render=true}={}) {if(held||stopped||mode==='play'||operation)throw Error('请先返回编辑器'); const next=structuredClone(project);fn(next);validateProject(next);project=next;mark();notify('project',{render})},
    select(patch){selection={...selection,...patch};notify('selection')},
    asset(id){return project.assets.find(a=>a.id===id)?.url || ''},
    scene(){return project.nodes.find(n=>n.id===(mode==='play'?runtime?.nodeId:selection.nodeId)) || project.nodes[0]},
    transact(fn){if(!runtime)return;fn(runtime);notify('runtime')},
    play(id){return exclusive(async()=>{await save();runtime=initialRuntime(project,id);mode='play';notify('mode');try{await go(runtime.nodeId)}catch(e){error(e.message)}})},
    stop(){mode='edit';if(runtime?.nodeId)selection.nodeId=runtime.nodeId;runtime=null;notify('mode')},
    go,async advance(){if(runtime?.busy||held)return;const n=engine.scene();try{await nodeTypes.get(n.type)?.advance?.(n)}catch(e){error(e.message)}},
    registerNode(owner,d){register(nodeTypes,owner,d,'type')},nodeTypes(){return[...nodeTypes.values()]},
    registerAction(owner,d){register(actionTypes,owner,d,'type')},actions(){return[...actionTypes.values()]},
    registerCondition(owner,d){register(conditionTypes,owner,d,'type')},
    test(c){if(!c)return true;const handler=conditionTypes.get(c.type||'variable');return handler?!!handler.test(c):false},
    async runActions(rows,payload={}){for(const a of rows)if(!actionTypes.has(a.type))throw Error('动作插件未启用：'+a.type);for(const a of rows){const handler=actionTypes.get(a.type);if(!handler)throw Error('动作插件未启用：'+a.type);await handler.execute(a,payload)}},
    onEvent(owner,fn){events.add(fn);owner.effect(()=>()=>events.delete(fn))},emit,
    save,error,issues(){return diagnose(project)},
    async list(){summaries=await sdk.request('/api/narrative/projects');return summaries},
    open(id){return exclusive(()=>load(id))},
    create(template,title){return exclusive(async()=>{await save();const p=await sdk.request('/api/narrative/projects','POST',{template,...(title?{title}:{})});await load(p.id);return p})},
    importProject(value){return exclusive(async()=>{await save();const next=structuredClone(value),bundles=next.resourceBundles||{};delete next.resourceBundles;validateProject(next);for(const [id,bundle] of Object.entries(bundles)){const resource=resources.get(id);if(!resource)throw Error('请先启用资源插件：'+id);await resource.import(next,bundle)}validateProject(next);const p=await sdk.request('/api/narrative/import','POST',next);await load(p.id);return p})},
    exportProject(){return structuredClone(project)},
    exportBundle(){return exclusive(async()=>{await save();const next=structuredClone(project);next.resourceBundles={};for(const resource of resources.values()){const value=await resource.export?.(next);if(value)next.resourceBundles[resource.id]=value}if(next.characters.some(c=>c.meshAvatar)&&!resources.has('mesh-studio'))throw Error('请先启用角色工作室，以导出完整角色素材');return next})},
    registerResources(owner,d){register(resources,owner,d,'id')},
    restoreRuntime(snapshot){runtime=validateRuntime(snapshot,project);mode='play';notify('mode');notify('runtime')},
  }
  sdk.provide('narrative',engine)
  ctx.on('plugins/before-stop',async request=>{held=true;notify('status');request.hold(()=>{held=false;notify('status')});if(operation)await operation;await prepareResources();await save()})
  ctx.on('plugins/remote-stop',()=>{if(dirty)remember()})
  sdk.listen(window,'beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}})
  ctx.effect(()=>()=>{stopped=true;clearTimeout(timer);if(dirty)remember();observers.clear();events.clear()})
  const schema={type:'object',properties:{},additionalProperties:false}
  sdk.agent?.register({name:'narrative_read',description:'读取当前叙事引擎作品、选中节点、版本、已注册插件能力和剧情检查结果。',inputSchema:schema},()=>({project:structuredClone(project),version,mode,selection,issues:diagnose(project),nodeTypes:engine.nodeTypes().map(n=>({type:n.type,label:n.label})),actions:engine.actions().map(a=>({type:a.type,label:a.label}))}))
  sdk.agent?.register({name:'narrative_edit',description:'替换当前叙事作品。先 narrative_read，再提交完整 project 和读取到的 version；仅编辑模式，自动校验并保存。不得添加 API 密钥。',inputSchema:{type:'object',properties:{version:{type:'integer'},project:{type:'object'}},required:['version','project']}},async input=>{if(input.version!==version||input.project?.id!==project.id)throw Error('版本已变化，请重新读取');engine.update(next=>{Object.keys(next).forEach(k=>delete next[k]);Object.assign(next,input.project)});await save();return{version,revision:project.revision,issues:diagnose(project)}})
}
