export default function(ctx,sdk) {
  const engine=ctx.narrative,ui=ctx.narrativeUI
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  let timer,latest,dialog
  const key=(slot)=>'save:'+engine.project.id+':'+slot
  const read=slot=>{try{return JSON.parse(sdk.storage.local.getItem(key(slot))||'null')}catch{return null}}
  const button=(text,action,cls='ne-button')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',()=>Promise.resolve().then(action).catch(e=>sdk.toast(e.message)));return b}
  function capture(){if(!engine.runtime||engine.runtime.busy)return null;return{projectId:engine.project.id,revision:engine.project.revision,label:engine.scene().title,updatedAt:new Date().toISOString(),runtime:structuredClone(engine.runtime)}}
  function save(slot){const value=capture();if(!value)throw Error('请先试玩作品，等待当前对话结束后存档');sdk.storage.local.setItem(key(slot),JSON.stringify(value));sdk.toast('进度已保存');return value}
  function load(slot){const value=read(slot);if(!value)throw Error('这个位置还没有存档');if(value.revision!==engine.project.revision)throw Error('作品已编辑，旧存档不再匹配。请重新试玩当前版本');engine.restoreRuntime(value.runtime);dialog?.close()}
  function renderSlots(container){
    container.replaceChildren()
    container.append(el('p','ne-muted','进度保存在当前浏览器，包含对白位置、好感度、已触发事件和聊天记录。'))
    for(const slot of ['auto','1','2','3']){
      const value=read(slot),card=el('div','ne-card ne-save-card'),title=el('div','ne-row')
      title.append(el('strong','',slot==='auto'?'自动进度':'存档 '+slot),el('span','ne-badge',value?(value.revision===engine.project.revision?'可继续':'版本已变化'):'空'))
      card.append(title,el('p','ne-muted',value?value.label:'在喜欢的片刻，留下一份记忆。'))
      if(value)card.append(el('time','ne-muted',new Date(value.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})))
      const actions=el('div','ne-row')
      if(slot!=='auto'){const b=button(value?'覆盖存档':'保存进度',()=>{save(slot);renderSlots(container)});b.disabled=engine.mode!=='play';actions.append(b)}
      if(value){const b=button('继续游玩',()=>load(slot),'ne-button ne-primary');b.disabled=value.revision!==engine.project.revision;actions.append(b)}
      card.append(actions);container.append(card)
    }
  }
  function show(){dialog?.remove();dialog=el('dialog','ne-library-dialog ne-saves-dialog');const head=el('div','ne-modal-heading'),body=el('div','ne-modal-body ne-stack');head.append(el('h2','','保存这段故事'),button('×',()=>dialog.close(),'ne-button ne-close'));dialog.append(head,body);document.querySelector('.ne-app').append(dialog);renderSlots(body);dialog.showModal();dialog.addEventListener('close',()=>{dialog?.remove();dialog=null},{once:true})}
  ui.registerPanel(ctx,{id:'saves',label:'存档与进度',icon:'▣',order:80,render:renderSlots})
  ui.registerToolbar(ctx,{id:'save-dialog',label:'存档 / 读档',icon:'▣',place:'player',run:show})
  engine.observe(ctx,event=>{
    if(event.type==='runtime'&&engine.mode==='play'){
      const value=capture();if(!value)return
      latest={key:key('auto'),value};clearTimeout(timer);timer=setTimeout(()=>{try{sdk.storage.local.setItem(latest.key,JSON.stringify(latest.value))}catch{sdk.toast('自动进度保存失败，请检查浏览器存储空间')}},250)
    }
  })
  ctx.effect(()=>()=>{clearTimeout(timer);if(latest)try{sdk.storage.local.setItem(latest.key,JSON.stringify(latest.value))}catch{};dialog?.remove()})
}
