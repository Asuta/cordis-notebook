// The project owns the serialized document. Runtime descriptors live in plugins.
const clone = value => structuredClone(value)
const record = v => !!v && typeof v === 'object' && !Array.isArray(v)
const idOK = v => typeof v === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,179}$/.test(v)
const fail = message => { throw Object.assign(Error(message), { status: 400 }) }
const list = (v, max) => Array.isArray(v) && v.length <= max
const json = v => { if (JSON.stringify(v).length > 512000) fail('对象配置过大') }
const unique = rows => rows.every(x => record(x) && idOK(x.id)) && new Set(rows.map(x => x.id)).size === rows.length
const layouts = ['column', 'row', 'grid', 'overlay', 'anchor', 'scroll']
const anchors = ['flow', 'fill', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
export function validateLayout(value = {}) {
  if (!record(value)) fail('布局配置无效')
  for (const key of Object.keys(value)) if (!['mode','anchor','gap','padding','columns','width','height','grow','align','compact'].includes(key)) fail('未知布局属性：' + key)
  if (value.mode && !layouts.includes(value.mode) || value.anchor && !anchors.includes(value.anchor)) fail('布局模式或锚点无效')
  for (const key of ['gap','padding','columns','width','height','grow']) if (value[key] !== undefined && (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 4000)) fail('布局尺寸无效')
  if (value.columns !== undefined && (!Number.isInteger(value.columns) || value.columns < 1 || value.columns > 12)) fail('网格列数必须为 1–12')
  if (value.align && !['stretch','start','center','end'].includes(value.align)) fail('布局对齐无效')
  if (value.compact !== undefined) { if (!record(value.compact) || value.compact.compact) fail('窄屏布局无效'); validateLayout(value.compact) }
}
function validateRows(objects, connections, prefab = false, expanded = false) {
  if (!list(objects, expanded ? 2000 : 500) || !unique(objects) || !list(connections, expanded ? 4000 : 1000) || !unique(connections)) fail('场景对象或连接无效')
  const ids = new Set(objects.map(x => x.id))
  for (const o of objects) {
    if (Boolean(o.type) === Boolean(o.prefab) || o.type && !idOK(o.type) || o.prefab && (!idOK(o.prefab.id) || !Number.isSafeInteger(o.prefab.version) || o.prefab.version < 1)) fail('对象类型或预制体版本无效')
    if (o.name !== undefined && (typeof o.name !== 'string' || o.name.length > 160)) fail('对象名称无效')
    if (o.parent && (!ids.has(o.parent) || o.parent === o.id)) fail('父对象不存在或循环嵌套')
    let current = o, visited = new Set()
    while (current?.parent) { if (visited.has(current.id)) fail('父子层级不能循环'); visited.add(current.id); current = objects.find(x => x.id === current.parent) }
    if (!record(o.props || {}) || !record(o.refs || {}) || !record(o.overrides || {})) fail('对象参数或引用无效')
    for (const [key, ref] of Object.entries(o.refs || {})) if (!idOK(key) || typeof ref !== 'string' || !(ids.has(ref) || prefab && /^@[a-zA-Z][a-zA-Z0-9_-]*$/.test(ref))) fail('对象引用不存在：' + ref)
    for (const key of ['visible','enabled','paused']) if (o[key] !== undefined && typeof o[key] !== 'boolean') fail('对象状态标记无效')
    validateLayout(o.layout); json(o)
  }
  for (const c of connections) {
    if (!ids.has(c.source) || !ids.has(c.target) || !idOK(c.event) || !idOK(c.method) || !record(c.args || {})) fail('行为连接的对象、事件或方法无效')
    if (c.argument !== undefined && !idOK(c.argument)) fail('事件参数映射无效')
  }
}
export function validateComposition(doc) {
  if (!record(doc) || doc.schemaVersion !== 1 || !list(doc.scenes, 40) || !doc.scenes.length || !unique(doc.scenes) || !list(doc.prefabs, 100) || !Array.isArray(doc.dependencies)) fail('场景文档无效')
  if (!doc.scenes.some(s => s.id === doc.startSceneId)) fail('起始场景不存在')
  const versions = new Set()
  for (const p of doc.prefabs) {
    const key = p.id + '@' + p.version
    if (!idOK(p.id) || !Number.isSafeInteger(p.version) || p.version < 1 || versions.has(key) || typeof p.name !== 'string') fail('预制体版本重复或无效')
    versions.add(key); validateRows(p.objects, p.connections, true)
    if (p.objects.some(o => o.prefab)) fail('预制体内请使用对象类型，不能递归嵌套预制体')
  }
  for (const s of doc.scenes) {
    if (typeof s.name !== 'string' || s.name.length > 160) fail('场景名称无效')
    validateRows(s.objects, s.connections)
    for (const o of s.objects) if (o.prefab && !versions.has(o.prefab.id + '@' + o.prefab.version)) fail('预制体版本不存在')
    const expanded = expandScene(doc, s.id)
    if (expanded.objects.length > 2000) fail('展开后的对象不能超过 2000 个')
    validateRows(expanded.objects, expanded.connections, false, true)
  }
  for (const dep of doc.dependencies) if (!record(dep) || !idOK(dep.id) || typeof dep.version !== 'string') fail('插件依赖声明无效')
  return doc
}
export function expandScene(doc, sceneId) {
  const scene = doc.scenes.find(s => s.id === sceneId)
  if (!scene) fail('场景不存在')
  const objects = [], connections = clone(scene.connections)
  for (const item of scene.objects) {
    if (!item.prefab) { objects.push(clone(item)); continue }
    const prefab = doc.prefabs.find(p => p.id === item.prefab.id && p.version === item.prefab.version)
    if (!prefab) fail('预制体版本不存在')
    if(Object.keys(item.overrides||{}).some(id=>!prefab.objects.some(o=>o.id===id)))fail('预制体覆盖引用了不存在的对象')
    objects.push({ id: item.id, type: 'container', name: item.name || prefab.name, parent: item.parent, props: {}, refs: {}, layout: item.layout || {mode:'column'}, visible:item.visible, enabled:item.enabled, paused:item.paused })
    const map = new Map(prefab.objects.map(o => [o.id, item.id + '--' + o.id]))
    for (const local of prefab.objects) {
      const override = item.overrides?.[local.id] || {}
      if (Object.keys(override).some(k => !['props','refs','layout','visible','enabled','paused'].includes(k))) fail('预制体覆盖只能修改参数、引用、布局和状态')
      const o = {...clone(local), ...clone(override), props:{...clone(local.props || {}),...clone(override.props || {})}, refs:{...clone(local.refs || {}),...clone(override.refs || {})}, layout:{...clone(local.layout || {}),...clone(override.layout || {})}}
      o.id = map.get(local.id); o.parent = local.parent ? map.get(local.parent) : item.id
      for (const [key, ref] of Object.entries(o.refs)) o.refs[key] = ref.startsWith('@') ? item.refs?.[ref.slice(1)] || '' : map.get(ref) || ref
      objects.push(o)
    }
    for (const c of prefab.connections) connections.push({...clone(c),id:item.id+'--'+c.id,source:map.get(c.source),target:map.get(c.target)})
  }
  return {id:scene.id,name:scene.name,objects,connections}
}
export function defaultComposition(project) {
  const characterId = project.characters[0]?.id || ''
  const chatPrefab = {id:'standard-chat',version:1,name:'标准聊天窗口',objects:[
    {id:'session',type:'conversation',name:'独立会话',props:{characterId,source:'ai',prompt:'自然地回应来访者。',script:'欢迎来到这里。\n愿意和我聊聊今天发生的事吗？'}},
    {id:'window',type:'chat-window',name:'聊天窗口',props:{title:'角色对话'},refs:{session:'session'},layout:{grow:1}}
  ],connections:[]}
  return {schemaVersion:1,startSceneId:'main',dependencies:[{id:'scene-runtime',version:'1.0.0'},{id:'scene-ui',version:'1.0.0'}],prefabs:[chatPrefab],scenes:[
    {id:'main',name:'故事舞台',objects:[{id:'story',type:'story-player',name:'剧情与舞台',props:{},layout:{grow:1}}],connections:[]}
  ]}
}
const descendants = (scene,id) => { const ids = new Set([id]); let changed=true; while(changed){changed=false;for(const o of scene.objects)if(ids.has(o.parent)&&!ids.has(o.id)){ids.add(o.id);changed=true}} return ids }
export function editComposition(input, command, createId = () => 'o-' + crypto.randomUUID()) {
  if(command?.op==='batch'){if(!Array.isArray(command.commands)||command.commands.length>50||command.commands.some(c=>!record(c)||c.op==='batch'))fail('批量操作无效');return command.commands.reduce((doc,c)=>editComposition(doc,{...c,sceneId:c.sceneId||command.sceneId},createId),clone(input))}
  if(!record(command))fail('场景操作无效')
  const doc = clone(input), scene = doc.scenes.find(s => s.id === (command.sceneId || doc.startSceneId)), op = command.op
  if (!scene) fail('场景不存在')
  const object = () => {const value=scene.objects.find(o=>o.id===command.id);if(!value)fail('对象不存在');return value}
  if (op === 'add') scene.objects.push({id:command.id || createId(),type:command.type,name:command.name || command.type,parent:command.parent || null,props:clone(command.props || {}),refs:clone(command.refs || {}),layout:clone(command.layout || {})})
  else if (op === 'patch') { const o=object(); for(const key of Object.keys(command.patch || {})) {if(!['name','props','refs','layout','visible','enabled','paused','overrides'].includes(key))fail('不能直接修改对象标识或类型');o[key]=clone(command.patch[key])} }
  else if (op === 'move') {const o=object();o.parent=command.parent || null;if(command.index!==undefined){scene.objects.splice(scene.objects.indexOf(o),1);scene.objects.splice(Math.max(0,Number(command.index)||0),0,o)}}
  else if (op === 'remove') {
    object();const ids=descendants(scene,command.id)
    if(scene.objects.some(o=>!ids.has(o.id)&&Object.values(o.refs||{}).some(r=>ids.has(r))))fail('其他对象仍引用此对象，请先修改引用')
    scene.objects=scene.objects.filter(o=>!ids.has(o.id));scene.connections=scene.connections.filter(c=>!ids.has(c.source)&&!ids.has(c.target))
  } else if (op === 'clone') {
    object();const ids=descendants(scene,command.id),map=new Map([...ids].map(id=>[id,createId()]))
    for(const o of [...scene.objects])if(ids.has(o.id)){const copy=clone(o);copy.id=map.get(o.id);copy.parent=map.get(o.parent)||o.parent;copy.name=(copy.name||copy.type)+' 副本';for(const [key,ref]of Object.entries(copy.refs||{}))copy.refs[key]=map.get(ref)||ref;scene.objects.push(copy)}
    for(const c of [...scene.connections])if(ids.has(c.source)&&ids.has(c.target))scene.connections.push({...clone(c),id:createId(),source:map.get(c.source),target:map.get(c.target)})
  } else if(op==='connect')scene.connections.push({id:command.id||createId(),source:command.source,event:command.event,target:command.target,method:command.method,args:clone(command.args||{}),...(command.argument?{argument:command.argument}:{})})
  else if(op==='disconnect')scene.connections=scene.connections.filter(c=>c.id!==command.id)
  else if(op==='save-prefab'){
    object();const ids=descendants(scene,command.id),rows=clone(scene.objects.filter(o=>ids.has(o.id)))
    if(rows.some(o=>o.prefab))fail('请先展开预制体，再保存新的组合')
    const bindings={}
    for(const o of rows){if(!ids.has(o.parent))o.parent=null;for(const[key,ref]of Object.entries(o.refs||{}))if(!ids.has(ref)){bindings[ref]=ref;o.refs[key]='@'+ref}}
    const id=command.prefabId||createId(),version=Math.max(0,...doc.prefabs.filter(p=>p.id===id).map(p=>p.version))+1
    doc.prefabs.push({id,version,name:command.name||object().name||'预制体',bindings,objects:rows,connections:clone(scene.connections.filter(c=>ids.has(c.source)&&ids.has(c.target)))})
  } else if(op==='instantiate'){
    const prefab=doc.prefabs.find(p=>p.id===command.prefabId&&p.version===command.prefabVersion);if(!prefab)fail('预制体版本不存在')
    scene.objects.push({id:command.id||createId(),prefab:{id:prefab.id,version:prefab.version},name:command.name||prefab.name,parent:command.parent||null,layout:clone(command.layout||{}),refs:{...clone(prefab.bindings||{}),...clone(command.refs||{})},overrides:clone(command.overrides||{})})
  } else if(op==='unpack'){const o=object();if(!o.prefab)fail('所选对象不是预制体');const expanded=expandScene({...doc,scenes:[{...scene,objects:[o],connections:[]}]},scene.id);scene.objects.splice(scene.objects.indexOf(o),1,...expanded.objects);scene.connections.push(...expanded.connections)}
  else if(op==='add-scene'){const id=command.id||createId();doc.scenes.push({id,name:command.name||'新场景',objects:[],connections:[]})}
  else if(op==='start-scene')doc.startSceneId=command.id
  else if(op==='rename-scene')scene.name=command.name
  else fail('不支持的场景操作：'+op)
  return validateComposition(doc)
}
