import { installDebugPanel } from './debug.js'
import { mountResources, RESOURCE_MIME } from './resources.js'
import { mountInteraction, reorderCommand } from './interaction.js'
import { preferences, mountLayout } from './layout.js'
const matches=(d,r)=>!!d&&(typeof r==='string'?(!r||d.type===r):(!r.type||d.type===r.type)&&(r.methods||[]).every(m=>d.methods?.[m])&&(r.events||[]).every(e=>d.events?.includes(e)))
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n}
export default function(ctx,sdk){
  const engine=ctx.narrative,scene=ctx.sceneRuntime,ui=ctx.narrativeUI,views=ctx.sceneViews
  installDebugPanel(ctx,ui,scene)
  ui.registerPanel(ctx,{id:'scene.editor',label:'场景编辑器',icon:'▦',order:2,wide:true,render:mount})
  function mount(container){
    const prefs=preferences(sdk.storage?.local)
    let selected='',resource=null,resourceParent=null,view,interaction,resources,disposed=false,dragId='',dragVersion=0,inspectorStamp='',lastDoc='',lastResources='',editSelection='',editResource=null,wasPlaying=scene.playing
    const inspectorCleanups=[]
    const collapsed=new Set(),root=el('section','scene-editor'),toolbar=el('div','scene-editor-toolbar'),body=el('div','scene-editor-grid')
    const left=el('aside','scene-hierarchy'),center=el('section','scene-workspace'),right=el('aside','scene-properties'),inspector=el('fieldset','scene-inspector-fields'),liveState=el('pre','scene-live-state')
    const tree=el('div','scene-tree'),assets=el('section','scene-assets'),canvasWrap=el('div','scene-viewport'),canvas=el('div','scene-editor-preview'),diagnostics=el('div','scene-diagnostics')
    left.setAttribute('aria-label','场景层级');right.setAttribute('aria-label','属性检查器');assets.setAttribute('aria-label','资源库');canvasWrap.setAttribute('aria-label','游戏画面')
    const run=fn=>Promise.resolve().then(fn).catch(e=>sdk.toast(e.message))
    const button=(label,fn,cls='ne-button')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',()=>run(fn));return b}
    const command=(c,version=engine.version)=>scene.edit({sceneId:scene.selected,...c},version)
    const options=(rows,value,change,label)=>{const s=el('select','ne-select');s.setAttribute('aria-label',label);for(const [id,name]of rows){const o=el('option','',name);o.value=id;s.append(o)}s.value=value??'';s.addEventListener('change',()=>run(()=>change(s.value)));return s}
    const field=(label,input)=>{const wrapper=el('label','ne-field',label);wrapper.append(input);return wrapper}
    const input=(value,change,label,kind='text')=>{const n=el(kind==='textarea'?'textarea':'input',kind==='textarea'?'ne-textarea':'ne-input');if(kind!=='textarea')n.type=kind;n.value=value??'';n.setAttribute('aria-label',label);n.addEventListener('change',()=>run(()=>change(kind==='number'?Number(n.value):n.value)));return n}
    const doc=()=>scene.document,rawScene=()=>doc().scenes.find(s=>s.id===scene.selected)
    const expanded=()=>scene.expanded(),raw=()=>rawScene()?.objects.find(o=>o.id===selected),object=()=>expanded().objects.find(o=>o.id===selected)
    const holder=()=>rawScene()?.objects.find(o=>o.prefab&&selected.startsWith(o.id+'--'))
    function patchObject(id,value,version=engine.version){
      const own=rawScene().objects.find(o=>o.id===id),parent=rawScene().objects.find(o=>o.prefab&&id.startsWith(o.id+'--'))
      if(own)command({op:'patch',id:own.id,patch:value},version)
      else if(parent){const key=id.slice(parent.id.length+2);command({op:'patch',id:parent.id,patch:{overrides:{...parent.overrides,[key]:{...parent.overrides?.[key],...value}}}},version)}
      else throw Error('对象已移除，请重新选择')
    }
    const patch=value=>patchObject(selected,value)
    function selectObject(id){if(id!==selected)right.scrollTop=0;selected=id;resource=null;resources?.clearSelection();inspectorStamp='';render()}
    function jump(ref){
      if(ref.characterId){engine.select({characterId:ref.characterId});return ui.navigate('characters')}
      if(ref.panel)return ui.navigate(ref.panel)
      if(ref.sceneId!==scene.selected)scene.select(ref.sceneId)
      selectObject(ref.objectId);root.dataset.mobileTab='inspector'
    }
    const sceneSelect=options(doc().scenes.map(s=>[s.id,s.name]),scene.selected,id=>{scene.select(id);selectObject('')},'当前场景')
    const undo=button('↶ 撤销',()=>scene.undo()),redo=button('↷ 重做',()=>scene.redo())
    const addScene=button('＋ 场景',()=>{const id='scene-'+crypto.randomUUID();command({op:'add-scene',id,name:'新场景 '+(doc().scenes.length+1)});scene.select(id);selectObject('')})
    const startScene=button('设为起始',()=>command({op:'start-scene',id:scene.selected}))
    const size=options([['landscape','横屏 16:9'],['portrait','竖屏 9:16']], prefs.value.orientation,()=>{},'预览比例')
    const modeBadge=el('span','ne-badge'),hint=el('span','scene-workspace-caption')
    const more=el('details','scene-toolbar-more'),summary=el('summary','','场景选项'),moreActions=el('div','scene-toolbar-menu')
    summary.setAttribute('aria-label','场景选项');moreActions.append(startScene,modeBadge);more.append(summary,moreActions)
    toolbar.append(sceneSelect,addScene,undo,redo,size,more)
    undo.title='撤销';undo.setAttribute('aria-label','撤销');undo.textContent='↶'
    redo.title='重做';redo.setAttribute('aria-label','重做');redo.textContent='↷'
    addScene.title='添加场景';addScene.setAttribute('aria-label','添加场景');addScene.textContent='＋'
    const fitToolbar=()=>{if(window.innerWidth<=800){moreActions.prepend(addScene,undo,redo);summary.textContent='⋯'}else{toolbar.insertBefore(addScene,size);toolbar.insertBefore(undo,size);toolbar.insertBefore(redo,size);summary.textContent='场景选项'}}
    window.addEventListener('resize',fitToolbar);fitToolbar()
    const mobileNav=el('nav','scene-mobile-nav');mobileNav.setAttribute('aria-label','编辑器区域')
    for(const [id,label]of [['canvas','画面'],['hierarchy','层级'],['inspector','属性'],['assets','资源']]){const b=button(label,()=>{root.dataset.mobileTab=id},'scene-mobile-tab');b.dataset.tab=id;mobileNav.append(b)}
    root.dataset.mobileTab='canvas'
    left.append(el('div','scene-pane-heading','场景层级'),tree)
    right.append(el('div','scene-pane-heading','属性检查器'),liveState,inspector)
    canvasWrap.append(canvas);center.append(hint,canvasWrap);body.append(left,center,right,assets);root.append(toolbar,mobileNav,body,diagnostics);container.append(root)
    const detachToolbar=ui.mountEditorToolbar?.(toolbar)
    resources=mountResources(assets,{engine,scene,ui,run,button,field,input,prefs,select:value=>{if(!resource)resourceParent=placementParent();resource=value;selected='';inspectorStamp='';render();root.dataset.mobileTab='inspector'},place,jump})
    view=views.mount(canvas,{sceneId:()=>scene.selected,design:()=>!scene.playing,onSelect:id=>selectObject(id)})
    interaction=mountInteraction(canvas,{engine,scene,getSelected:()=>selected,select:selectObject,patchObject,report:message=>sdk.toast(message),refreshView:()=>view.refresh()})
    const layout=mountLayout({root,grid:body,viewport:canvasWrap,canvas,size,prefs,refresh:()=>view.refresh()})
    const offInspectors=ui.observeInspectors?.({effect:fn=>fn()},()=>{inspectorStamp='';render()})
    const off=scene.observe({effect:fn=>fn()},render)
    const offProject=engine.observe({effect:fn=>fn()},event=>{if(event.type==='project'||event.type==='mode')render()})
    function placementParent(){const o=raw();return o&&!o.prefab&&scene.descriptor(o.type)?.container?o.id:o?.parent||null}
    function add(type,propsOverride={},parent=placementParent()){
      const d=scene.descriptor(type);if(!d)throw Error('对象类型未启用')
      const id='o-'+crypto.randomUUID(),props={...Object.fromEntries(Object.entries(d.fields||{}).map(([key,f])=>[key,(f.kind==='story'?engine.project.stories?.[0]?.id:undefined)??f.default??''])),...propsOverride},refs={},commands=[]
      for(const[key,requirement]of Object.entries(d.refs||{})){if(requirement.optional)continue;const candidates=rawScene().objects.filter(o=>matches(scene.descriptor(o.type),requirement));if(candidates.length===1)refs[key]=candidates[0].id;else if(typeof requirement==='string'&&!candidates.length){const targetId='o-'+crypto.randomUUID(),def=scene.descriptor(requirement);if(def){commands.push({op:'add',id:targetId,type:requirement,name:def.label,props:Object.fromEntries(Object.entries(def.fields||{}).map(([k,f])=>[k,f.default??'']))});refs[key]=targetId}}}
      commands.push({op:'add',id,type,name:d.label,props,refs,parent,layout:d.container?{mode:'column',gap:12,padding:16}:{}})
      command({op:'batch',commands});selectObject(id)
    }
    function place(value,parent=resource?resourceParent:placementParent()){
      if(scene.playing)throw Error('停止试玩后可放入场景')
      if(value.kind==='story')return add('story-flow',{storyId:value.id},parent)
      if(value.kind==='preset'){
        const preset=engine.prefabPresets().find(p=>p.id===value.id);if(!preset)throw Error('组合不存在')
        const missing=[...new Set(preset.objects.map(o=>o.type))].filter(type=>!scene.descriptor(type));if(missing.length)throw Error('请先启用这些对象类型的插件：'+missing.join('、'))
        if(preset.objects.some(o=>o.type==='story-flow')&&!engine.project.stories?.length)throw Error('请先在剧情与对白中创建一份剧情资源')
        const id='o-'+crypto.randomUUID(),installed=doc().prefabs.find(p=>p.id===preset.id&&p.version===preset.version)
        command({op:'batch',commands:[...(!installed?[{op:'add-prefab',prefab:preset}]:[]),{op:'instantiate',id,prefabId:preset.id,prefabVersion:preset.version,parent}]});selectObject(id);return
      }
      if(value.kind==='type')return add(value.id,{},parent)
      if(value.kind==='asset'){const a=engine.project.assets.find(a=>a.id===value.id);if(a?.kind==='image')return add('image',{asset:a.id,fit:'contain'},parent);throw Error('音频可在属性中设为背景音乐')}
      if(value.kind==='prefab'){const id='o-'+crypto.randomUUID();command({op:'instantiate',id,prefabId:value.id,prefabVersion:value.version,parent});selectObject(id)}
      if(value.kind==='character'){
        const c=engine.project.characters.find(c=>c.id===value.id);if(!c)throw Error('人物资料已移除')
        const id='o-'+crypto.randomUUID(),sessionId='o-'+crypto.randomUUID()
        command({op:'batch',commands:[{op:'add',id:sessionId,type:'conversation',name:c.name+'的会话',props:{characterId:c.id,source:'ai',script:'你好，很高兴见到你。',prompt:''}},{op:'add',id,type:'chat-window',name:c.name,props:{title:c.name},refs:{session:sessionId},parent}]});selectObject(id)
      }
    }
    function acceptDrop(event,parent){
      event.preventDefault();event.stopPropagation();if(scene.playing)return
      const data=event.dataTransfer?.getData(RESOURCE_MIME)
      const moving=dragId,version=dragVersion;dragId=''
      run(()=>{if(data)place(JSON.parse(data),parent);else if(moving)command({op:'move',id:moving,parent},version)})
    }
    canvas.addEventListener('dragover',event=>{if(!scene.playing&&event.dataTransfer?.types.includes(RESOURCE_MIME))event.preventDefault()})
    canvas.addEventListener('drop',event=>{const node=event.target.closest('[data-object-id]'),target=rawScene().objects.find(o=>o.id===node?.dataset.objectId);const parent=target&&!target.prefab&&scene.descriptor(target.type)?.container?target.id:target?.parent||null;acceptDrop(event,parent)})
    function render(){
      if(disposed)return
      if(scene.playing!==wasPlaying){if(scene.playing){editSelection=selected;editResource=resource;root.dataset.mobileTab='canvas'}else{selected=editSelection;resource=editResource}wasPlaying=scene.playing;inspectorStamp=''}
      if(selected&&!object())selected=''
      const document=doc(),stamp=JSON.stringify(document)+':'+scene.selected+':'+scene.types().map(d=>d.type).join(',')
      const resourceStamp=JSON.stringify([engine.project.assets,engine.project.characters,engine.project.stories,scene.playing])
      undo.disabled=!engine.sceneHistory.undo||scene.playing;redo.disabled=!engine.sceneHistory.redo||scene.playing
      sceneSelect.disabled=addScene.disabled=startScene.disabled=scene.playing
      modeBadge.textContent=scene.playing?'正在试玩 · 配置只读':'编辑模式'
      hint.textContent=scene.playing?'游戏画面 · 点击按钮或发送消息，停止后回到作者配置':'游戏画面 · 点击选择；拖动重排，叠层吸附锚点；右下角调整尺寸'
      root.classList.toggle('is-scene-playing',scene.playing)
      if(stamp!==lastDoc){lastDoc=stamp;sceneSelect.replaceChildren();for(const s of document.scenes){const o=el('option','',s.name+(s.id===document.startSceneId?' · 起始':''));o.value=s.id;sceneSelect.append(o)}sceneSelect.value=scene.selected;renderTree();view?.refresh();inspectorStamp=''}
      if(resourceStamp!==lastResources){lastResources=resourceStamp;view?.refresh();inspectorStamp=''}
      resources?.refresh()
      const next=selected+':'+JSON.stringify(resource)+':'+stamp+':'+scene.playing
      if(next!==inspectorStamp){inspectorStamp=next;renderInspector()}
      inspector.disabled=scene.playing
      for(const n of canvas.querySelectorAll('[data-object-id]'))n.classList.toggle('is-selected',!scene.playing&&n.dataset.objectId===selected)
      for(const n of tree.querySelectorAll('[data-id]')){n.classList.toggle('is-selected',n.dataset.id===selected);n.setAttribute('aria-selected',String(n.dataset.id===selected))}
      interaction?.refresh()
      liveState.hidden=!scene.playing||!selected
      if(!liveState.hidden){const state=scene.runtime?.state(selected);liveState.textContent='运行状态（只读）'+String.fromCharCode(10)+JSON.stringify({状态:scene.runtime?.status(selected),数据:state},null,2)}
      const issues=scene.validate();diagnostics.textContent=issues.length?'需要检查：'+issues.join('；'):scene.playing?'试玩中的变化写入进度存档 · 作者配置保持不变':'✓ 引用与事件连接有效 · 自动保存 · 选中后拖动手柄按布局规则移动';diagnostics.classList.toggle('has-issues',!!issues.length)
    }
    function renderTree(){
      tree.replaceChildren();tree.setAttribute('role','tree');const rows=expanded().objects
      const sceneRow=button(rawScene().name,()=>selectObject(''),'scene-tree-scene');tree.append(sceneRow)
      function branch(parent,depth){for(const o of rows.filter(x=>(x.parent||null)===parent)){
        const d=scene.descriptor(o.type),own=rawScene().objects.find(x=>x.id===o.id),children=rows.some(x=>x.parent===o.id)
        const row=el('div','scene-tree-row');row.dataset.id=o.id;row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+1));row.style.paddingLeft=(6+depth*14)+'px';row.draggable=!!own&&!scene.playing
        row.addEventListener('click',event=>{if(event.target===row)selectObject(o.id)})
        if(children){const fold=button(collapsed.has(o.id)?'▸':'▾',()=>{collapsed.has(o.id)?collapsed.delete(o.id):collapsed.add(o.id);renderTree();render()},'scene-tree-fold');fold.setAttribute('aria-label','展开或折叠 '+(o.name||o.id));row.setAttribute('aria-expanded',String(!collapsed.has(o.id)));row.append(fold)}else row.append(el('span','scene-tree-spacer'))
        const name=button((d?.visual===false?'◇ ':own?.prefab?'▣ ':'▧ ')+(o.name||d?.label||o.type),()=>selectObject(o.id),'scene-tree-item');name.title=(o.name||d?.label||o.type)+' · '+o.id;row.append(name)
        if(o.visible===false||o.enabled===false||o.paused)row.append(el('span','scene-tree-flags',o.visible===false?'隐藏':o.enabled===false?'停用':'暂停'))
        row.addEventListener('dragstart',e=>{if(scene.playing){e.preventDefault();return}dragId=o.id;dragVersion=engine.version;e.dataTransfer.setData('text/plain',o.id);e.dataTransfer.effectAllowed='move'})
        row.addEventListener('dragend',()=>{dragId=''})
        row.addEventListener('dragover',e=>{if(!scene.playing)e.preventDefault()})
        row.addEventListener('drop',e=>{
          if(e.dataTransfer?.getData(RESOURCE_MIME)||d?.container&&own&&!own.prefab)return acceptDrop(e,d?.container&&own&&!own.prefab?o.id:o.parent||null)
          e.preventDefault();e.stopPropagation();const version=dragVersion,cmd=reorderCommand(rawScene().objects,dragId,o.id,e.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);if(cmd)run(()=>command(cmd,version));dragId=''
        })
        tree.append(row);if(!collapsed.has(o.id))branch(o.id,depth+1)
      }}branch(null,0)
      if(!rows.length)tree.append(el('p','scene-help','从底部资源库添加对象或拖入预制体。'))
      const rootDrop=el('div','scene-root-drop','拖到这里放入场景根级');rootDrop.addEventListener('dragover',e=>{if(!scene.playing)e.preventDefault()});rootDrop.addEventListener('drop',e=>acceptDrop(e,null));tree.append(rootDrop)
    }
    function propsField(key,f,o){
      const value=o.props?.[key]??f.default,change=v=>patch({props:{...o.props,[key]:v}})
      if(f.kind==='json')return field(f.label,input(JSON.stringify(value??null,null,2),v=>change(JSON.parse(v)),f.label,'textarea'))
      if(f.kind==='boolean'){const n=el('input');n.type='checkbox';n.checked=!!value;n.addEventListener('change',()=>run(()=>change(n.checked)));return field(f.label,n)}
      if(f.options)return field(f.label,options(f.options.map(x=>Array.isArray(x)?x:[x,x]),value,change,f.label))
      if(['character','asset','scene','story'].includes(f.kind)){const rows=f.kind==='story'?(engine.project.stories||[]):f.kind==='character'?engine.project.characters:f.kind==='asset'?engine.project.assets.filter(x=>x.kind==='image'):doc().scenes;return field(f.label,options([['','请选择'],...rows.map(x=>[x.id,x.name||x.title])],value,change,f.label))}
      return field(f.label,input(value,change,f.label,f.kind==='number'?'number':f.multiline?'textarea':'text'))
    }
    function renderInspector(){
      const right=inspector;for(const clean of inspectorCleanups.splice(0))clean?.();right.querySelectorAll('audio').forEach(a=>a.pause());right.replaceChildren()
      if(resource){resources.renderInspector(resource,right);return}
      const o=object(),own=raw(),parentPrefab=holder()
      if(!o){right.append(el('h3','','场景设置'),field('场景名称',input(rawScene().name,value=>command({op:'rename-scene',name:value}),'场景名称')),el('p','scene-help','选择对象查看参数、布局、引用和行为连接。逻辑对象不占画面，但会参与运行。'));return}
      const d=scene.descriptor(o.type),heading=el('div','scene-property-heading');heading.append(el('h3','',o.name||d?.label||o.type),el('code','',o.id));right.append(heading)
      if(parentPrefab)right.append(el('p','scene-help','正在编辑此实例的覆盖值。预制体原定义和其他实例保持独立。'))
      if(own){right.append(field('对象名称',input(own.name||'',value=>patch({name:value}),'对象名称')));const parents=[['','场景根级'],...rawScene().objects.filter(x=>x.id!==own.id&&scene.descriptor(x.type)?.container).map(x=>[x.id,x.name||x.id])];right.append(field('父对象',options(parents,own.parent||'',parent=>command({op:'move',id:own.id,parent}),'父对象')))}
      for(const key of ['visible','enabled','paused']){const n=el('input');n.type='checkbox';n.checked=o[key]??key!=='paused';n.addEventListener('change',()=>run(()=>patch({[key]:n.checked})));right.append(field({visible:'可见',enabled:'启用',paused:'暂停'}[key],n))}
      for(const editor of ui.inspectors?.(o.type)||[]){const host=el('div','scene-property-section');right.append(host);const clean=editor.render(host,{object:o,sceneId:scene.selected,patch});if(typeof clean==='function')inspectorCleanups.push(clean)}
      const props=el('div','scene-property-section');props.append(el('h3','','对象参数'));for(const[key,f]of Object.entries(d?.fields||{}))props.append(propsField(key,f,o));right.append(props)
      if(own?.prefab)right.append(el('p','scene-help','预制体 '+own.prefab.id+' · 版本 '+own.prefab.version+'。在左侧展开的子对象上编辑覆盖值。'))
      const layout=el('div','scene-property-section'),l=o.layout||{},setLayout=(key,value)=>patch({layout:{...l,[key]:value}});layout.append(el('h3','','布局'))
      if(d?.container)layout.append(field('排列方式',options([['column','纵向排列'],['row','横向排列'],['grid','网格'],['overlay','叠层'],['anchor','锚点容器'],['scroll','滚动区域']],l.mode||'column',v=>setLayout('mode',v),'排列方式')))
      const parentObject=expanded().objects.find(x=>x.id===o.parent),canAnchor=['overlay','anchor'].includes(parentObject?.layout?.mode)
      if(canAnchor)layout.append(field('锚点',options([['flow','跟随排列'],['fill','填满父容器'],['top-left','左上'],['top-right','右上'],['bottom-left','左下'],['bottom-right','右下'],['center','居中']],l.anchor||'flow',v=>setLayout('anchor',v),'锚点')))
      layout.append(el('p','scene-help',canAnchor?'拖动画面中的对象会吸附到四角或中心锚点。':'拖动只调整同级排列顺序，位置由父容器决定。窄屏预览中的尺寸调整写入窄屏覆盖。'))
      for(const[key,label,fallback]of [['gap','间距',12],['padding','内边距',0],['width','宽度（0 为自动）',0],['height','高度（0 为自动）',0],['columns','网格列数',2]])layout.append(field(label,input(l[key]??fallback,v=>setLayout(key,v),label,'number')))
      layout.append(field('伸展权重',input(l.grow??0,v=>setLayout('grow',v),'伸展权重','number')),field('内容对齐',options([['stretch','拉伸'],['start','起始'],['center','居中'],['end','末尾']],l.align||'stretch',v=>setLayout('align',v),'内容对齐')))
      if(l.compact&&Object.keys(l.compact).length)layout.append(el('p','scene-help','窄屏覆盖：'+JSON.stringify(l.compact)),button('清除窄屏覆盖',()=>setLayout('compact',{})))
      layout.append(field('窄屏排列',options([['','继承桌面'],['column','纵向排列'],['row','横向排列'],['grid','网格']],l.compact?.mode||'',v=>{const compact={...l.compact};if(v)compact.mode=v;else delete compact.mode;setLayout('compact',compact)},'窄屏排列')));if(d?.visual!==false)right.append(layout)
      const refKeys=own?.prefab?Object.keys(own.refs||{}):Object.keys(d?.refs||{})
      if(refKeys.length){right.append(el('h3','','对象引用'));for(const key of refKeys){
        const requirement=d?.refs?.[key]||'',rows=expanded().objects.filter(x=>matches(scene.descriptor(x.type),requirement)),target=(own?.prefab?own.refs:o.refs)?.[key]
        if(own)right.append(field(key,options([['','未绑定'],...rows.map(x=>[x.id,x.name||x.id])],target,value=>{const refs={...own.refs};if(value)refs[key]=value;else delete refs[key];patch({refs})},'引用 '+key)))
        const targetObject=rows.find(x=>x.id===target);if(targetObject)right.append(button('跳转到 '+(targetObject.name||target),()=>selectObject(target),'scene-reference-link'))
      }}
      if(own){const order=el('div','scene-object-actions'),siblings=rawScene().objects.filter(x=>(x.parent||null)===(own.parent||null)),index=siblings.findIndex(x=>x.id===own.id)
        const up=button('上移',()=>{const c=reorderCommand(rawScene().objects,own.id,siblings[index-1]?.id);if(c)command(c)}),down=button('下移',()=>{const c=reorderCommand(rawScene().objects,own.id,siblings[index+1]?.id,true);if(c)command(c)})
        up.disabled=index===0;down.disabled=index===siblings.length-1;order.append(up,down);right.append(order)
      }
      if(own){const actions=el('div','scene-object-actions');actions.append(button('复制对象',()=>command({op:'clone',id:own.id})),button('保存为预制体',()=>command({op:'save-prefab',id:own.id,name:own.name||d?.label})));if(own.prefab)actions.append(button('展开为普通对象',()=>command({op:'unpack',id:own.id})));actions.append(button('删除对象',()=>{command({op:'remove',id:own.id});selected='';render()}));right.append(actions);renderConnections(right,own,d)}
      if(parentPrefab)right.append(button('清除此对象覆盖',()=>{const overrides={...parentPrefab.overrides};delete overrides[selected.slice(parentPrefab.id.length+2)];command({op:'patch',id:parentPrefab.id,patch:{overrides}})}))
    }
    function renderConnections(host,o,d){
      const section=el('div','scene-property-section');section.append(el('h3','','事件 → 方法'))
      for(const c of rawScene().connections.filter(c=>c.source===o.id||c.target===o.id)){const row=el('div','scene-connection');row.append(el('span','',c.source+'.'+c.event+' → '+c.target+'.'+c.method),button('移除连接',()=>command({op:'disconnect',id:c.id})));section.append(row)}
      if(d?.events?.length){
        const targets=rawScene().objects.filter(x=>Object.keys(scene.descriptor(x.type)?.methods||{}).length),form=el('div','ne-stack');let event=d.events[0],target=targets[0]?.id,method='',args={},argument=''
        const methodSlot=el('div','ne-stack')
        const drawMethods=()=>{methodSlot.replaceChildren();const desc=scene.descriptor(rawScene().objects.find(x=>x.id===target)?.type),methods=Object.entries(desc?.methods||{});method=methods[0]?.[0]||'';const fields=el('div','ne-stack');const drawArgs=()=>{fields.replaceChildren();args={};argument='';const entries=Object.entries(desc.methods[method]?.fields||{});fields.append(field('事件数据传入',options([['','只使用固定参数'],...entries.map(([key,f])=>[key,f.label])],'',value=>{argument=value},'事件数据传入')));for(const[key,f]of entries){args[key]=f.default??(f.kind==='json'?null:'');fields.append(field(f.label,input(f.kind==='json'?JSON.stringify(args[key]):args[key],value=>{args[key]=f.kind==='json'?JSON.parse(value):f.kind==='boolean'?value==='true':value},'连接参数 '+f.label,f.kind==='number'?'number':f.kind==='json'?'textarea':'text')))}};if(method){methodSlot.append(field('目标方法',options(methods.map(([id,m])=>[id,m.label]),method,v=>{method=v;drawArgs()},'目标方法')),fields);drawArgs()}}
        form.append(field('触发事件',options(d.events.map(e=>[e,e]),event,v=>{event=v},'触发事件')),field('目标对象',options(targets.map(t=>[t.id,t.name||t.id]),target,v=>{target=v;drawMethods()},'目标对象')),methodSlot,button('添加连接',()=>{if(!target||!method)throw Error('请先添加可调用对象');const fixed={...args};if(argument)delete fixed[argument];command({op:'connect',source:o.id,event,target,method,args:fixed,...(argument?{argument}:{})})}));drawMethods();section.append(form)
      }else section.append(el('p','scene-help','此类型未公开事件。可以从其他对象的方法入口或引用建立协作。'))
      host.append(section)
    }
    render();return()=>{disposed=true;off();offProject();offInspectors?.();for(const clean of inspectorCleanups.splice(0))clean?.();window.removeEventListener('resize',fitToolbar);layout.dispose();detachToolbar?.();interaction.dispose();resources.dispose();view.dispose();root.remove()}
  }
}
