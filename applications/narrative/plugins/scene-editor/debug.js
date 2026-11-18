export function installDebugPanel(ctx,ui,scene){
  ui.registerPanel(ctx,{id:'scene.debug',label:'事件调试',icon:'⌁',order:70,readOnly:true,render(host){
    const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n}
    const bar=el('div'),filter=el('input'),status=el('select'),pause=el('button'),clear=el('button','清空记录'),list=el('div')
    bar.className='ne-row';filter.className='ne-input';filter.placeholder='搜索对象、事件或方法';filter.setAttribute('aria-label','筛选事件记录')
    status.className='ne-select';status.setAttribute('aria-label','调用结果');for(const[value,label]of [['all','全部结果'],['error','仅失败']]){const option=el('option',label);option.value=value;status.append(option)}
    for(const b of [pause,clear]){b.type='button';b.className='ne-button'}
    host.append(el('p','最近 200 条调用。展开可查看参数摘要和错误；记录不写入作品或存档。'),bar,list);bar.append(filter,status,pause,clear)
    function render(){
      pause.textContent=scene.tracing?'暂停记录':'继续记录';list.replaceChildren()
      const rows=scene.traces().filter(r=>(status.value!=='error'||r.status==='error')&&[r.source,r.target,r.event,r.method,r.error].join(' ').toLowerCase().includes(filter.value.toLowerCase()))
      for(const r of rows.reverse()){const row=el('details'),title=el('summary'),body=el('pre');row.className='ne-card';title.textContent=({success:'✓',error:'✕',pending:'…',cancelled:'已取消'})[r.status]+' '+(r.source?r.source+'.'+r.event+' → ':'直接调用 → ')+r.target+'.'+r.method+' · '+(r.duration??0)+'ms';body.textContent=['场景：'+r.sceneId,'参数：'+r.args,r.error?'错误：'+r.error:''].join(String.fromCharCode(10));body.style.whiteSpace='pre-wrap';row.append(title,body);list.append(row)}
      if(!rows.length)list.append(el('p','暂无匹配的调用。开始试玩并操作游戏即可查看。'))
    }
    filter.addEventListener('input',render);status.addEventListener('change',render);pause.addEventListener('click',()=>scene.setTracing(!scene.tracing));clear.addEventListener('click',()=>scene.clearTraces())
    const off=scene.observeTraces({effect:fn=>fn()},render);render();return off
  }})
}
