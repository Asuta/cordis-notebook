import { conditionMatches, choiceResult, initialStory, enterLine, restoreStory } from './story.js'
export default function(ctx) {
  const engine=ctx.narrative,scene=ctx.sceneRuntime,locks=new WeakMap()
  let disposed=false,previousRuntime=null
  const source=(props,project=engine.project)=>{const s=(project.stories||[]).find(s=>s.id===props.storyId);if(!s)throw Error('请为剧情流程绑定有效的剧情资源');return s}
  const initial=(props,project)=>{const s=source(props,project);return initialStory(s,props.startNodeId||s.startNodeId)}
  const choices=(s,r)=>s.nodes.find(n=>n.id===r.nodeId).choices.filter(c=>conditionMatches(c.condition,r.variables))
  async function publish(api,current){
    const r=api.state,s=source(api.props),n=s.nodes.find(n=>n.id===r.nodeId)
    const values={stage:r.stage,line:{speaker:engine.project.characters.find(c=>c.id===r.text.speaker)?.name||'旁白',text:r.text.text,key:api.id+':'+(r.lineVisit||r.nodeId+':'+r.lineIndex),active:!r.ended&&!r.story.awaiting},choices:r.story.awaiting&&!r.ended?choices(s,r).map(c=>({id:c.id,text:c.text})):[],playback:{title:n.title,ended:r.ended},history:r.transcript.map(m=>({name:m.name,text:m.text}))}
    while(JSON.stringify(values.history).length>160000)values.history.shift()
    for(const[event,value]of Object.entries(values)){if(!current())return;await api.emit(event,value)}
  }
  function start(api,nodeId){const s=source(api.props),r=initialStory(s,nodeId||api.props.startNodeId||s.startNodeId);api.set(enterLine(s,r,r.nodeId,0,engine.project.characters))}
  const exclusive=(fn,restart=false)=>async(api,args)=>{
    const outer=locks.get(api.signal)
    if(outer && outer.chain!==api.chainId)return false
    const lock=outer||{chain:api.chainId,version:0};locks.set(api.signal,lock)
    try{
      const before=api.state
      if(!before.started&&!restart)start(api)
      const transition=fn(api,args)
      if(transition===false)return false
      // A connected method can enter a new chapter while its caller is publishing.
      const version=++lock.version,current=()=>api.current()&&lock.version===version
      const after=api.state
      const entered=restart||!before.started||transition==='chapter'
      const waiting=after.story.awaiting && (entered||!before.story.awaiting)
      await publish(api,current)
      if(current() && entered)await api.emit('chapter',{title:source(api.props).nodes.find(n=>n.id===after.nodeId).title,ended:after.ended})
      if(current() && waiting)await api.emit('waiting')
      if(current() && after.ended && !before.ended)await api.emit('ended')
    }finally{if(!outer)locks.delete(api.signal)}
  }
  scene.register(ctx,{type:'story-flow',label:'剧情流程',plugin:'story-flow',visual:false,fields:{storyId:{kind:'story',label:'剧情资源',default:''},startNodeId:{kind:'string',label:'起始章节覆盖（空为资源起点）',default:''}},events:['line','stage','choices','chapter','playback','history','waiting','ended'],
    initial,
    restore:(state,props,project)=>restoreStory(state,source(props,project)),
    validate:initial,
    methods:{
      start:{label:'从章节重新开始',fields:{nodeId:{kind:'string',label:'章节 ID',default:''}},run:exclusive((api,args)=>start(api,args.nodeId),true)},
      advance:{label:'推进剧情',fields:{},run:exclusive(api=>{
        const s=source(api.props),r=api.state,n=s.nodes.find(n=>n.id===r.nodeId)
        if(r.ended)return false
        if(r.lineIndex+1<n.lines.length){api.set(enterLine(s,r,n.id,r.lineIndex+1,engine.project.characters));return}
        if(n.choices.length){if(!choices(s,r).length)throw Error('没有满足条件的选项，请检查分支条件');if(r.story.awaiting)return false;api.set({...r,story:{awaiting:true}});return}
        if(n.type==='ending'||!n.next){api.set({...r,ended:true});return}
        api.set(enterLine(s,r,n.next,0,engine.project.characters))
        return 'chapter'
      })},
      choose:{label:'选择分支',fields:{id:{kind:'string',label:'选项 ID',required:true}},run:exclusive((api,args)=>{
        const s=source(api.props),r=api.state
        if(!r.story.awaiting||r.ended)throw Error('请先读完当前对白')
        const choice=choices(s,r).find(c=>c.id===args.id);if(!choice)throw Error('这个选项当前不可用')
        const variables=choiceResult(s,r,choice),next={...r,variables,transcript:[...r.transcript,{id:crypto.randomUUID(),role:'user',name:'我',text:choice.text}].slice(-250)}
        api.set(enterLine(s,next,choice.target,0,engine.project.characters))
        return 'chapter'
      })},
      sync:{label:'重新发送当前内容',fields:{},run:exclusive(()=>{})},
    }})
  async function sync(runtime,request={}){
    if(request.objectId&&!runtime.scene.objects.some(o=>o.id===request.objectId&&o.type==='story-flow'))throw Error('试读的剧情流程不存在')
    for(const o of runtime.scene.objects.filter(o=>o.type==='story-flow')){
      if(disposed||scene.runtime!==runtime)return
      const status=runtime.status(o.id);if(!status.enabled||status.paused)continue
      const targeted=request.objectId?request.objectId===o.id:request.storyId===o.props?.storyId
      if(!(targeted&&request.nodeId)&&runtime.state(o.id).started)continue
      await runtime.invoke(o.id,targeted&&request.nodeId?'start':'sync',targeted&&request.nodeId?{nodeId:request.nodeId}:{})
    }
  }
  engine.onEvent(ctx,async(event,request)=>{
    if(event==='play.validate'&&request.objectId){
      const {objects}=engine.expandScene(request.sceneId||engine.composition.startSceneId)
      const target=objects.find(o=>o.id===request.objectId&&o.type==='story-flow')
      if(!target)throw Error('试读的剧情流程不存在')
      if(!engine.canRunObject(objects,target.id))throw Error('试读的剧情流程已停用或暂停')
      const story=source(target.props||{})
      if(request.storyId&&story.id!==request.storyId)throw Error('试读的剧情流程未绑定所选剧情')
      if(request.nodeId)initialStory(story,request.nodeId)
    }
    if(event==='play.start'&&scene.runtime){previousRuntime=scene.runtime;await sync(scene.runtime,request)}
  })
  scene.observe(ctx,event=>{const runtime=scene.runtime;if(!runtime){previousRuntime=null;return}if(runtime===previousRuntime)return;previousRuntime=runtime;if(event?.startingPlay)return;queueMicrotask(()=>{if(!disposed&&scene.runtime===runtime)sync(runtime).catch(e=>{if(!disposed&&scene.runtime===runtime)engine.error(e.message)})})})
  ctx.effect(()=>()=>{disposed=true})
}
