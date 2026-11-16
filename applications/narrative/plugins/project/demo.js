import { defaultComposition } from './composition.js'
const asset = (id,name,file) => ({ id,name,kind:'image',url:'/builtin/project/assets/' + file + '.png' })
export function templateProject(template = 'salon', title, id = crypto.randomUUID()) {
  if (template !== 'salon') throw Object.assign(Error('当前仅提供七日会客厅模板'), {status:400})
  const p = {
    schemaVersion:1,id,revision:0,title:title || '七日会客厅',template,
    description:'两个独立角色会话、天数推进与关系变化。打开场景搭建，自由重组窗口和事件。',startNodeId:'main',
    assets:[asset('observatory','山顶观测站','observatory'),asset('station','雨后车站','station'),asset('lin','林栀 · 默认立绘','lin'),asset('yao','遥 · 默认立绘','yao'),{id:'rain-theme',name:'星夜 · 循环音乐',kind:'audio',url:'/builtin/project/assets/rain-theme.wav'}],
    characters:[{id:'lin',name:'林栀',description:'山顶观测站的年轻研究员，喜欢星空和旧唱片。',personality:'温柔、好奇，偶尔有一点笨拙；会认真倾听别人的故事。',portrait:'lin',expressions:{neutral:'lin',happy:'lin',sad:'lin'},color:'#c6b7f4'},{id:'yao',name:'遥',description:'总是带着相机的旅人。',personality:'开朗、直率，善于发现生活里的小事。',portrait:'yao',expressions:{neutral:'yao',happy:'yao',sad:'yao'},color:'#e7bb94'}],
    variables:[],rules:[],
    // Schema v1 keeps a minimal runtime envelope; scene objects own gameplay.
    nodes:[{id:'main',type:'scene',title:'会客厅',stage:{background:'',characterId:'',expression:'neutral',position:50,scale:100},lines:[],choices:[]}],
    settings:{dialogueStyle:'chat',accent:'#8c77cb',bgm:'rain-theme',volume:.35,worldInfo:'故事发生在七日会客厅。林栀喜欢星空和旧唱片，遥热爱摄影与旅行。角色只知道玩家在交谈中分享的经历。'}
  }
  p.composition = defaultComposition(p)
    p.composition.scenes[0] = {id:'main',name:'会客厅',objects:[
      {id:'layout',type:'container',name:'会客厅布局',props:{},layout:{mode:'column',gap:16,padding:24}},
      {id:'heading',type:'text',name:'欢迎语',parent:'layout',props:{text:'七日会客厅 · 每一次交谈，都有新的故事',size:24}},
      {id:'day',type:'counter',name:'天数',props:{initial:1,min:1,max:7,label:'第几天'}},
      {id:'relationship',type:'counter',name:'共同经历',props:{initial:0,min:0,max:100,label:'共同经历'}},
      {id:'day-view',type:'value',parent:'layout',name:'天数显示',props:{label:'今天是第'},refs:{value:'day'}},
      {id:'relation-view',type:'value',parent:'layout',name:'共同经历显示',props:{label:'已完成的交谈'},refs:{value:'relationship'}},
      {id:'chats',type:'container',name:'并排聊天',parent:'layout',props:{},layout:{mode:'grid',columns:2,gap:16,compact:{mode:'column'}}},
      {id:'lin-session',type:'conversation',name:'林栀的会话',props:{characterId:'lin',source:'ai',script:'今晚的星空很美。\n谢谢你愿意陪我聊聊。',prompt:'你在会客厅接待来访者，温柔自然地聊天。'}},
      {id:'yao-session',type:'conversation',name:'遥的会话',props:{characterId:'yao',source:'ai',script:'我刚拍到了一张很棒的照片！\n明天一起出门看看吧。',prompt:'你在会客厅分享旅途趣事，开朗地聊天。'}},
      {id:'lin-window',type:'chat-window',name:'林栀',parent:'chats',props:{title:'林栀 · 星空与旧唱片'},refs:{session:'lin-session'}},
      {id:'yao-window',type:'chat-window',name:'遥',parent:'chats',props:{title:'遥 · 路上的故事'},refs:{session:'yao-session'}},
      {id:'next-day',type:'button',name:'推进一天',parent:'layout',props:{text:'开始新的一天'}}
    ],connections:[
      {id:'advance-day',source:'next-day',event:'clicked',target:'day',method:'add',args:{amount:1}},
      {id:'lin-memory',source:'lin-session',event:'completed',target:'relationship',method:'add',args:{amount:1}},
      {id:'yao-memory',source:'yao-session',event:'completed',target:'relationship',method:'add',args:{amount:1}}
    ]}
  return p
}
