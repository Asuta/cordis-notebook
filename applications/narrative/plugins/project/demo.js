const asset = (id,name,file) => ({ id,name,kind:'image',url:'/builtin/project/assets/' + file + '.png' })
const stage = (background = 'observatory', characterId = 'lin') => ({ background,characterId,expression:'neutral',position:62,scale:100 })
const line = (speaker,text) => ({ speaker,text })
const choice = (id,text,target,actions = [],condition) => ({ id,text,target,actions,...(condition ? {condition} : {}) })
const chat = next => ({ characterId:'lin',prompt:'你是林栀，在山顶观测站等待流星雨。保持自然温柔的语气，每次回复不超过两句话，可以聊星空、旧唱片和来访者的心事。',maxTurns:2,next,label:'把唱片递给她',demoReplies:['每次等流星的时候，我都会放这张旧唱片。你呢，有没有一首会让你想起某个人的歌？','原来是这样。谢谢你愿意告诉我。今晚的星空，应该会比平时更温柔一点。'] })
export function templateProject(template = 'hybrid', title, id = crypto.randomUUID()) {
  const p = {
    schemaVersion:1,id,revision:0,title:title || ({hybrid:'星光观测站',galgame:'雨停之后',tavern:'深夜的第七封信'}[template] || '未命名作品'),
    description:'一场流星雨，一张旧唱片，和一次意料之外的相遇。用插件把这个故事变成你自己的作品。',template,startNodeId:'arrival',
    assets:[asset('observatory','山顶观测站','observatory'),asset('station','雨后车站','station'),asset('lin','林栀 · 默认立绘','lin'),asset('yao','遥 · 默认立绘','yao'),{id:'rain-theme',name:'星夜 · 循环音乐',kind:'audio',url:'/builtin/project/assets/rain-theme.wav'}],
    characters:[{id:'lin',name:'林栀',description:'山顶观测站的年轻研究员，喜欢星空和旧唱片。',personality:'温柔、好奇，偶尔有一点笨拙；会认真倾听别人的故事。',portrait:'lin',expressions:{neutral:'lin',happy:'lin',sad:'lin'},color:'#c6b7f4'},{id:'yao',name:'遥',description:'总是带着相机的旅人。',personality:'开朗、直率，善于发现生活里的小事。',portrait:'yao',expressions:{neutral:'yao',happy:'yao',sad:'yao'},color:'#e7bb94'}],
    variables:[{id:'trust',name:'好感度',initial:0,min:0,max:10},{id:'courage',name:'勇气',initial:1,min:0,max:10}],
    nodes:[
      {id:'arrival',type:'story',title:'01 · 星光下的初遇',stage:stage(),lines:[line('','山路尽头，观测站的灯还亮着。你推开门，晚风带来一阵遥远的音乐。'),line('lin','你也来等今晚的流星雨吗？还好，你没有错过。'),line('lin','这里一直空着一个位置。要不要坐下来，陪我聊一会儿？')],choices:[choice('stay','留下来，听她说说星空','talk',[{type:'add-variable',variable:'trust',value:1}]),choice('leave','先去露台看看','terrace')]},
      {id:'talk',type:'chat',title:'02 · 让故事自由发生',stage:stage(),lines:[line('lin','我一直觉得，每个人心里都藏着一颗还没被命名的星。你想聊点什么？')],choices:[],chat:chat('gift')},
      {id:'gift',type:'story',title:'03 · 一张旧唱片',stage:stage(),lines:[line('','你从包里拿出一张旧唱片。封面上的星图，和她桌上的那张一模一样。'),line('lin','这张唱片……我找了好久。你愿意把它送给我吗？')],choices:[choice('give','把唱片送给她','invitation',[{type:'add-variable',variable:'trust',value:2},{type:'expression',value:'happy'}]),choice('keep','先一起听完这首歌','quiet')]},
      {id:'terrace',type:'story',title:'04 · 露台的风',stage:stage('station','yao'),lines:[line('yao','从这里看过去，整座城市就像一片倒过来的星空。'),line('','你拍下一张照片，又想起观测站里那个等待的人。')],choices:[choice('back','回去找林栀','talk',[{type:'add-variable',variable:'trust',value:1}]),choice('home','今晚就到这里吧','quiet')]},
      {id:'invitation',type:'story',title:'05 · 流星雨的约定',stage:{...stage(),expression:'happy'},lines:[line('lin','谢谢你。我想，今晚终于可以听着它，等那颗流星了。')],choices:[choice('together','和她一起等流星','starlight',[],{type:'variable',variable:'trust',op:'gte',value:3}),choice('goodnight','说一声晚安','quiet')]},
      {id:'starlight',type:'ending',title:'结局 · 有你的星空',stage:{...stage(),expression:'happy'},lines:[line('','第一颗流星划过时，她悄悄把耳机的另一端递给了你。'),line('lin','明年的今天……你还会来吗？')],choices:[]},
      {id:'quiet',type:'ending',title:'结局 · 晚风来信',stage:stage('station',''),lines:[line('','你沿着山路慢慢走下去。远处的灯光里，似乎还有一首歌没有唱完。'),line('','有些相遇不需要结局。下次，记得带着新的故事回来。')],choices:[]}
    ],
    rules:[{id:'first-gift',name:'收到礼物，露出笑容',event:'choice.select',nodeId:'gift',once:true,condition:{type:'variable',variable:'trust',op:'gte',value:3},actions:[{type:'expression',value:'happy'}]}],
    settings:{dialogueStyle:'novel',accent:'#8c77cb',bgm:'rain-theme',volume:.35,worldInfo:'故事发生在海边城市的山顶观测站。今夜有流星雨。林栀喜欢旧唱片，期待有人陪她等待。角色不知道玩家未说出口的经历。'}
  }
  if (template === 'galgame') { p.nodes = p.nodes.filter(n => n.id !== 'talk'); for (const n of p.nodes) for (const c of n.choices) if (c.target === 'talk') c.target = 'gift'; p.description = '选择、相遇与分支结局。一个可以立即改写的视觉小说模板。' }
  if (template === 'tavern') { const n = p.nodes.find(n => n.id === 'talk'); n.title = '01 · 今晚，聊点什么'; n.chat.maxTurns = 20; n.chat.label = '向她道晚安'; n.chat.next = 'quiet'; p.startNodeId = 'talk'; p.nodes = [n,p.nodes.find(n => n.id === 'quiet')]; p.rules = []; p.settings.dialogueStyle = 'chat'; p.description = '设定角色与世界，让每次对话成为新的故事。' }
  return p
}
