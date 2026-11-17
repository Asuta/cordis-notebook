export default function(ctx) {
  ctx.sceneRuntime.register(ctx,{type:'dialogue-view',label:'对白显示',plugin:'dialogue-view',fields:{speaker:{kind:'string',label:'说话人',default:'旁白'},text:{kind:'string',label:'预览文字',default:'在这里开始新的故事。',multiline:true},speed:{kind:'number',label:'每字间隔（毫秒）',default:28,min:0,max:200}},events:['continued','completed','started'],
    initial:p=>({speaker:p.speaker||'旁白',text:p.text||'',key:'',active:true,revealed:false}),
    methods:{
      present:{label:'显示对白',fields:{value:{kind:'json',label:'对白数据',required:true}},run(a,{value:v}){if(!v||typeof v.text!=='string'||v.text.length>16000||typeof v.speaker!=='string')throw Error('对白需要 speaker 和 text');const same=a.state.key===v.key&&a.state.text===v.text;a.set({speaker:v.speaker,text:v.text,key:v.key||v.text,active:v.active!==false,revealed:!v.text || (same?a.state.revealed:false)});return a.emit('started')}},
      reveal:{label:'显示整句',fields:{},async run(a){if(a.state.revealed||!a.state.active)return;a.set({...a.state,revealed:true});await a.emit('completed')}},
      advance:{label:'显示整句或继续',fields:{},async run(a){if(!a.state.active)return;if(!a.state.revealed){a.set({...a.state,revealed:true});await a.emit('completed')}else await a.emit('continued')}},
    },
    mount(host,o,{scene,engine}){
      host.classList.add('dialogue-view');const box=document.createElement('div');box.className='dialogue-box';box.tabIndex=0
      const name=document.createElement('strong'),text=document.createElement('p'),next=document.createElement('button');name.className='dialogue-speaker';text.className='dialogue-text';next.className='dialogue-next';next.type='button';next.textContent='继续 ▷';box.append(name,text,next);host.append(box)
      let disposed=false,timer,key='',shown=0,chars=[],currentRuntime=null
      const available=()=>{const r=scene.runtime;if(!scene.playing||!r||document.hidden||host.closest('[inert],[hidden]')||host.closest('.ne-app')?.querySelector('dialog[open]:not(.playback-focus)'))return false;const s=r.status(o.id);return s.visible&&s.enabled&&!s.paused}
      const call=method=>scene.call(o.id,method,{}).catch(e=>{if(!disposed)engine.error(e.message)})
      const tick=()=>{if(disposed)return;if(!available()){timer=setTimeout(tick,80);return}shown=Math.min(chars.length,shown+1);text.textContent=chars.slice(0,shown).join('');if(shown<chars.length)timer=setTimeout(tick,o.props?.speed??28);else void call('reveal')}
      const click=()=>{if(available())void call('advance')}
      const keydown=e=>{if(e.target===next)return;if([' ','Enter'].includes(e.key)&&!e.repeat){e.preventDefault();e.stopPropagation();click()}}
      box.addEventListener('click',click);box.addEventListener('keydown',keydown)
      return{update(){
        const s=scene.runtime?.state(o.id)||{...o.props,active:true,revealed:true};name.textContent=s.speaker||'旁白';box.hidden=s.active===false;next.disabled=!scene.playing
        const nextKey=JSON.stringify([s.key,s.text,scene.playing]);if(nextKey!==key||currentRuntime!==scene.runtime){key=nextKey;currentRuntime=scene.runtime;clearTimeout(timer);chars=Array.from(s.text||'');shown=0;text.textContent='';if(scene.playing&&!s.revealed&&(o.props?.speed??28)>0)timer=setTimeout(tick,o.props?.speed??28);else{shown=chars.length;text.textContent=chars.join('');if(scene.playing&&!s.revealed)queueMicrotask(()=>{if(!disposed&&available())void call('reveal')})}}
        if(s.revealed||!scene.playing){clearTimeout(timer);text.textContent=chars.join('');shown=chars.length}
      },dispose(){disposed=true;clearTimeout(timer);box.removeEventListener('click',click);box.removeEventListener('keydown',keydown);box.remove()}}
    }
  ,})
}
