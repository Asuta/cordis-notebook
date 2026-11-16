const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n}
export default function(ctx,sdk){
  const engine=ctx.narrative,scene=ctx.sceneRuntime,ui=ctx.narrativeUI,views=ctx.sceneViews
  ui.registerPanel(ctx,{id:'scene.editor',label:'场景搭建',icon:'▦',order:2,wide:true,render:mount})
  function mount(container){
    let selected='',view,disposed=false,dragId='',inspectorStamp='',lastDoc=''
    const root=el('section','scene-editor'),toolbar=el('div','scene-editor-toolbar'),body=el('div','scene-editor-grid'),left=el('aside','scene-library'),center=el('section','scene-workspace'),right=el('aside','scene-properties'),tree=el('div','scene-tree'),palette=el('div','scene-palette'),prefabs=el('div','scene-prefabs'),canvasWrap=el('div','scene-viewport'),canvas=el('div','scene-editor-preview'),diagnostics=el('div','scene-diagnostics')
    const run=fn=>Promise.resolve().then(fn).catch(e=>sdk.toast(e.message))
    const button=(label,fn,cls='ne-button')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',()=>run(fn));return b}
    const command=c=>{const result=scene.edit({sceneId:scene.selected,...c},engine.version);return result}
    const options=(rows,value,change,label)=>{const s=el('select','ne-select');s.setAttribute('aria-label',label);for(const [id,name]of rows){const o=el('option','',name);o.value=id;s.append(o)}s.value=value??'';s.addEventListener('change',()=>run(()=>change(s.value)));return s}
    const field=(label,input)=>{const wrapper=el('label','ne-field',label);wrapper.append(input);return wrapper}
    const input=(value,change,label,kind='text')=>{const n=el(kind==='textarea'?'textarea':'input',kind==='textarea'?'ne-textarea':'ne-input');if(kind!=='textarea')n.type=kind;n.value=value??'';n.setAttribute('aria-label',label);n.addEventListener('change',()=>run(()=>change(kind==='number'?Number(n.value):n.value)));return n}
    const doc=()=>scene.document,rawScene=()=>doc().scenes.find(s=>s.id===scene.selected)
    const expanded=()=>scene.expanded(),raw=()=>rawScene()?.objects.find(o=>o.id===selected),object=()=>expanded().objects.find(o=>o.id===selected)
    const holder=()=>rawScene()?.objects.find(o=>o.prefab&&selected.startsWith(o.id+'--'))
    function patch(value){
      const own=raw(),parent=holder();if(own)command({op:'patch',id:own.id,patch:value});else if(parent){const key=selected.slice(parent.id.length+2);command({op:'patch',id:parent.id,patch:{overrides:{...parent.overrides,[key]:{...parent.overrides?.[key],...value}}}})}
    }
    const sceneSelect=options(doc().scenes.map(s=>[s.id,s.name]),scene.selected,id=>{scene.select(id);selected='';inspectorStamp='';render()},'当前场景')
    const undo=button('↶ 撤销',()=>scene.undo()),redo=button('↷ 重做',()=>scene.redo())
    toolbar.append(sceneSelect,button('＋ 场景',()=>{const id='scene-'+crypto.randomUUID();command({op:'add-scene',id,name:'新场景 '+(doc().scenes.length+1)});scene.select(id);selected='';render()}),button('设为起始场景',()=>command({op:'start-scene',id:scene.selected})),undo,redo)
    const size=options([['wide','桌面预览'],['phone','竖屏 390']], 'wide',value=>{canvasWrap.dataset.size=value},'预览尺寸');toolbar.append(size)
    left.append(el('div','scene-column-label','对象与层级'),el('p','scene-help','拖动对象到容器内，或在属性中调整父对象。'),tree,el('div','scene-column-label','添加对象'),palette,el('div','scene-column-label','预制体库'),prefabs)
    canvasWrap.append(canvas);center.append(el('div','scene-workspace-caption','布局预览 · 点击对象编辑属性'),canvasWrap,diagnostics);body.append(left,center,right);root.append(toolbar,body);container.append(root)
    view=views.mount(canvas,{sceneId:()=>scene.selected,design:true,onSelect:id=>{selected=id;inspectorStamp='';render()}})
    const off=scene.observe({effect:fn=>fn()},render)
    function add(type){
      const d=scene.descriptor(type),id='o-'+crypto.randomUUID(),parent=raw(),props=Object.fromEntries(Object.entries(d.fields||{}).map(([key,f])=>[key,f.default??''])),refs={},commands=[]
      for(const[key,targetType]of Object.entries(d.refs||{})){let target=rawScene().objects.find(o=>o.type===targetType);if(!target){const targetId='o-'+crypto.randomUUID(),def=scene.descriptor(targetType);commands.push({op:'add',sceneId:scene.selected,id:targetId,type:targetType,name:def.label,props:Object.fromEntries(Object.entries(def.fields||{}).map(([k,f])=>[k,f.default??'']))});target={id:targetId}}refs[key]=target.id}
      commands.push({op:'add',sceneId:scene.selected,id,type,name:d.label,props,refs,parent:parent&&scene.descriptor(parent.type)?.container?parent.id:null,layout:d.container?{mode:'column',gap:12,padding:16}:{}})
      command({op:'batch',commands});selected=id;inspectorStamp='';render()
    }
    function render(){
      if(disposed)return
      const document=doc(),stamp=JSON.stringify(document)+':'+scene.selected+':'+scene.types().map(d=>d.type).join(',')
      undo.disabled=!engine.sceneHistory.undo||scene.playing;redo.disabled=!engine.sceneHistory.redo||scene.playing
      if(stamp!==lastDoc){lastDoc=stamp;sceneSelect.replaceChildren();for(const s of document.scenes){const o=el('option','',s.name+(s.id===document.startSceneId?' · 起始':''));o.value=s.id;sceneSelect.append(o)}sceneSelect.value=scene.selected;renderTree();renderPalette();view?.refresh();inspectorStamp=''}
      const next=selected+':'+stamp+':'+scene.playing
      if(next!==inspectorStamp){inspectorStamp=next;renderInspector()}
      for(const n of canvas.querySelectorAll('[data-object-id]'))n.classList.toggle('is-selected',n.dataset.objectId===selected)
      for(const n of tree.querySelectorAll('[data-id]'))n.classList.toggle('is-selected',n.dataset.id===selected)
      const issues=scene.validate();diagnostics.textContent=issues.length?'需要检查：'+issues.join('；'):'✓ 引用与行为连接有效 · 配置自动保存';diagnostics.classList.toggle('has-issues',!!issues.length)
    }
    function renderTree(){
      tree.replaceChildren();const rows=expanded().objects
      function branch(parent,depth){for(const o of rows.filter(x=>(x.parent||null)===parent)){
        const d=scene.descriptor(o.type),row=button((d?.visual===false?'◇ ':rawScene().objects.find(x=>x.id===o.id)?.prefab?'▣ ':'▧ ')+(o.name||d?.label||o.type),()=>{selected=o.id;inspectorStamp='';render()},'scene-tree-item');row.dataset.id=o.id;row.style.paddingLeft=(10+depth*14)+'px';row.title=o.id;row.draggable=!!rawScene().objects.find(x=>x.id===o.id)
        row.addEventListener('dragstart',e=>{dragId=o.id;e.dataTransfer.setData('text/plain',o.id)})
        if(d?.container&&rawScene().objects.find(x=>x.id===o.id)&&!rawScene().objects.find(x=>x.id===o.id)?.prefab){row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();run(()=>command({op:'move',id:dragId,parent:o.id}))})}
        tree.append(row);branch(o.id,depth+1)
      }}branch(null,0)
      if(!rows.length)tree.append(el('p','scene-help','这里还没有对象，从下方添加。'))
      const rootDrop=el('div','scene-root-drop','拖到这里移至场景根级');rootDrop.addEventListener('dragover',e=>e.preventDefault());rootDrop.addEventListener('drop',e=>{e.preventDefault();run(()=>command({op:'move',id:dragId,parent:null}))});tree.append(rootDrop)
    }
    function renderPalette(){
      palette.replaceChildren();for(const d of scene.types())palette.append(button('＋ '+d.label,()=>add(d.type),'scene-palette-button'))
      prefabs.replaceChildren();for(const p of doc().prefabs){const card=el('div','scene-prefab-card');card.append(el('strong','',p.name),el('small','scene-help','版本 '+p.version+' · '+p.objects.length+' 个对象'),button('放入场景',()=>{const id='o-'+crypto.randomUUID();command({op:'instantiate',id,prefabId:p.id,prefabVersion:p.version});selected=id;inspectorStamp='';render()}));prefabs.append(card)}
    }
    function propsField(key,f,o){
      const value=o.props?.[key]??f.default,change=v=>patch({props:{...o.props,[key]:v}})
      if(f.options)return field(f.label,options(f.options.map(x=>Array.isArray(x)?x:[x,x]),value,change,f.label))
      if(['character','asset','scene'].includes(f.kind)){const rows=f.kind==='character'?engine.project.characters:f.kind==='asset'?engine.project.assets.filter(x=>x.kind==='image'):doc().scenes;return field(f.label,options([['','请选择'],...rows.map(x=>[x.id,x.name||x.title])],value,change,f.label))}
      return field(f.label,input(value,change,f.label,f.kind==='number'?'number':f.multiline?'textarea':'text'))
    }
    function renderInspector(){
      right.replaceChildren();const o=object(),own=raw(),parentPrefab=holder()
      if(!o){right.append(el('h3','','场景设置'),field('场景名称',input(rawScene().name,value=>command({op:'rename-scene',name:value}),'场景名称')),el('p','scene-help','选择对象查看参数、布局、引用和行为连接。逻辑对象不占画面，但会参与运行。'));return}
      const d=scene.descriptor(o.type),heading=el('div','scene-property-heading');heading.append(el('h3','',o.name||d?.label||o.type),el('code','',o.id));right.append(heading)
      if(parentPrefab)right.append(el('p','scene-help','正在编辑此实例的覆盖值。预制体原定义和其他实例保持独立。'))
      if(own){right.append(field('对象名称',input(own.name||'',value=>patch({name:value}),'对象名称')));const parents=[['','场景根级'],...rawScene().objects.filter(x=>x.id!==own.id&&scene.descriptor(x.type)?.container).map(x=>[x.id,x.name||x.id])];right.append(field('父对象',options(parents,own.parent||'',parent=>command({op:'move',id:own.id,parent}),'父对象')))}
      for(const key of ['visible','enabled','paused']){const n=el('input');n.type='checkbox';n.checked=o[key]??key!=='paused';n.addEventListener('change',()=>run(()=>patch({[key]:n.checked})));right.append(field({visible:'可见',enabled:'启用',paused:'暂停'}[key],n))}
      const props=el('div','scene-property-section');props.append(el('h3','','对象参数'));for(const[key,f]of Object.entries(d?.fields||{}))props.append(propsField(key,f,o));right.append(props)
      if(own?.prefab)right.append(el('p','scene-help','预制体 '+own.prefab.id+' · 版本 '+own.prefab.version+'。在左侧展开的子对象上编辑覆盖值。'))
      const layout=el('div','scene-property-section'),l=o.layout||{},setLayout=(key,value)=>patch({layout:{...l,[key]:value}});layout.append(el('h3','','布局'))
      if(d?.container)layout.append(field('排列方式',options([['column','纵向排列'],['row','横向排列'],['grid','网格'],['overlay','叠层'],['anchor','锚点容器'],['scroll','滚动区域']],l.mode||'column',v=>setLayout('mode',v),'排列方式')))
      layout.append(field('锚点',options([['flow','跟随排列'],['fill','填满父容器'],['top-left','左上'],['top-right','右上'],['bottom-left','左下'],['bottom-right','右下'],['center','居中']],l.anchor||'flow',v=>setLayout('anchor',v),'锚点')))
      for(const[key,label,fallback]of [['gap','间距',12],['padding','内边距',0],['width','宽度（0 为自动）',0],['height','高度（0 为自动）',0],['columns','网格列数',2]])layout.append(field(label,input(l[key]??fallback,v=>setLayout(key,v),label,'number')))
      layout.append(field('窄屏排列',options([['','继承桌面'],['column','纵向排列'],['row','横向排列'],['grid','网格']],l.compact?.mode||'',v=>setLayout('compact',v?{...l.compact,mode:v}:{}),'窄屏排列')));right.append(layout)
      if(own){const refs=own.prefab?Object.keys(own.refs||{}):Object.keys(d?.refs||{});if(refs.length){right.append(el('h3','','对象引用'));for(const key of refs){const type=d?.refs?.[key],rows=rawScene().objects.filter(x=>!type||x.type===type);right.append(field(key,options(rows.map(x=>[x.id,x.name||x.id]),own.refs?.[key],value=>patch({refs:{...own.refs,[key]:value}}),'引用 '+key)))}}}
      if(own){const actions=el('div','scene-object-actions');actions.append(button('复制对象',()=>command({op:'clone',id:own.id})),button('保存为预制体',()=>command({op:'save-prefab',id:own.id,name:own.name||d?.label})));if(own.prefab)actions.append(button('展开为普通对象',()=>command({op:'unpack',id:own.id})));actions.append(button('删除对象',()=>{command({op:'remove',id:own.id});selected='';render()}));right.append(actions);renderConnections(right,own,d)}
      if(parentPrefab)right.append(button('清除此对象覆盖',()=>{const overrides={...parentPrefab.overrides};delete overrides[selected.slice(parentPrefab.id.length+2)];command({op:'patch',id:parentPrefab.id,patch:{overrides}})}))
    }
    function renderConnections(host,o,d){
      const section=el('div','scene-property-section');section.append(el('h3','','事件 → 方法'))
      for(const c of rawScene().connections.filter(c=>c.source===o.id||c.target===o.id)){const row=el('div','scene-connection');row.append(el('span','',c.source+'.'+c.event+' → '+c.target+'.'+c.method),button('移除连接',()=>command({op:'disconnect',id:c.id})));section.append(row)}
      if(d?.events?.length){
        const targets=rawScene().objects.filter(x=>Object.keys(scene.descriptor(x.type)?.methods||{}).length),form=el('div','ne-stack');let event=d.events[0],target=targets[0]?.id,method='',args={}
        const methodSlot=el('div','ne-stack')
        const drawMethods=()=>{methodSlot.replaceChildren();const desc=scene.descriptor(rawScene().objects.find(x=>x.id===target)?.type),methods=Object.entries(desc?.methods||{});method=methods[0]?.[0]||'';const fields=el('div','ne-stack');const drawArgs=()=>{fields.replaceChildren();args={};for(const[key,f]of Object.entries(desc.methods[method]?.fields||{})){args[key]=f.default??'';fields.append(field(f.label,input(args[key],value=>{args[key]=value},'连接参数 '+f.label,f.kind==='number'?'number':'text')))}};if(method){methodSlot.append(field('目标方法',options(methods.map(([id,m])=>[id,m.label]),method,v=>{method=v;drawArgs()},'目标方法')),fields);drawArgs()}}
        form.append(field('触发事件',options(d.events.map(e=>[e,e]),event,v=>{event=v},'触发事件')),field('目标对象',options(targets.map(t=>[t.id,t.name||t.id]),target,v=>{target=v;drawMethods()},'目标对象')),methodSlot,button('添加连接',()=>{if(!target||!method)throw Error('请先添加可调用对象');command({op:'connect',source:o.id,event,target,method,args})}));drawMethods();section.append(form)
      }else section.append(el('p','scene-help','此类型未公开事件。可以从其他对象的方法入口或引用建立协作。'))
      host.append(section)
    }
    render();return()=>{disposed=true;off();view.dispose();root.remove()}
  }
}
