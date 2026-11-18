// A game is authored data: these objects work without the story-flow plugin.
export function investigationProject(title,id){
  const clues=[['bench','检查长椅','长椅底下只有一道干燥的方形印记。失物并不是被雨水冲走的。'],['ticket','查看车票','遗落的车票背面写着“相机交给值班员，明早来取”。字迹还很清楚。'],['desk','询问值班室','值班员的登记簿记着：21:10，收到旅客暂存的蓝色相机。']]
  const objects=[
    {id:'stage',type:'container',name:'雨站调查',layout:{mode:'overlay',height:720,grow:1,compact:{height:960}}},
    {id:'background',type:'background-view',name:'雨后站台',parent:'stage',props:{asset:'station',fit:'cover'},layout:{anchor:'fill'}},
    {id:'title',type:'text',name:'调查标题',parent:'stage',props:{text:'雨站失物 · 找到那台蓝色相机',size:28,color:'#fff6dc',background:'#172536'},layout:{anchor:'top-left',padding:28,width:800,compact:{width:320}}},
    {id:'count',type:'counter',name:'发现的线索',props:{initial:0,min:0,max:3}},
    {id:'count-view',type:'value',name:'线索进度',parent:'stage',props:{label:'已发现线索 / 3：'},refs:{value:'count'},layout:{anchor:'top-right',padding:24,width:240,compact:{width:200}}},
    {id:'clues',type:'container',name:'调查地点',parent:'stage',layout:{anchor:'center',mode:'row',gap:20,width:1000,compact:{mode:'column',width:420}}},
    {id:'dialogue',type:'dialogue-view',name:'调查说明',parent:'stage',props:{allowContinue:false,speaker:'调查笔记',text:'末班车已经离开。旅客托你寻找遗失的蓝色相机。点击三个地点收集线索，每处只记录一次；准备好后查看结论。',speed:0},layout:{anchor:'bottom-left',width:1280,height:300,padding:36,compact:{width:540,height:300,padding:20}}},
    {id:'conclusion',type:'button',name:'查看结论',parent:'stage',props:{text:'查看推理结论',unlocked:false},layout:{anchor:'bottom-right',width:200,padding:16}},
    ...clues.map(([id,text])=>({id,type:'choice-list',name:text,parent:'clues',props:{items:[{id,text}]},layout:{grow:1}})),
  ]
  const connections=clues.flatMap(([id,,text])=>[
    {id:id+'-explain',source:id,event:'selected',target:'dialogue',method:'present',args:{value:{speaker:'调查笔记',text,active:true,key:id}}},
    {id:id+'-count',source:id,event:'selected',target:'count',method:'add',args:{amount:1}},
  ])
  connections.push({id:'unlock-conclusion',source:'count',event:'reachedMax',target:'conclusion',method:'unlock'},
    {id:'solve',source:'conclusion',event:'clicked',target:'dialogue',method:'present',args:{value:{speaker:'结论',text:'相机没有失窃。旅客在赶车前将它交给值班员保管，并把取物提醒写在车票背面。你联系了失主，约好明早来取。调查完成。',active:true,key:'solved'}}})
  return {schemaVersion:1,id,revision:0,title:title||'雨站失物',template:'investigation',description:'检查长椅、车票与值班室，寻找相机的去向。由显示、选项、计数器和事件连接组成，无需剧情流程或 AI。',characters:[],assets:[{id:'station',name:'雨后站台',kind:'image',url:'/builtin/project/assets/station.png'}],settings:{dialogueStyle:'novel',accent:'#8c77cb',worldInfo:''},composition:{schemaVersion:1,startSceneId:'station',dependencies:['scene-runtime','scene-ui','background-view','dialogue-view','choice-list'].map(id=>({id,version:'1.0.0'})),prefabs:[],scenes:[{id:'station',name:'雨站调查',objects,connections}]}}
}
