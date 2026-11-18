import { mountWorkspace } from './workspace.js'
export default function(ctx,sdk) {
  const engine=ctx.narrative
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  const run=fn=>Promise.resolve().then(fn).catch(e=>sdk.toast(e.message))
  const button=(text,fn,cls='ne-button')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',()=>run(fn));return b}
  const navigate=id=>ui.navigate(id)
  function field(label,value,fn,multi=false){const wrap=el('label','ne-field',label),input=el(multi?'textarea':'input',multi?'ne-textarea':'ne-input');input.value=value;input.addEventListener('change',()=>run(()=>fn(input.value)));wrap.append(input);return wrap}
  async function download(){const blob=new Blob([JSON.stringify(await engine.exportBundle(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=engine.project.title+'.narrative.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  async function importFile(file){if(!file)return;if(file.size>128*1024*1024)throw Error('作品包不能超过 128 MB');await engine.importProject(JSON.parse(await file.text()));navigate('scene.editor')}
  const projectPanel = {id:'project',label:'作品与模板',icon:'▦',order:0,render(container){
    const p=engine.project,overview=el('div','ne-project-overview');overview.append(el('div','ne-template-art','✧'),el('strong','',p.title),el('p','ne-muted',p.description));container.append(overview)
    container.append(field('作品名称',p.title,v=>engine.update(n=>{n.title=v.trim()||p.title})),field('作品简介',p.description,v=>engine.update(n=>{n.description=v}),true))
    const doc=engine.composition,start=el('select','ne-select');start.setAttribute('aria-label','起始场景');for(const scene of doc.scenes){const o=el('option','',scene.name);o.value=scene.id;start.append(o)}start.value=doc.startSceneId;start.addEventListener('change',()=>run(()=>engine.sceneCommand({op:'start-scene',id:start.value})));const startField=el('label','ne-field','起始场景');startField.append(start);container.append(startField)
    const stats=el('div','ne-project-stats');for(const [n,t]of [[doc.scenes.length,'场景'],[p.characters.length,'角色'],[doc.scenes.reduce((sum,s)=>sum+s.connections.length,0),'事件连接']]){const card=el('div');card.append(el('strong','',String(n)),el('span','',t));stats.append(card)}container.append(stats)
    const actions=el('div','ne-stack');actions.append(button('打开作品库 / 从模板新建',()=>showLibrary(false),'ne-button ne-primary'),button('导出当前作品',download))
    const upload=el('input');upload.type='file';upload.accept='.json,.narrative.json';upload.hidden=true;upload.addEventListener('change',()=>run(()=>importFile(upload.files[0])));actions.append(button('导入作品文件',()=>upload.click()),upload);container.append(actions)
    const issues=engine.issues();const health=el('div','ne-health '+(issues.length?'has-issues':''));health.append(el('strong','',issues.length?'有 '+issues.length+' 项需要检查':'✓  作品数据正常'),el('p','ne-muted',issues.length?issues.join('；'):'在场景搭建中检查对象引用和事件连接，再试玩验证。'));container.append(health)
    const note=el('p','ne-muted','作品包包含场景、人物、事件连接与上传素材。接收者可在叙事引擎中导入继续创作；模型密钥单独保存。');container.append(note)
  }}
  async function showLibrary(createOnly){
    const dialog=el('dialog','ne-library-dialog'),head=el('div','ne-modal-heading'),body=el('div','ne-modal-body');head.append(el('h2','',createOnly?'一个新故事，从这里开始':'你的故事收藏'),button('×',()=>dialog.close(),'ne-button ne-close'));dialog.append(head,body);root.append(dialog)
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal()
    const templates=el('div','ne-template-grid')
    for(const [id,icon,name,desc,tags]of [['investigation','⌕','雨站失物','调查三个地点，找回相机。用对白、选项和计数器组合的小型调查玩法。','调查 · 无需剧情流程 · 无需 AI'],['last-train','☾','末班车之前','雨后站台、山顶星光，与林栀的一次告别或约定。预写对白，三个抉择，两个结局。','视觉小说 · 无需 AI · 约 10–15 分钟'],['salon','▦','七日会客厅','独立的双角色聊天窗口，通过事件推进天数与关系。','角色 · 场景 · 事件']]){
      if(id==='last-train' && !engine.hasProjectFormat('stories'))continue
      const b=button('',async()=>{await engine.create(id);dialog.close();navigate('scene.editor')},'ne-template-card');b.append(el('span','ne-template-icon',icon),el('strong','',name),el('p','',desc),el('small','',tags));templates.append(b)
    }
    body.append(el('p','ne-muted','选择一个起始模板。所有作品都能继续组合对象、编辑布局和连接事件。'),templates)
    if(!createOnly){const list=el('div','ne-library-list');body.append(el('h3','','已有作品'),list);for(const p of await engine.list()){const b=button('',async()=>{await engine.open(p.id);dialog.close();navigate('scene.editor')},'ne-library-item');const text=el('div');text.append(el('strong','',p.title),el('span','ne-muted',p.characters+' 位角色'));b.append(el('span','ne-library-dot','✦'),text,el('span','','打开 →'));list.append(b)}}
  }
  const {root,ui}=mountWorkspace(ctx,sdk,engine,{projectPanel,showLibrary,download})
}
