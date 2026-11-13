export default function(ctx,sdk) {
  const e=ctx.narrative,ui=ctx.narrativeUI
  let current=null,token=0,muted=false
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!=null)n.textContent=text;return n}
  const run=fn=>Promise.resolve().then(fn).catch(error=>sdk.toast(error.message))
  const button=(label,fn)=>{const n=el('button','ne-button',label);n.type='button';n.addEventListener('click',()=>run(fn));return n}
  function stop(){token++;if(current){current.pause();current.removeAttribute('src');current.load();current=null}}
  async function play(id,loop=true){
    const asset=e.project.assets.find(a=>a.id===id&&a.kind==='audio');if(!asset)throw Error('请先上传并选择音频素材')
    stop();const stamp=token,audio=new Audio(e.asset(id));current=audio;audio.loop=loop;audio.volume=e.project.settings.volume??.45;audio.muted=muted
    try{await audio.play();if(stamp!==token)audio.pause();else sdk.toast('正在播放：'+asset.name)}catch(error){if(stamp===token){stop();throw Error(error.name==='NotAllowedError'?'点击“播放音乐”后即可听见声音':'无法播放此音频，请使用 MP3、WAV 或 OGG 文件')}}
  }
  e.registerAction(ctx,{type:'play-audio',label:'播放音频',fields:[{key:'asset',label:'音频素材',kind:'asset',assetKind:'audio',default:''},{key:'loop',label:'循环播放',kind:'boolean',default:true}],execute:a=>play(a.asset||e.project.settings.bgm,a.loop!==false)})
  e.registerAction(ctx,{type:'stop-audio',label:'停止音频',execute:()=>stop()})
  ui.registerToolbar(ctx,{id:'sound-toggle',label:'播放音乐',icon:'♫',place:'player',run:()=>play(e.project.settings.bgm,true)})
  ui.registerPanel(ctx,{id:'sound',label:'声音与氛围',icon:'♫',order:70,render(container){
    container.append(el('p','ne-muted','为故事选一首循环背景音乐，也可以在事件规则中加入声音动作。'))
    const field=el('label','ne-field','背景音乐'),select=el('select','ne-select');const none=el('option','','暂不播放');none.value='';select.append(none)
    for(const a of e.project.assets.filter(a=>a.kind==='audio')){const o=el('option','',a.name);o.value=a.id;select.append(o)}select.value=e.project.settings.bgm||'';select.addEventListener('change',()=>run(()=>e.update(p=>{p.settings.bgm=select.value})));field.append(select);container.append(field)
    const volume=el('input');volume.type='range';volume.min='0';volume.max='100';volume.value=String((e.project.settings.volume??.45)*100);volume.setAttribute('aria-label','背景音乐音量');volume.addEventListener('input',()=>{if(current)current.volume=Number(volume.value)/100});volume.addEventListener('change',()=>run(()=>e.update(p=>{p.settings.volume=Number(volume.value)/100},{render:false})));const vf=el('label','ne-field','音量');vf.append(volume);container.append(vf)
    const file=el('input');file.type='file';file.accept='audio/mpeg,audio/wav,audio/ogg';file.hidden=true;file.addEventListener('change',()=>run(async()=>{
      const f=file.files[0];if(!f)return;if(f.size>5*1024*1024||!['audio/mpeg','audio/wav','audio/x-wav','audio/ogg'].includes(f.type))throw Error('请选择不超过 5 MB 的 MP3、WAV 或 OGG 音频')
      const projectId=e.project.id
      const url=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('音频读取失败'));r.readAsDataURL(f)})
      if(e.project.id!==projectId||e.mode!=='edit'||e.held)throw Error('作品状态已变化，请返回编辑器重新上传音频')
      const normalized=String(url).replace('data:audio/x-wav;','data:audio/wav;'),id=crypto.randomUUID()
      e.update(p=>{p.assets.push({id,name:f.name,kind:'audio',mime:f.type,size:f.size,url:normalized});p.settings.bgm=id})
    }));container.append(button('＋ 上传音频',()=>file.click()),file)
    const actions=el('div','ne-row');actions.append(button('▶ 预听',()=>play(select.value,true)),button('停止',()=>{stop();sdk.toast('音乐已停止')}),button('静音 / 取消',()=>{muted=!muted;if(current)current.muted=muted}));container.append(actions,el('p','ne-muted','音乐在用户主动点击后播放；停止试玩或停用插件会释放播放器。'))
  }})
  e.observe(ctx,event=>{if(event.type==='mode')stop()})
  ctx.effect(()=>()=>stop())
}
