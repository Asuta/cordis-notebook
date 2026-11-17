// A template is composition data, not a gameplay plugin. Each capability can be
// removed or replaced by editing objects and connections below.
export const storyPlugins=['scene-runtime','scene-ui','story-flow','background-view','character-view','dialogue-view','choice-list','history-view','auto-advance','playback-controls']
export function storyObjects(id='novel', title='故事', stage={}, line={}) {
  const child=(suffix,type,name,props,layout)=>({id:id+'-'+suffix,type,name,parent:id,props,layout})
  return [
    {id,type:'container',name:title,props:{},layout:{mode:'overlay',height:720,grow:1,gap:0,compact:{height:960}}},
    child('flow','story-flow','剧情流程',{},{}),
    child('background','background-view','背景',{asset:stage.background||'',fit:'cover'},{anchor:'fill'}),
    child('character','character-view','角色立绘',{characterId:stage.characterId||'',expression:stage.expression||'neutral',position:stage.position??62,scale:stage.scale??100},{anchor:'fill'}),
    child('dialogue','dialogue-view','对白框',{speaker:line.speaker||'旁白',text:line.text||'在这里开始新的故事。',speed:28},{anchor:'bottom-left',width:1280,height:320,padding:40,compact:{width:540,height:410,padding:24}}),
    child('choices','choice-list','选项列表',{items:[]},{anchor:'center',width:680,gap:14,compact:{width:440}}),
    child('controls','playback-controls','章节与播放控制',{title},{anchor:'top-left',width:1280,padding:24,gap:8,compact:{width:540,padding:16}}),
    child('auto','auto-advance','自动播放',{delay:1800},{anchor:'bottom-right',padding:12,width:145}),
    child('history','history-view','历史回看',{title:'回看'},{anchor:'bottom-left',padding:12,width:110}),
  ]
}
export function storyConnections(id='novel'){
  const c=(source,event,target,method,argument)=>({id:id+'-'+source+'-'+event+'-'+target,source:id+'-'+source,event,target:id+'-'+target,method,...(argument?{argument}:{})})
  return [c('flow','stage','background','present','value'),c('flow','stage','character','present','value'),c('flow','line','dialogue','present','value'),c('flow','choices','choices','present','value'),c('flow','chapter','controls','present','value'),c('flow','history','history','present','value'),c('dialogue','continued','flow','advance'),c('choices','selected','flow','choose','id'),c('dialogue','started','auto','reset'),c('dialogue','completed','auto','ready'),c('auto','elapsed','dialogue','advance'),c('history','opened','auto','stop'),c('flow','waiting','auto','stop'),c('flow','ended','auto','stop')]
}
export function storyComposition(title,stage,line){return {schemaVersion:1,startSceneId:'main',dependencies:storyPlugins.map(id=>({id,version:'1.0.0'})),prefabs:[],scenes:[{id:'main',name:title,objects:storyObjects('novel',title,stage,line),connections:storyConnections()}]}}
export function migrateStoryComposition(project){
  const doc=project.composition
  if(!doc)return project
  let changed=false
  for(const scene of [...doc.scenes,...doc.prefabs]){
    const legacy=scene.objects.filter(o=>o.type==='story-player')
    for(const old of legacy){
      const node=project.nodes.find(n=>n.id===project.startNodeId)||project.nodes[0]
      const rows=storyObjects(old.id,old.props?.title||project.title,node?.stage,node?.lines?.[0])
      Object.assign(rows[0],{parent:old.parent,visible:old.visible,enabled:old.enabled,paused:old.paused,layout:{...rows[0].layout,...old.layout}})
      if(rows.slice(1).some(r=>scene.objects.some(o=>o.id===r.id)))throw Error('旧舞台迁移遇到重复对象 ID，请先重命名：'+old.id)
      scene.objects.splice(scene.objects.indexOf(old),1,...rows)
      for(const connection of scene.connections)if(connection.target===old.id&&['advance','choose'].includes(connection.method))connection.target=old.id+'-flow'
      scene.connections.push(...storyConnections(old.id));changed=true
    }
  }
  if(changed){doc.dependencies=doc.dependencies.filter(d=>d.id!=='visual-novel');for(const id of storyPlugins)if(!doc.dependencies.some(d=>d.id===id))doc.dependencies.push({id,version:'1.0.0'})}
  return project
}
