export const element=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n}
export function applyLayout(node,layout={},compact=false){
  const l={mode:'column',gap:12,padding:0,align:'stretch',...layout,...(compact?layout.compact:{})}
  node.style.cssText='';node.dataset.layout=l.mode
  Object.assign(node.style,{position:'relative',minWidth:'0',gap:l.gap+'px',padding:l.padding+'px',alignItems:l.align==='start'?'flex-start':l.align==='end'?'flex-end':l.align,flexGrow:String(l.grow||0)})
  if(l.width)node.style.width=l.width+'px';if(l.height)node.style.height=l.height+'px'
  if(l.mode==='grid'){node.style.display='grid';node.style.gridTemplateColumns=`repeat(${l.columns||2},minmax(0,1fr))`}
  else if(['overlay','anchor'].includes(l.mode)){node.style.display='grid';node.style.minHeight=(l.height||280)+'px'}
  else{node.style.display='flex';node.style.flexDirection=l.mode==='row'?'row':'column';if(l.mode==='scroll'){node.style.overflow='auto';node.style.maxHeight=(l.height||400)+'px'}}
  const anchor=l.anchor
  if(anchor&&anchor!=='flow'){node.style.position='absolute';if(anchor==='fill')node.style.inset='0';else if(anchor==='center'){node.style.left='50%';node.style.top='50%';node.style.transform='translate(-50%,-50%)'}else{const[v,h]=anchor.split('-');node.style[v]='0';node.style[h]='0'}}
}
function mountObject(host,o,api){
  const p=o.props||{},d=api.scene.descriptor(o.type),run=task=>Promise.resolve().then(task).catch(e=>api.engine.error(e.message))
  const button=(label,fn)=>{const b=element('button','ne-button ne-primary',label);b.type='button';b.addEventListener('click',()=>run(fn));return b}
  let update=()=>{},dispose=()=>{}
  const runtime=()=>api.scene.runtime?.scene.id===api.sceneId?api.scene.runtime:null
  const state=()=>runtime()?.state(o.id),refState=key=>o.refs?.[key]?runtime()?.state(o.refs[key]):undefined
  if(d?.mount){const view=d.mount(host,o,api)||{};return typeof view==='function'?{update,dispose:view}:{update:view.update||update,dispose:view.dispose||dispose}}
  if(!d){host.append(element('p','scene-missing','缺少对象类型插件：'+o.type));return{update,dispose}}
  if(o.type==='text'){const n=element('p','scene-text');n.style.fontSize=(p.size||18)+'px';host.append(n);update=()=>{n.textContent=state()?.text??p.text??'一段新的文字'}}
  else if(o.type==='container'&&p.title)host.append(element('h3','scene-container-title',p.title))
  else if(o.type==='image'){const n=element('img','scene-image');n.alt=o.name||'场景图片';n.style.objectFit=p.fit||'cover';n.src=api.engine.asset(p.asset)||'';host.append(n)}
  else if(o.type==='button'||o.type==='scene-link'){const b=button(p.text||'点击这里',()=>api.scene.call(o.id,o.type==='button'?'click':'open',{}));host.append(b);update=()=>{b.disabled=!api.scene.playing}}
  else if(o.type==='value'){const n=element('div','scene-value');host.append(n);update=()=>{const target=api.scene.expanded(api.sceneId).objects.find(x=>x.id===o.refs?.value);n.textContent=(p.label||target?.props?.label||'数值')+' '+(refState('value')?.value??target?.props?.initial??0)}}
  else if(o.type==='chat-window'){
    host.classList.add('scene-chat');const head=element('header','scene-chat-head'),badge=element('span','ne-badge'),list=element('div','scene-messages'),form=element('form','scene-compose'),input=element('textarea','ne-textarea'),send=element('button','ne-button ne-primary','发送'),notice=element('p','scene-chat-notice')
    const cancel=button('取消回复',()=>api.scene.call(o.refs.session,'cancel',{}))
    cancel.hidden=true
    input.placeholder='说些什么，让故事继续…';input.setAttribute('aria-label',(p.title||'聊天窗口')+'消息');input.maxLength=4000;input.rows=2;send.type='submit';list.setAttribute('aria-live','polite');head.append(element('strong','',p.title||'角色对话'),badge);form.append(input,send,cancel);host.append(head,list,notice,form)
    const submit=event=>{event.preventDefault();if(!input.value.trim())return;const value=input.value;run(async()=>{const sent=await api.scene.call(o.refs.session,'send',{text:value});if(sent!==false&&input.value===value)input.value=''})};form.addEventListener('submit',submit)
    let last=''
    update=()=>{
      const target=api.scene.expanded(api.sceneId).objects.find(x=>x.id===o.refs?.session),s=refState('session')||{messages:[],busy:false,error:''},next=JSON.stringify(s.messages)
      badge.textContent=target?.props?.source==='ai'?'AI 对话':'预写文本'
      if(next!==last){last=next;list.replaceChildren();if(!s.messages.length)list.append(element('p','scene-chat-empty',api.scene.playing?'向角色打个招呼吧。':'试玩后，在这里和角色交谈。'));for(const m of s.messages.slice(-60))list.append(element('p','scene-message is-'+m.role,m.content));list.scrollTop=list.scrollHeight}
      notice.textContent=s.error||(s.busy?'角色正在回复…':'');send.disabled=!api.scene.playing||s.busy;send.hidden=!!s.busy;cancel.hidden=!s.busy;input.disabled=!api.scene.playing||s.busy
    };dispose=()=>form.removeEventListener('submit',submit)
  }
  return{update,dispose}
}
export function mountScene(host,{scene,engine,ui,sceneId,onSelect,design=false}){
  host.classList.add('scene-canvas');let signature='',views=[],disposed=false,lastWidth=0,resizeFrame
  const cleanup=()=>{for(const v of views)v.dispose();views=[];host.replaceChildren()}
  const readId=()=>typeof sceneId==='function'?sceneId():sceneId||scene.runtime?.scene.id||scene.selected
  function refresh(){
    if(disposed)return
    const id=readId(),expanded=scene.expanded(id),next=JSON.stringify(expanded)+':'+scene.playing+':'+scene.types().map(d=>d.type).join(',')
    if(next!==signature){
      signature=next;cleanup();const mounts=new Map(),visual=expanded.objects.filter(o=>scene.descriptor(o.type)?.visual!==false)
      for(const o of visual){const n=element('section','scene-object');n.dataset.objectId=o.id;n.setAttribute('aria-label',o.name||scene.descriptor(o.type)?.label||o.type);if(design){n.tabIndex=0;n.classList.add('is-design');n.addEventListener('click',event=>{event.stopPropagation();onSelect?.(o.id)})}mounts.set(o.id,n)}
      for(const o of visual){const n=mounts.get(o.id);let parentId=o.parent;while(parentId&&!mounts.has(parentId))parentId=expanded.objects.find(x=>x.id===parentId)?.parent;const parent=mounts.get(parentId);(parent||host).append(n);const view=mountObject(n,o,{scene,engine,ui,sceneId:id});views.push({...view,node:n,object:o,parentId})}
    }
    const compact=lastWidth>0&&lastWidth<600
    for(const view of views){
      let status
      if(scene.runtime?.scene.id===id)status=scene.runtime.status(view.object.id)
      else{status={visible:true,enabled:true,paused:false};let o=view.object;while(o){status.visible&&=o.visible!==false;status.enabled&&=o.enabled!==false;status.paused||=o.paused===true;o=expanded.objects.find(x=>x.id===o.parent)}}
      view.node.hidden=!status.visible&&!design;view.node.inert=!design&&(!status.enabled||status.paused)
      applyLayout(view.node,view.object.layout,compact)
      const parent=expanded.objects.find(x=>x.id===view.parentId),parentLayout={...parent?.layout,...(compact?parent?.layout?.compact:{})}
      if(['overlay','anchor'].includes(parentLayout.mode))view.node.style.gridArea='1 / 1'
      if(view.node.hidden)view.node.style.display='none'
      view.update()
    }
  }
  const owner={effect:fn=>fn()},off=scene.observe(owner,refresh)
  // ResizeObserver runs during layout. Defer writes to avoid a resize feedback error.
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{
    const width=entries[0].contentRect.width,changed=(lastWidth<600)!==(width<600)||!lastWidth
    lastWidth=width
    if(changed){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>refresh())}
  }):null
  resize?.observe(host);refresh()
  return{refresh,dispose(){disposed=true;off();resize?.disconnect();if(resizeFrame!==undefined)cancelAnimationFrame(resizeFrame);cleanup()}}
}
