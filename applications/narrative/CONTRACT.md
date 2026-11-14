# 叙事引擎插件协作契约

此应用 ID 为 `narrative`，插件在本应用内通过 Cordis 服务合作，不跨应用引用实现。业务服务由 `project` 提供 `narrative`，`shell` 提供 `narrativeUI`。其他插件声明依赖这两个前端服务。原生 DOM，所有业务样式限定在 `.ne-app` 下。

## 作品结构

`{schemaVersion:1,id,revision,title,description,template,startNodeId,characters,assets,variables,nodes,rules,settings}`。

- character: `{id,name,description,personality,portrait,expressions:{neutral,happy,sad},color}`；图片字段为 asset ID，可为空。
  可选 `meshAvatar:{archiveId,name,size}` 引用角色工作室保存的不可变 `.mavatar`。原生工程不塞进作品草稿。配置后舞台优先播放此动态立绘，Cubism 配置仍可保留。
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

每个插件自行拥有实现、清单、样式；注册项与监听随 ctx 释放，停用不残留 UI。project 负责保存与切换保护。首版包含真实固定剧情、可配置规则、离线示例聊天和可配置的真实 AI 接口。离线示例必须标注；Live2D 未接模型时不能宣称已实现模型动画。

## 角色工作室

`mesh-studio` 拥有完整 Mesh Avatar Studio 编辑器、播放库、Python 制作工具和后端。资源位于该插件数据目录的 `archives/<sha256>.mavatar`；可编辑工程在 `projects/<作品ID>/projects/`，不同作品隔离。编辑器 iframe 通过同源消息桥与插件协作，所有写入携带应用会话，原生工程写入另有修订冲突保护。保存产生新资源包，旧存档继续使用其原有资源引用。

舞台支持 `meshParameters`、`meshMotion:{id,token}`、`meshIdle` 扩展。`mesh-pose` 动作接受原生数值参数，`mesh-motion` 播放原生动作 ID；常规 `expression` 同样驱动动态角色，happy 映射为 smile。文字对白提供模拟口型，不代表已生成语音。

Agent 工具为 `narrative_mesh_open/read/edit/preview/save/check/rebuild`。绑定修改先读取真实 `localVersion`，整批通过原生验证才写入；重建和差分导入使用隔离暂存目录，成功后替换工程文件。角色工作室不生成 Cubism 的 `.moc3` 文件。
