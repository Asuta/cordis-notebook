const copy = value => structuredClone(value)
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const frozen = value => { if(value&&typeof value==='object'){for(const v of Object.values(value))frozen(v);Object.freeze(value)}return value }
export function validateFields(fields = {}, value = {}) {
  if(!plain(value))throw Error('方法参数必须是对象')
  for(const [key,field]of Object.entries(fields)){
    const v=value[key]??field.default
    if(v===undefined){if(field.required)throw Error('缺少参数：'+field.label);continue}
    if(field.kind==='number'&&(!Number.isFinite(v)||v<(field.min??-1000000)||v>(field.max??1000000)))throw Error('数值参数无效：'+field.label)
    if(field.kind==='boolean'&&typeof v!=='boolean')throw Error('开关参数无效：'+field.label)
    if(!['number','boolean'].includes(field.kind)&&(typeof v!=='string'||v.length>(field.maxLength||16000)))throw Error('文字参数无效：'+field.label)
    if(field.options&&!field.options.some(option=>(Array.isArray(option)?option[0]:option)===v))throw Error('参数选项无效：'+field.label)
  }
}
export function validateScene(scene, types, { allowMissing = false } = {}) {
  const byId = new Map(scene.objects.map(o => [o.id, o]))
  for (const o of scene.objects) {
    const d = types.get(o.type)
    if (!d) { if (allowMissing) continue; throw Error('缺少对象类型插件：' + o.type) }
    validateFields(d.fields, o.props || {})
    if (d.singleton && scene.objects.filter(x => x.type === o.type).length > 1) throw Error(d.label + ' 在一个场景中只能放置一份')
    for (const [slot, type] of Object.entries(d.refs || {})) {
      const target = byId.get(o.refs?.[slot])
      if (!target || type && target.type !== type) throw Error((o.name || o.id) + ' 的引用 ' + slot + ' 类型不匹配')
    }
  }
  for (const c of scene.connections) {
    const source = types.get(byId.get(c.source)?.type), target = types.get(byId.get(c.target)?.type)
    if (allowMissing && (!source || !target)) continue
    if (!source?.events?.includes(c.event) || !target?.methods?.[c.method]) throw Error('连接 ' + c.id + ' 的事件或方法不可用')
    const fields = target.methods[c.method].fields || {}
    if (c.argument && !fields[c.argument]) throw Error('连接 ' + c.id + ' 的事件参数映射无效')
    validateFields(Object.fromEntries(Object.entries(fields).filter(([key]) => key !== c.argument)), c.args || {})
  }
}
export class ObjectRuntime {
  constructor({ scene, types, snapshot, changed = () => {}, services = {} }) {
    validateScene(scene, types)
    this.scene=copy(scene);this.types=types;this.services=services;this.changed=changed;this.scopes=new Map();this.listeners=new Set();this.dead=false
    this.states=copy(snapshot?.states||{});this.flags=copy(snapshot?.flags||{});this.pending=0
    for(const o of this.scene.objects){
      const d=types.get(o.type),key=this.key(o.id)
      if(d){validateFields(d.fields,o.props||{});for(const [slot,type]of Object.entries(d.refs||{})){const target=this.scene.objects.find(x=>x.id===o.refs?.[slot]);if(!target||type&&target.type!==type)throw Error((o.name||o.id)+' 的引用 '+slot+' 类型不匹配')}
        const initial=d.initial?.(copy(o.props||{}))||{}
        this.states[key]=d.restore?d.restore(copy(this.states[key]??initial)):copy(this.states[key]??initial)
      }
      this.scopes.set(o.id,new AbortController())
    }
  }
  key(id){return this.scene.id+'/'+id}
  object(id){const o=this.scene.objects.find(x=>x.id===id);if(!o)throw Error('对象不存在：'+id);return o}
  descriptor(id){return this.types.get(this.object(id).type)}
  state(id){this.object(id);return frozen(copy(this.states[this.key(id)]||{}))}
  status(id){
    let o=this.object(id),visible=true,enabled=true,paused=false
    while(o){const flags={...o,...this.flags[this.key(o.id)]};visible&&=flags.visible!==false;enabled&&=flags.enabled!==false;paused||=flags.paused===true;o=this.scene.objects.find(x=>x.id===o.parent)}
    return{visible,enabled,paused}
  }
  snapshot(){return{schemaVersion:1,sceneId:this.scene.id,states:copy(this.states),flags:copy(this.flags)}}
  observe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  notify(id){if(this.dead)return;this.changed(this.snapshot());for(const fn of [...this.listeners])fn(id)}
  cancel(id){
    const o=this.object(id);this.scopes.get(id)?.abort();this.scopes.set(id,new AbortController())
    const interrupt=this.types.get(o.type)?.interrupt
    if(interrupt)this.states[this.key(id)]=interrupt(copy(this.states[this.key(id)]||{}))
    this.notify(id)
  }
  setFlags(id,patch){
    this.object(id);if(Object.entries(patch).some(([k,v])=>!['visible','enabled','paused'].includes(k)||typeof v!=='boolean'))throw Error('生命周期状态无效')
    this.flags[this.key(id)]={...this.flags[this.key(id)],...patch}
    for(const o of this.scene.objects){const status=this.status(o.id);if(!status.enabled||status.paused){this.scopes.get(o.id)?.abort();this.scopes.set(o.id,new AbortController());const interrupt=this.types.get(o.type)?.interrupt;if(interrupt)this.states[this.key(o.id)]=interrupt(copy(this.states[this.key(o.id)]||{}))}}
    this.notify(id)
  }
  async invoke(id,method,args={},chain={steps:0}){
    if(this.dead)throw Error('场景已卸载')
    const o=this.object(id),d=this.descriptor(id),status=this.status(id)
    if(!status.enabled||status.paused)throw Error('对象已停用或暂停')
    if(++chain.steps>64)throw Error('事件调用超过 64 步，请检查循环连接')
    const action=d?.methods?.[method];if(!action)throw Error('对象未提供方法：'+method)
    validateFields(action.fields,args)
    const scope=this.scopes.get(id),signal=scope.signal
    const current=()=>!this.dead&&!signal.aborted&&this.scopes.get(id)===scope
    const api={id,props:frozen(copy(o.props||{})),signal,services:this.services,
      get state(){return frozen(copy(thisRuntime.states[thisRuntime.key(id)]||{}))},
      set:next=>{if(!current())return;const value=typeof next==='function'?next(copy(this.states[this.key(id)]||{})):next;if(!plain(value)||JSON.stringify(value).length>500000)throw Error('对象状态无效或过大');this.states[this.key(id)]=copy(value);this.notify(id)},
      emit:(event,payload={})=>current()?this.emit(id,event,payload,chain):Promise.resolve(),
      call:(ref,name,input={})=>{if(!current())throw Error('对象调用已取消');const target=o.refs?.[ref];if(!target)throw Error('对象引用不存在：'+ref);return this.invoke(target,name,input,chain)},
      flags:patch=>{if(current())this.setFlags(id,patch)},cancel:()=>{if(current())this.cancel(id)},current}
    const thisRuntime=this
    this.pending++
    try{return await action.run(api,copy(args))}finally{this.pending--}
  }
  async emit(id,event,payload={},chain={steps:0}){
    if(!this.descriptor(id)?.events?.includes(event))throw Error('对象未声明事件：'+event)
    const scope=this.scopes.get(id)
    for(const c of this.scene.connections.filter(c=>c.source===id&&c.event===event)){
      if(this.dead||scope?.signal.aborted)return
      const args={...copy(c.args||{}),...(c.argument?{[c.argument]:copy(payload)}:{})}
      await this.invoke(c.target,c.method,args,chain)
    }
  }
  dispose(){if(this.dead)return;this.dead=true;for(const scope of this.scopes.values())scope.abort();this.scopes.clear();this.listeners.clear()}
}
export function describeType(d){return{type:d.type,label:d.label,plugin:d.plugin,visual:d.visual!==false,container:!!d.container,fields:copy(d.fields||{}),refs:copy(d.refs||{}),events:[...(d.events||[])],methods:Object.fromEntries(Object.entries(d.methods||{}).map(([name,m])=>[name,{label:m.label,fields:copy(m.fields||{})}]))}}
