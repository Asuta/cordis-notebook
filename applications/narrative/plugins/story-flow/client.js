import { installStory } from './story.js'
export default function(ctx) {
  const engine=ctx.narrative, scene=ctx.sceneRuntime, story=installStory(ctx,engine)
  let disposed=false, queued=false, publishing=false, again=false, previousRuntime=null, previous={}
  async function publish(force=false) {
    if(publishing){again=true;return}
    const runtime=scene.runtime
    if(disposed || !scene.playing || !runtime) return
    const object=runtime.scene.objects.find(o=>o.type==='story-flow')
    if(!object) return
    const status=runtime.status(object.id)
    if(!status.enabled||status.paused)return
    const r=engine.runtime,n=engine.scene()
    if(!r.story)return
    if(runtime!==previousRuntime||force){previous={};previousRuntime=runtime}
    const values={
      stage:r.stage,
      line:{speaker:engine.project.characters.find(c=>c.id===r.text.speaker)?.name||'旁白',text:r.text.text,key:n.id+':'+r.lineIndex,active:!r.ended&&!r.story.awaiting},
      choices:r.story.awaiting&&!r.ended?story.choices().map(c=>({id:c.id,text:c.text})):[],
      chapter:{title:n.title,ended:r.ended},
      history:historyItems(r.transcript),
    }
    publishing=true
    try {
      for(const[event,payload]of Object.entries(values)){
        if(disposed||scene.runtime!==runtime)return
        const signature=JSON.stringify(payload)
        if(previous[event]===signature)continue
        previous[event]=signature
        await runtime.emit(object.id,event,payload)
      }
      for(const[event,value]of [['waiting',r.story.awaiting],['ended',r.ended]]){
        const before=previous[event];previous[event]=value
        if(value&&before!==true)await runtime.emit(object.id,event)
      }
    } finally {publishing=false;if(again){again=false;schedule()}}
  }
  function schedule(){if(queued||disposed)return;queued=true;queueMicrotask(()=>{queued=false;publish().catch(e=>{if(!disposed)engine.error(e.message)})})}
  scene.register(ctx,{type:'story-flow',label:'剧情流程',plugin:'story-flow',visual:false,singleton:true,fields:{},events:['line','stage','choices','chapter','history','waiting','ended'],methods:{
    advance:{label:'推进剧情',fields:{},async run(){await story.advance();await publish()}},
    choose:{label:'选择分支',fields:{id:{kind:'string',label:'选项 ID',required:true}},async run(_,v){await story.choose(v.id);await publish()}},
    sync:{label:'重新发送当前内容',fields:{},run:()=>publish(true)},
  }})
  engine.onEvent(ctx,async event=>{if(event!=='play.start')return;const r=scene.runtime,o=r?.scene.objects.find(o=>o.type==='story-flow');if(o&&r.status(o.id).enabled&&!r.status(o.id).paused)await engine.go(engine.runtime.nodeId)})
  engine.observe(ctx,schedule);scene.observe(ctx,schedule)
  ctx.effect(()=>()=>{disposed=true})
  schedule()
}
function historyItems(transcript){
  const rows=[];let size=0
  for(const m of [...transcript].reverse()){const row={name:m.name,text:m.text},length=JSON.stringify(row).length;if(size+length>160000)break;rows.unshift(row);size+=length}
  return rows
}
