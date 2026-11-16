export default function(ctx,sdk) {
  const engine=ctx.narrative, panels=new Map(), surfaces=new Map(), tools=new Map(), mounted=new Map()
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
  const run=fn=>Promise.resolve().then(fn).catch(e=>sdk.toast(e.message))
  const button=(text,fn,cls='ne-button')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',()=>run(fn));return b}
  const root=el('main','ne-app'), header=el('header','ne-header'), layout=el('div','ne-layout'), nav=el('aside','ne-sidebar'), center=el('section','ne-center'), inspector=el('aside','ne-inspector')
  const badge=el('div','ne-brand-mark','◈'), brand=el('div','ne-brand'), title=el('input','ne-project-title'), status=el('span','ne-save-status'), headerTools=el('div','ne-header-tools')
  title.setAttribute('aria-label','作品名称');title.maxLength=120
  title.addEventListener('change',()=>run(()=>engine.update(p=>{p.title=title.value.trim()||p.title})))
  const brandText=el('div','ne-brand-text');brandText.append(el('strong','','叙事引擎'),el('span','','把灵感，变成可以游玩的故事'));brand.append(badge,brandText)
  const projectHead=el('div','ne-project-heading');projectHead.append(el('span','ne-header-divider','/'),title,status)
  header.append(brand,projectHead,headerTools)
  const navHeading=el('div','ne-nav-heading','创作空间'), navList=el('nav','ne-nav-list'), navBottom=el('div','ne-nav-bottom')
  navBottom.append(el('div','ne-mini-symbol','✧'),el('strong','','每个故事，都有自己的形状'),el('p','','添加插件，给你的作品更多可能。'),button('◈  管理插件',()=>document.querySelector('#manage-plugins')?.click(),'ne-button ne-manage-button'))
  nav.append(navHeading,navList,navBottom)
  const centerHead=el('div','ne-center-heading'), sceneTitle=el('h2','',''), sceneBadge=el('span','ne-badge','实时预览'), sceneMeta=el('span','ne-preview-meta','自适应场景')
  const sceneHeadText=el('div');sceneHeadText.append(el('span','ne-eyebrow','你的故事，正在发生'),sceneTitle)
  const previewTools=el('div','ne-row');previewTools.append(sceneBadge,sceneMeta)
  centerHead.append(sceneHeadText,previewTools)
  const preview=el('div','ne-preview'), previewEmpty=el('div','ne-stage-placeholder')
  previewEmpty.append(el('span','','✧'),el('strong','','为故事搭建一个舞台'),el('p','','在插件管理中启用场景基础对象插件'))
  preview.append(previewEmpty)
  const below=el('div','ne-below-preview'), previewHint=el('span','ne-muted'), playerTools=el('div','ne-player-tools');below.append(previewHint,playerTools)
  const runtimeError=el('div','ne-runtime-error');runtimeError.setAttribute('role','alert');runtimeError.hidden=true
  center.append(centerHead,preview,runtimeError,below)
  layout.append(nav,center,inspector);root.append(header,layout);sdk.mount('app',root)
  let active='scene.editor', panelDispose, panelKey, disposed=false
  const icons={GitBranch:'⑂',SlidersHorizontal:'☷',MessageSquare:'▤',MessagesSquare:'◌',Sparkles:'✧',PersonStanding:'♙',UserRound:'◎',Image:'▧',Layers:'▱',Music:'♫',Save:'▣',Settings:'⚙'}
  function sorted(map){return[...map.values()].sort((a,b)=>(a.order||0)-(b.order||0)||a.id.localeCompare(b.id))}
  function renderNav(){
    navList.replaceChildren()
    for(const p of sorted(panels)){
      const b=button('',()=>navigate(p.id),'ne-nav-item'+(active===p.id?' is-active':''));b.dataset.panel=p.id
      b.append(el('span','ne-nav-icon',icons[p.icon]||p.icon||'◇'),el('span','',p.label));navList.append(b)
    }
  }
  function renderPanel(){
    if(disposed)return
    if(!panels.has(active))active=panels.has('scene.editor')?'scene.editor':sorted(panels)[0]?.id
    const nextKey=active+':'+engine.project.id+':'+engine.mode
    if(panels.get(active)?.wide&&panelKey===nextKey){renderNav();return}
    panelDispose?.();panelDispose=null;inspector.replaceChildren()
    panelKey=nextKey
    const p=panels.get(active);if(!p)return
    root.classList.toggle('is-wide-panel',Boolean(p.wide)&&engine.mode!=='play')
    const h=el('div','ne-inspector-heading');h.append(el('span','ne-eyebrow','调整每一个细节'),el('h2','',p.label))
    const body=el('div','ne-inspector-body');inspector.append(h,body)
    try{panelDispose=p.render(body)}catch(e){body.append(el('p','ne-empty',e.message))}
    renderNav()
  }
  async function navigate(id){if(panels.has(id)){if(active!==id&&engine.mode==='edit')await panels.get(active)?.beforeLeave?.();active=id;renderPanel()}}
  function renderSurfaces(){
    const wanted=surfaces.has('scene.player')?new Map([['scene.player',surfaces.get('scene.player')]]):surfaces
    for(const[id,m]of mounted)if(!wanted.has(id)){m.dispose?.();m.host.remove();mounted.delete(id)}
    for(const s of sorted(wanted))if(!mounted.has(s.id)){
      const host=el('div','ne-surface ne-surface-'+s.id);host.style.zIndex=String(s.order||0);preview.append(host)
      try{const dispose=s.mount(host);mounted.set(s.id,{host,dispose})}catch(e){host.remove();sdk.toast(e.message)}
    }
    previewEmpty.hidden=surfaces.size>0
  }
  function renderTools(){
    const playing=engine.mode==='play'
    headerTools.replaceChildren();playerTools.replaceChildren()
    if(playing){headerTools.append(button('← 返回编辑',()=>engine.stop(),'ne-button ne-secondary'),button('↺ 重新开始',()=>engine.play(),'ne-button'))}
    else headerTools.append(button('＋ 新建作品',()=>showLibrary(true),'ne-button ne-secondary'),button('↗ 导出',download,'ne-button ne-secondary'),button('▶  试玩作品',()=>engine.play(),'ne-button ne-primary'))
    for(const t of sorted(tools))(t.place==='header'?headerTools:playerTools).append(button((t.icon?t.icon+' ':'')+t.label,t.run,'ne-button ne-secondary'))
  }
  function refresh(){renderNav();renderPanel();renderSurfaces();renderTools();renderState()}
  function renderState(){
    const playing=engine.mode==='play';root.classList.toggle('is-playing',playing);root.inert=engine.held
    root.style.setProperty('--ne-accent',engine.project.settings.accent)
    if(document.activeElement!==title)title.value=engine.project.title
    title.disabled=playing;status.textContent=engine.status;status.classList.toggle('is-saving',engine.status.includes('保存…'))
    const doc=engine.composition,sceneId=engine.runtime?.objects?.sceneId||doc.startSceneId,scene=doc.scenes.find(s=>s.id===sceneId)
    sceneTitle.textContent=scene?.name||'未命名场景';sceneBadge.textContent=playing?'正在试玩':'实时预览'
    sceneMeta.textContent='自适应场景'
    previewHint.textContent=playing?'和角色交谈，或通过按钮推进场景。':'打开场景搭建，编辑对象、布局与事件连接。'
    runtimeError.hidden=!engine.runtime?.error;runtimeError.textContent=engine.runtime?.error||''
  }
  function register(map,owner,d){
    if(map.has(d.id))throw Error('界面贡献重复：'+d.id)
    map.set(d.id,d);refresh()
    owner.effect(()=>()=>{map.delete(d.id);if(!disposed)refresh()})
  }
  const ui={registerPanel:(o,d)=>register(panels,o,d),registerSurface:(o,d)=>register(surfaces,o,d),registerToolbar:(o,d)=>register(tools,o,d),navigate,refresh}
  sdk.provide('narrativeUI',ui)
  function field(label,value,fn,multi=false){const wrap=el('label','ne-field',label),input=el(multi?'textarea':'input',multi?'ne-textarea':'ne-input');input.value=value;input.addEventListener('change',()=>run(()=>fn(input.value)));wrap.append(input);return wrap}
  async function download(){const blob=new Blob([JSON.stringify(await engine.exportBundle(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=engine.project.title+'.narrative.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  async function importFile(file){if(!file)return;if(file.size>128*1024*1024)throw Error('作品包不能超过 128 MB');await engine.importProject(JSON.parse(await file.text()));navigate('scene.editor')}
  panels.set('project',{id:'project',label:'作品与模板',icon:'▦',order:0,render(container){
    const p=engine.project,overview=el('div','ne-project-overview');overview.append(el('div','ne-template-art','✧'),el('strong','',p.title),el('p','ne-muted',p.description));container.append(overview)
    container.append(field('作品名称',p.title,v=>engine.update(n=>{n.title=v.trim()||p.title})),field('作品简介',p.description,v=>engine.update(n=>{n.description=v}),true))
    const doc=engine.composition,start=el('select','ne-select');start.setAttribute('aria-label','起始场景');for(const scene of doc.scenes){const o=el('option','',scene.name);o.value=scene.id;start.append(o)}start.value=doc.startSceneId;start.addEventListener('change',()=>run(()=>engine.sceneCommand({op:'start-scene',id:start.value})));const startField=el('label','ne-field','起始场景');startField.append(start);container.append(startField)
    const stats=el('div','ne-project-stats');for(const [n,t]of [[doc.scenes.length,'场景'],[p.characters.length,'角色'],[doc.scenes.reduce((sum,s)=>sum+s.connections.length,0),'事件连接']]){const card=el('div');card.append(el('strong','',String(n)),el('span','',t));stats.append(card)}container.append(stats)
    const actions=el('div','ne-stack');actions.append(button('打开作品库 / 从模板新建',()=>showLibrary(false),'ne-button ne-primary'),button('导出当前作品',download))
    const upload=el('input');upload.type='file';upload.accept='.json,.narrative.json';upload.hidden=true;upload.addEventListener('change',()=>run(()=>importFile(upload.files[0])));actions.append(button('导入作品文件',()=>upload.click()),upload);container.append(actions)
    const issues=engine.issues();const health=el('div','ne-health '+(issues.length?'has-issues':''));health.append(el('strong','',issues.length?'有 '+issues.length+' 项需要检查':'✓  作品数据正常'),el('p','ne-muted',issues.length?issues.join('；'):'在场景搭建中检查对象引用和事件连接，再试玩验证。'));container.append(health)
    const note=el('p','ne-muted','作品包包含场景、人物、事件连接与上传素材。接收者可在叙事引擎中导入继续创作；模型密钥单独保存。');container.append(note)
  }})
  async function showLibrary(createOnly){
    const dialog=el('dialog','ne-library-dialog'),head=el('div','ne-modal-heading'),body=el('div','ne-modal-body');head.append(el('h2','',createOnly?'一个新故事，从这里开始':'你的故事收藏'),button('×',()=>dialog.close(),'ne-button ne-close'));dialog.append(head,body);root.append(dialog)
    dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal()
    const templates=el('div','ne-template-grid')
    for(const [id,icon,name,desc,tags]of [['salon','▦','七日会客厅','独立的双角色聊天窗口，通过事件推进天数与关系。','角色 · 场景 · 事件']]){
      const b=button('',async()=>{await engine.create(id);dialog.close();navigate('scene.editor')},'ne-template-card');b.append(el('span','ne-template-icon',icon),el('strong','',name),el('p','',desc),el('small','',tags));templates.append(b)
    }
    body.append(el('p','ne-muted','选择一个起始模板。所有作品都能继续组合对象、编辑布局和连接事件。'),templates)
    if(!createOnly){const list=el('div','ne-library-list');body.append(el('h3','','已有作品'),list);for(const p of await engine.list()){const b=button('',async()=>{await engine.open(p.id);dialog.close();navigate('scene.editor')},'ne-library-item');const text=el('div');text.append(el('strong','',p.title),el('span','ne-muted',p.characters+' 位角色'));b.append(el('span','ne-library-dot','✦'),text,el('span','','打开 →'));list.append(b)}}
  }
  engine.observe(ctx,event=>{
    renderState()
    if(['project','selection','mode'].includes(event.type)) {if(event.type!=='project'||event.render!==false)renderPanel()}
    if(event.type==='mode')renderTools()
  })
  ctx.effect(()=>()=>{disposed=true;panelDispose?.();for(const m of mounted.values())m.dispose?.();mounted.clear();root.remove()})
  refresh()
}
