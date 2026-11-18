const text = (label,defaultValue='',extra={}) => ({kind:'string',label,default:defaultValue,...extra})
const number = (label,value,min=0,max=1000000) => ({kind:'number',label,default:value,min,max})
const copy = v => structuredClone(v)
const validMessages = rows => Array.isArray(rows)&&rows.length<=200&&rows.every(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=8000)
async function setCounter(a,value){
  const max=a.props.max??100,previous=a.state.value
  value=Math.min(max,Math.max(a.props.min??0,value))
  a.set({value});await a.emit('changed',value)
  if(previous<max&&value===max)await a.emit('reachedMax',value)
}
export function builtinTypes(){return[
  {type:'container',label:'布局容器',container:true,fields:{title:text('标题')},methods:{},events:[]},
  {type:'text',label:'文字',fields:{text:text('文字内容','一段新的文字',{multiline:true}),size:number('字号',18,10,72),color:text('文字颜色','#2d2938',{maxLength:30}),background:text('文字底色（空为透明）','',{maxLength:30})},methods:{setText:{label:'替换文字',fields:{text:text('文字','',{required:true})},run(a,v){a.set({text:v.text});return a.emit('changed',v.text)}}},events:['changed'],initial:p=>({text:p.text||'一段新的文字'})},
  {type:'image',label:'图片',fields:{asset:{kind:'asset',label:'图片素材',default:''},fit:{...text('填充方式','cover'),options:[['cover','裁切填充'],['contain','完整显示']]}},methods:{},events:[]},
  {type:'button',label:'按钮',fields:{text:text('按钮文字','点击这里'),unlocked:{kind:'boolean',label:'初始可点击',default:true}},events:['clicked'],initial:p=>({unlocked:p.unlocked!==false}),methods:{
    click:{label:'点击',fields:{},run:a=>a.state.unlocked===false?false:a.emit('clicked')},
    unlock:{label:'解锁按钮',fields:{},run:a=>a.set({unlocked:true})},
  }},
  {type:'counter',label:'数值状态',visual:false,fields:{label:text('数值名称','数值'),initial:number('初始值',0,-1000000),min:number('最小值',0,-1000000),max:number('最大值',100,-1000000)},
    initial:p=>{const min=p.min??0,max=p.max??100;if(min>max)throw Error('最小值不能大于最大值');return{value:Math.min(max,Math.max(min,p.initial??0))}},
    restore:s=>{if(!Number.isFinite(s.value))throw Error('数值存档无效');return{value:s.value}},events:['changed','reachedMax'],methods:{
      add:{label:'增减数值',fields:{amount:number('变化量',1,-1000000)},run:(a,v)=>setCounter(a,a.state.value+(v.amount??1))},
      set:{label:'设置数值',fields:{value:number('目标值',0,-1000000)},run:(a,v)=>setCounter(a,v.value??0)}
    }},
  {type:'value',label:'数值显示',fields:{label:text('显示名称','数值')},refs:{value:'counter'},methods:{},events:[]},
  {type:'conversation',label:'角色会话',visual:false,fields:{characterId:{kind:'character',label:'角色',default:''},source:{...text('内容来源','script'),options:[['script','预写文本'],['ai','AI 生成']]},script:text('预写回复（每行一轮）','你好，很高兴见到你。\n明天也来聊聊吧。',{multiline:true}),prompt:text('会话提示','',{multiline:true})},
    initial:()=>({messages:[],turn:0,busy:false,error:''}),
    restore:s=>{if(!validMessages(s.messages)||!Number.isSafeInteger(s.turn)||s.turn<0)throw Error('聊天存档无效');return{messages:copy(s.messages),turn:s.turn,busy:false,error:''}},
    interrupt:s=>({...s,busy:false,error:'对话已取消，可重新发送'}),events:['completed'],methods:{
      cancel:{label:'取消回复',fields:{},run:a=>a.cancel()},
      send:{label:'发送消息',fields:{text:text('玩家消息','',{required:true,maxLength:4000})},async run(a,input){
        const content=input.text?.trim();if(!content)throw Error('请输入消息');if(a.state.busy)throw Error('正在等待回复')
        const before=a.state;a.set({...before,busy:true,error:''})
        try{
          let reply
          if((a.props.source||'script')==='script'){const lines=(a.props.script||'').split(/\r?\n/).filter(x=>x.trim());reply=lines[before.turn];if(!reply)throw Error('预写回复已结束，请在编辑器补充内容')}
          else {
            const ai=a.services.service('ai');if(!ai)throw Error('请启用 AI 对话插件')
            const project=a.services.engine.project,character=project.characters.find(c=>c.id===a.props.characterId)
            const history=[];let size=content.length;for(const m of [...before.messages].reverse()){if(history.length>=39||size+m.content.length>48000)break;history.unshift(m);size+=m.content.length}
            const result=await ai.reply({character:character?{id:character.id,name:character.name,description:character.description,personality:character.personality}:{name:'角色'},worldInfo:project.settings.worldInfo||'',prompt:a.props.prompt||'',messages:[...history,{role:'user',content}]},a.signal)
            reply=result.reply
          }
          if(!a.current())return false
          if(typeof reply!=='string'||!reply.trim()||reply.length>8000)throw Error('模型没有返回有效的角色文字')
          a.set({messages:[...before.messages,{role:'user',content},{role:'assistant',content:reply}].slice(-200),turn:before.turn+1,busy:false,error:''})
        }catch(error){if(!a.current())return false;a.set({...before,busy:false,error:error.message});throw error}
        await a.emit('completed',{text:content,reply:a.state.messages.at(-1)?.content})
        return true
      }}
    }},
  {type:'chat-window',label:'聊天窗口',fields:{title:text('窗口标题','角色对话')},refs:{session:'conversation'},methods:{},events:[]},
  {type:'scene-link',label:'场景切换按钮',fields:{text:text('按钮文字','前往下一个场景'),scene:{kind:'scene',label:'目标场景',default:''}},methods:{open:{label:'打开场景',fields:{},run:a=>a.services.service('navigation').open(a.props.scene)}},events:[]}
].map(d=>({...d,plugin:'scene-ui'}))}
