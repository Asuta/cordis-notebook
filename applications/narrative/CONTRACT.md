# 叙事引擎插件协作契约

此应用 ID 为 `narrative`，插件在本应用内通过 Cordis 服务合作，不跨应用引用实现。业务服务由 `project` 提供 `narrative`，`shell` 提供 `narrativeUI`。其他插件声明依赖这两个前端服务。原生 DOM，所有业务样式限定在 `.ne-app` 下。

## 作品结构

`{schemaVersion:1,id,revision,title,description,template,startNodeId,characters,assets,variables,nodes,rules,settings,composition?}`。

- character: `{id,name,description,personality,portrait,expressions:{neutral,happy,sad},color}`；图片字段为 asset ID，可为空。
  旧动态立绘字段仅保留数据校验，不提供播放与编辑能力。
- asset: `{id,name,kind:"image"|"audio",url,mime?,size?}`；通过 `engine.asset(id)` 返回 URL。内置素材归 project 插件。
- variable: `{id,name,initial,min,max}`，数值类型。
- node: `{id,type:"story"|"chat"|"ending",title,stage:{background,characterId,expression,position,scale},lines:[{speaker,text}],choices:[{id,text,target,condition?,actions:[]}],next?,chat?:{characterId,prompt,maxTurns,next,label,demoReplies:[string]}}`。position 是百分比 0–100，scale 是百分比 30–180。speaker 为角色 ID 或空字符串旁白。
- condition: `{type:"variable",variable,op:"gte"|"lte"|"eq"|"gt"|"lt",value}`；空条件恒真。
- action: `{type,...参数}`。标准动作 `add-variable {variable,value}`、`set-variable {variable,value}`、`expression {value}`、`goto {target}`。动作由规则插件注册，未知动作必须报错。
- rule: `{id,name,event:"node.enter"|"choice.select"|"chat.message"|"gift.give",nodeId?:string,once:boolean,condition?:condition,actions:[]}`。
- settings: `{dialogueStyle:"novel"|"chat",accent:"#rrggbb",worldInfo:string,bgm?:string,volume?:number}`。bgm 为音频素材 ID 或空字符串，volume 为 0–1。

## narrative 服务

- getters `project`, `runtime`, `mode` (edit/play), `selection` ({nodeId,characterId}), `status`, `version`, `held`。project 只能通过 update 修改。
- `update(mutator, {render?:boolean}={})`：克隆作品、修改、校验、备份并自动保存；向 observe 发出 `{type:"project",render}`。表单 input 用 render:false 避免失焦。
- `select({nodeId?,characterId?})`、`observe(owner,callback)`；订阅随 owner 释放。事件为 project/selection/runtime/mode/status/registry。
- `asset(id)` 返回素材 URL；`scene()` 返回编辑时选中节点，试玩时当前节点。
- `transact(mutator)` 修改瞬时 runtime 并通知；`play(nodeId?)` 从初始状态试玩，`stop()` 返回编辑器，`go(nodeId)` 进入节点，`advance()` 调用当前节点处理器。
- `registerNode(owner,{type,label,color,enter(node),advance(node)})`；`nodeTypes()` 返回已注册描述。处理器通过闭包使用 engine。
- `registerAction(owner,{type,label,execute(action,payload)})`、`actions()`、`runActions(actions,payload?)`；`registerCondition(owner,{type,label,test(condition)})`、`test(condition)`。
- `onEvent(owner,async(event,payload)=>{})`、`emit(event,payload)`；插件需要 await 事件，避免剧情与规则竞争。
- `save()`、`create(template,title?)`、`open(id)`、`list()`、`importProject(object)`、`exportProject()`。导出 JSON 含上传的 data URL 素材，不含 API 密钥。
- `registerResources(owner,{id,prepare?,export?,import})`：资源插件登记保存、导出和导入钩子。`prepare(clonedProject)` 在试玩、作品切换、导出及停用前执行，可在克隆上更新资源引用；失败阻止操作。`exportBundle()` 异步返回含 `resourceBundles` 的可移植作品，导入先还原资源再写入作品，资源包不进入自动保存和浏览器草稿。同步 `exportProject()` 仍用于轻量快照。
- `restoreRuntime(snapshot)` 恢复存档；`error(message)` 显示通知及 runtime.error。

runtime: `{nodeId,lineIndex,text:{speaker,text},variables:{[id]:number},stage:{background,characterId,expression,position,scale},transcript:[{id,role:"user"|"assistant"|"narrator",name,text}],chatTurns:0,ended:false,busy:false,error:"",visited:[],firedRules:[],log:[]}`。只有试玩时运行规则；编辑预览不执行剧情。异步回复须在返回前核对 play 模式及 runtime 身份/节点，退出取消网络请求。

## narrativeUI 服务

- `registerPanel(owner,{id,label,icon,order,render(container)})`：面板 factory 返回可选 disposer；由 shell 在选择变化或 project(render!==false) 时重新挂载。
  可选 `wide:true` 获得独立宽屏工作区；宽屏面板在同作品、同模式下保持挂载。`beforeLeave()` 异步保存后再切换面板；失败继续保留当前编辑器。`navigate(id)` 返回 Promise。
- `registerSurface(owner,{id,order,mount(container)})`：舞台或对话叠层，挂在带相应 class 的 div；factory 返回可选 disposer。组件自行 observe runtime 并更新 DOM。
- `registerToolbar(owner,{id,label,icon,place:"player"|"header",run})`；`navigate(id)`、`refresh()`。
- CSS 公共类 `ne-card`、`ne-field`(label 容器)、`ne-input`、`ne-select`、`ne-textarea`、`ne-button`、`ne-primary`、`ne-muted`、`ne-row`、`ne-stack`、`ne-section-title`、`ne-badge`、`ne-empty`、`ne-danger`。所有按钮 type=button，输入有 label。
- 样式由各插件自己的 style.css 声明。只有 shell 管理全局外观与布局。

## 生命周期与交付

### 界面场景与对象

可选 composition 文档为 {schemaVersion:1,startSceneId,dependencies:[{id,version}],scenes:[],prefabs:[]}。旧格式保留兼容数据定义，但旧剧情舞台类型已移除，新作品统一使用会客厅场景。scene 为 {id,name,objects,connections}，与剧情 nodes 相互独立。

object 为 {id,type?,prefab?:{id,version},name?,parent?,props?,refs?,layout?,visible?,enabled?,paused?,overrides?}。type 和 prefab 二选一；父子关系禁止循环。逻辑对象可以没有可视表现，仍具备状态与生命周期。引用仅在同一场景内，用稳定 ID 解析；目标类型由注册描述的 refs 声明。父对象停用或暂停会中止后代的在途请求；隐藏只影响显示。重新启用后允许新调用，旧调用不能继续写状态。

prefab 为 {id,name,version,objects,connections,bindings?}，同 ID 不同版本可并存。实例展开时内部 ID 加上实例前缀，内部引用和连接同步重写。外部引用在定义中写成 @槽位，并通过实例 refs 绑定。overrides 以预制体内部 ID 为键，只允许 props、refs、layout、visible、enabled、paused；不改变预制体原定义。暂不支持预制体嵌套预制体。

layout 支持 mode:column/row/grid/overlay/anchor/scroll、anchor:flow/fill/top-left/top-right/bottom-left/bottom-right/center，以及 gap、padding、columns、width、height、grow、align。compact 为容器宽度小于 600px 时的覆盖。浏览器 Flex/Grid 和定位负责布局；不保存像素坐标副本或第二份编辑树。

connection 为 {id,source,event,target,method,args?,argument?}：源事件触发目标公开方法。args 为常量参数；argument 可把完整事件负载映射到一个声明参数（最终值仍需通过类型校验）。事件按顺序 await；同一调用链超过 64 步报错。连接和引用不会改变归属。插件方法可以修改自己的状态，其他对象通过 call(ref,method,args) 协作，不直接写他人状态。

narrative 增加 composition、expandScene(id,doc?)、validateComposition(doc)、sceneCommand(command,version?,validator?)、sceneUndo/sceneRedo 和 sceneHistory。sceneCommand 支持 add/patch/move/remove/clone/connect/disconnect/save-prefab/instantiate/unpack/add-scene/start-scene/rename-scene/batch；命令在副本上校验，成功一次保存并记入撤销历史。batch 子命令继承顶层 sceneId，也可显式指定场景。撤销重做仅限场景内容，最多 50 次；切作品清空，遇到其他入口已修改的内容则拒绝覆盖。

### sceneRuntime 与 sceneViews 服务

scene-runtime 提供 sceneRuntime。register(owner,descriptor) 登记类型，descriptor 包含 type、label、plugin、visual、container、singleton、fields、refs、methods、events 和 initial/restore/interrupt 钩子。methods[name] 为 {label,fields,run(api,args)}；api 提供只读 props/state、副作用方法 set/emit/call/flags、signal、current() 与服务访问。异步方法在返回后必须检查 current()，请求使用 signal。对象状态读取返回深冻结副本。

运行服务提供 selected/document/playing/runtime、types()/descriptor(type)、select(sceneId)、switchScene(sceneId)、expanded(sceneId?)、edit(command,version?)、undo()/redo()、call(id,method,args)、validate()、observe(owner,fn)。运行快照写入 narrative.runtime.objects:{schemaVersion:1,sceneId,states,flags}；状态键为 场景ID/对象ID。切换场景保留其他场景已保存的状态，恢复会话清除 busy。玩家进度由 saves 保存，不进入作品配置。

provide(owner,name,value)/service(name) 提供对象需要的服务；ai-dialogue 提供 ai.reply(payload,signal)，未配置接口时明确报错。sdk.request(path,method,data,signal?) 合并对象取消信号与插件卸载信号。基础 conversation 对象来源为 script 或 ai，消息、轮数与请求状态逐实例隔离；成功回复才提交一轮消息并触发 completed。

scene-ui 提供 sceneViews.mount(container,{sceneId?,design?,onSelect?})，返回 refresh()/dispose()。scene.player 接管中央预览。类型渲染和注册随 Cordis owner 卸载，不把每个对象变成单独 Cordis 插件。

Agent 工具 narrative_scene_read 返回文档、类型、方法、版本、诊断和运行快照；narrative_scene_edit 接受 {version,command}，与属性面板走同一校验及保存；narrative_scene_call 接受 {id,method,args?}，只允许试玩模式调用声明方法。编写新类型或编辑器功能通过修改插件代码完成，不在作品中执行任意代码字符串。

当前限制为每文档 40 场景、100 个预制体版本，每场景 500 条对象记录、1000 条连接，展开后最多 2000 个对象；作品总量仍受原有大小上限约束。

每个插件自行拥有实现、清单、样式；注册项与监听随 ctx 释放，停用不残留 UI。project 负责保存与切换保护。当前仅提供会客厅场景，包含预写文本、真实 AI、对象方法与事件连接。旧节点和规则字段仅保留数据兼容。
