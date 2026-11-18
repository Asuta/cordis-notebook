# 叙事引擎插件协作契约

此应用 ID 为 `narrative`，插件在本应用内通过 Cordis 服务合作，不跨应用引用实现。业务服务由 `project` 提供 `narrative`，`shell` 提供 `narrativeUI`。其他插件声明依赖这两个前端服务。原生 DOM，所有业务样式限定在 `.ne-app` 下。

## 作品结构

`{schemaVersion:1,id,revision,title,description,template,characters,assets,stories?,settings,composition?}`。

- story: `{id,name,startNodeId,nodes,variables,rules}`；每份资源独立校验章节、起点和变量，最多 40 份。省略 `stories` 或使用空数组都是有效作品，场景运行不要求存在剧情。
- 旧全局 `nodes/startNodeId/variables/rules` 读取时迁移为 `main-story` 资源，旧会客厅占位节点迁移为空资源列表；绑定已有流程对象后移除全局字段，重复读取不重复迁移。不能同时提交新旧两套剧情字段。

- character: `{id,name,description,personality,portrait,expressions:{neutral,happy,sad},color}`；图片字段为 asset ID，可为空。
  旧动态立绘字段仅保留数据校验，不提供播放与编辑能力。
- asset: `{id,name,kind:"image"|"audio",url,mime?,size?}`；通过 `engine.asset(id)` 返回 URL。内置素材归 project 插件。
- variable: `{id,name,initial,min,max}`，数值类型。
- node: `{id,type:"story"|"chat"|"ending",title,stage:{background,characterId,expression,position,scale},lines:[{speaker,text}],choices:[{id,text,target,condition?,actions:[]}],next?,chat?:{characterId,prompt,maxTurns,next,label,demoReplies:[string]}}`。position 是百分比 0–100，scale 是百分比 30–180。speaker 为角色 ID 或空字符串旁白。
- condition: `{type:"variable",variable,op:"gte"|"lte"|"eq"|"gt"|"lt",value}`；空条件恒真。
- action: `{type,...参数}`。剧情选项支持 `add-variable {variable,value}`、`set-variable {variable,value}`；旧 `expression/goto` 仅保留数据兼容，当前流程遇到不支持的动作必须报错。
- rule: `{id,name,event:"node.enter"|"choice.select"|"chat.message"|"gift.give",nodeId?:string,once:boolean,condition?:condition,actions:[]}`。
- settings: `{dialogueStyle:"novel"|"chat",accent:"#rrggbb",worldInfo:string,bgm?:string,volume?:number}`。bgm 为音频素材 ID 或空字符串，volume 为 0–1。

## narrative 服务

- getters `project`, `runtime`, `mode` (edit/play), `selection` ({storyId,nodeId,characterId,flowObjectId?,flowSceneId?}), `status`, `version`, `held`。project 只能通过 update 修改。
- `update(mutator, {render?:boolean}={})`：克隆作品、修改、校验、备份并自动保存；向 observe 发出 `{type:"project",render}`。表单 input 用 render:false 避免失焦。
- `select({storyId?,nodeId?,characterId?,flowObjectId?,flowSceneId?})`、`observe(owner,callback)`；订阅随 owner 释放。事件为 project/selection/runtime/mode/status/registry。
- `asset(id)` 返回素材 URL。`story-data` 通过 `registerProjectFormat` 注册校验、迁移、诊断、旧存档转换和组合预制体；`storyData.list()` 读取当前作品剧情，流程的游标保存在对应对象中。服务端通过 `ctx.projectFormats.register` 注册同一格式和末班车模板。停用时保留作品原字段。
- `transact(mutator)` 修改瞬时 runtime 并通知；`play({sceneId?,objectId?,storyId?,nodeId?})` 从初始状态试玩，`stop()` 返回编辑器。指定 objectId 可只将该流程从指定章节启动，其他流程正常启动；保留 `play(nodeId)` 简写。内核不再提供剧情节点处理器注册、go 或 advance，推进通过流程对象的方法完成。
- `registerAction(owner,{type,label,execute(action,payload)})`、`actions()`、`runActions(actions,payload?)`；`registerCondition(owner,{type,label,test(condition)})`、`test(condition)`。
- `onEvent(owner,async(event,payload)=>{})`、`emit(event,payload)`；插件需要 await 事件，避免剧情与规则竞争。
- `save()`、`create(template,title?)`、`open(id)`、`list()`、`importProject(object)`、`exportProject()`。导出 JSON 含上传的 data URL 素材，不含 API 密钥。
- `registerResources(owner,{id,prepare?,export?,import})`：资源插件登记保存、导出和导入钩子。`prepare(clonedProject)` 在试玩、作品切换、导出及停用前执行，可在克隆上更新资源引用；失败阻止操作。`exportBundle()` 异步返回含 `resourceBundles` 的可移植作品，导入先还原资源再写入作品，资源包不进入自动保存和浏览器草稿。同步 `exportProject()` 仍用于轻量快照。
- `registerRuntimeValidator(owner,{id,validate(snapshot,{project,composition,restoring})})` 注册对象存档校验。`validateSave(snapshot,project)` 和 `restoreRuntime(snapshot)` 都会先规范化快照，再调用全部校验器；校验以存档归属的作品为准。只有读档成功才替换当前进度。`error(message)` 显示通知及 runtime.error。
- `prefabPresets()` 返回内置组合预制体定义。放入场景时登记到作品的 composition.prefabs，再创建实例。

runtime: `{busy:false,error:"",objects?:{schemaVersion:1,sceneId,states,flags}}`。具体进度保存在各对象状态中；内核不保存全局剧情游标、变量或对白。编辑预览不执行剧情，异步回复须核对实例身份与取消信号，退出取消网络请求。

## narrativeUI 服务

- `registerPanel(owner,{id,label,icon,order,render(container)})`：面板 factory 返回可选 disposer。scene.editor 是主工作区，同作品编辑/试玩之间保持挂载；其余面板通过顶部设置入口打开，project(render!==false) 或 mode 变化时更新。
  `wide` 保留类型兼容，已不控制页面布局。`beforeLeave()` 在关闭或切换设置面板前调用，失败保留当前面板。`navigate('scene.editor')` 关闭设置返回工作区；`navigate(id)` 返回 Promise。试玩时设置只读，存档面板保持可交互。
- `registerSurface(owner,{id,order,mount(container)})`：舞台或对话叠层，挂在带相应 class 的 div；factory 返回可选 disposer。组件自行 observe runtime 并更新 DOM。
- `registerToolbar(owner,{id,label,icon,place:"player"|"header",run})`；`navigate(id)`、`refresh()`。
- `registerInspector(owner,{id,types,render(host,{object,sceneId,patch})})`：为指定对象类型追加专用编辑入口，render 可返回清理函数。`inspectors(type)` 查询匹配项，`observeInspectors(owner,fn)` 监听注册变化；对象切换、重新渲染及插件卸载时清理。patch 仍走场景命令、校验和撤销。
- `registerPanel` 可指定 `readOnly:true`，允许事件调试等只读面板在试玩时操作；不因此开放作者配置写入。
- CSS 公共类 `ne-card`、`ne-field`(label 容器)、`ne-input`、`ne-select`、`ne-textarea`、`ne-button`、`ne-primary`、`ne-muted`、`ne-row`、`ne-stack`、`ne-section-title`、`ne-badge`、`ne-empty`、`ne-danger`。所有按钮 type=button，输入有 label。
- 样式由各插件自己的 style.css 声明。只有 shell 管理全局外观与布局。

## 生命周期与交付

### 界面场景与对象

可选 composition 文档为 {schemaVersion:1,startSceneId,dependencies:[{id,version}],scenes:[],prefabs:[]}。新作品使用会客厅场景或视觉小说舞台。scene 为 {id,name,objects,connections}，与剧情 nodes 相互独立。

object 为 {id,type?,prefab?:{id,version},name?,parent?,props?,refs?,layout?,visible?,enabled?,paused?,overrides?}。type 和 prefab 二选一；父子关系禁止循环。逻辑对象可以没有可视表现，仍具备状态与生命周期。引用仅在同一场景内，用稳定 ID 解析；目标类型由注册描述的 refs 声明。父对象停用或暂停会中止后代的在途请求；隐藏只影响显示。重新启用后允许新调用，旧调用不能继续写状态。

prefab 为 {id,name,version,objects,connections,bindings?}，同 ID 不同版本可并存。实例展开时内部 ID 加上实例前缀，内部引用和连接同步重写。外部引用在定义中写成 @槽位，并通过实例 refs 绑定。overrides 以预制体内部 ID 为键，只允许 props、refs、layout、visible、enabled、paused；不改变预制体原定义。暂不支持预制体嵌套预制体。

layout 支持 mode:column/row/grid/overlay/anchor/scroll、anchor:flow/fill/top-left/top-right/bottom-left/bottom-right/center，以及 gap、padding、columns、width、height、grow、align。compact 为容器宽度小于 600px 时的覆盖。浏览器 Flex/Grid 和定位负责布局；不保存像素坐标副本或第二份编辑树。

connection 为 {id,source,event,target,method,args?,argument?}：源事件触发目标公开方法。args 为常量参数；argument 可把完整事件负载映射到一个声明参数（最终值仍需通过类型校验）。事件按顺序 await；同一调用链超过 64 步报错。连接和引用不会改变归属。插件方法可以修改自己的状态，其他对象通过 call(ref,method,args) 协作，不直接写他人状态。

narrative 增加 composition、expandScene(id,doc?)、validateComposition(doc)、sceneCommand(command,version?,validator?)、sceneUndo/sceneRedo 和 sceneHistory。sceneCommand 支持 add/patch/move/remove/clone/connect/disconnect/save-prefab/add-prefab/instantiate/unpack/add-scene/start-scene/rename-scene/batch；命令在副本上校验，成功一次保存并记入撤销历史。add-prefab 接收 prefab 定义，拒绝同 ID 同版本冲突。batch 子命令继承顶层 sceneId，也可显式指定场景。撤销重做仅限场景内容，最多 50 次；切作品清空，遇到其他入口已修改的内容则拒绝覆盖。

### sceneRuntime 与 sceneViews 服务

scene-runtime 提供 sceneRuntime。register(owner,descriptor) 登记类型，descriptor 包含 type、label、plugin、visual、container、singleton、fields、refs、methods、events 和 initial/validate/restore/interrupt 钩子。validate(props) 在运行前检查业务资源，restore(state,props) 校验恢复状态。methods[name] 为 {label,fields,run(api,args)}；api 提供只读 props/state、副作用方法 set/emit/call/flags、signal、current() 与服务访问。异步方法在返回后必须检查 current()，请求使用 signal。对象状态读取返回深冻结副本。

运行服务提供 selected/document/playing/runtime、types()/descriptor(type)、select(sceneId)、switchScene(sceneId)、expanded(sceneId?)、edit(command,version?)、undo()/redo()、call(id,method,args)、validate()、observe(owner,fn)。运行快照写入 narrative.runtime.objects:{schemaVersion:1,sceneId,states,flags}；状态键为 场景ID/对象ID。切换场景保留其他场景已保存的状态，恢复会话清除 busy。runtime.snapshot({interrupt:true}) 通过当前场景对象的 interrupt 钩子清理快照副本中的瞬时状态；目标场景成功创建后才中止原请求，加载失败不影响原场景。玩家进度由 saves 保存，不进入作品配置。

provide(owner,name,value)/service(name) 提供对象需要的服务；ai-dialogue 提供 ai.reply(payload,signal)，未配置接口时明确报错。sdk.request(path,method,data,signal?) 合并对象取消信号与插件卸载信号。基础 conversation 对象来源为 script 或 ai，消息、轮数与请求状态逐实例隔离；成功回复才提交一轮消息并触发 completed。

scene-ui 提供 sceneViews.mount(container,{sceneId?,design?,onSelect?})，返回 refresh()/dispose()。sceneId 与 design 可为 getter；编辑器据 mode 切换同一挂载点的交互语义。编辑模式拦截游戏按钮、支持点击及键盘选择；试玩模式调用运行方法。shell 仅在 scene.editor 未启用时挂载 scene.player 作为备用播放器，避免重复渲染。类型渲染和注册随 Cordis owner 卸载，不把每个对象变成单独 Cordis 插件。

scene-editor 拥有层级、游戏画面、属性检查器、资源库四区域。对象拖动在 row/column/grid/scroll 中生成 move（index 为全场景 objects 数组索引）；在 overlay/anchor 中生成 layout.anchor 覆盖。宽高调整只写 layout.width/height，范围 24–4000；窄屏手势只修改 layout.compact。每次手势使用开始时的版本号，结束提交一次，Esc/取消不提交。预制体内部对象只改实例 overrides，不能直接重排内部结构。层级拖动也校验开始时版本；引用与父子关系继续经运行时校验。

资源库包含 assets、characters、stories、sceneRuntime.types、composition.prefabs 和内置组合。剧情资源放入场景后创建绑定该资源的流程实例；对白演出组合仅含显示对象，剧情播放组合包含流程及事件连接，运行前需绑定有效剧情。音频不会伪装成可放入场景的可视对象；当前通过背景音乐设置与 sound 播放。资源导入批量读取后整体校验写入，切换作品或退出编辑后丢弃迟到结果。

Agent 工具 narrative_scene_read 返回文档、类型、方法、版本、诊断和运行快照；narrative_scene_edit 接受 {version,command}，与属性面板走同一校验及保存；narrative_scene_call 接受 {id,method,args?}，只允许试玩模式调用声明方法。编写新类型或编辑器功能通过修改插件代码完成，不在作品中执行任意代码字符串。

sceneRuntime.traces()/clearTraces()/observeTraces(owner,fn)、tracing/setTracing(boolean) 管理最近 200 条方法调用记录。每条包含 sceneId、来源对象/事件/连接、目标/方法、最多 4000 字符的参数摘要、时间、耗时和 pending/success/error/cancelled 状态。切换作品及插件卸载清空，记录不进入作品或存档。narrative_scene_trace 只读返回 {recording,entries}；scene.debug 面板支持搜索、失败筛选、暂停和清空。

当前限制为每文档 40 场景、100 个预制体版本，每场景 500 条对象记录、1000 条连接，展开后最多 2000 个对象；作品总量仍受原有大小上限约束。

每个插件自行拥有实现、清单、样式；注册项与监听随 ctx 释放，停用不残留 UI。project 负责保存与切换保护。作品模板包括会客厅、《末班车之前》视觉小说与《雨站失物》调查。调查模板没有剧情资源及流程实例，使用显示、选项、计数器与事件连接；三个调查项各消费一次。旧规则字段仅保留数据兼容。

### 独立剧情与显示插件

游戏由 composition 中的对象和连接组成。story-flow、background-view、character-view、dialogue-view、choice-list、history-view、auto-advance、playback-controls 分别登记自己的类型；story-editor 只提供编辑面板。显示插件不注入彼此或 story-flow 的服务，只依赖 narrative/sceneRuntime 等公共服务。playback-controls 通过 narrativeUI 打开存档面板，通过已注册动作使用可选音乐能力。

- story-flow 是纯逻辑对象，通过 props.storyId 绑定资源，props.startNodeId 可覆盖起始章节；可在同一或不同场景创建多份，状态独立。公开 start({nodeId?})、advance()、choose({id})、sync()，自身不挂载画面。play() 先创建运行状态、通知 mode，再 await emit('play.start',request)；启用且未暂停的流程对象启动。
- 剧情保存在 project.stories[].nodes/variables；运行进度为对象 states['场景ID/对象ID'] 中的 {storyId,started,nodeId,lineIndex,variables,stage,text,transcript,story:{awaiting},ended}。共享资源不会共享实例变量或游标。空 speaker 表示旁白；空 stage.characterId 表示角色离场。对白按顺序推进，末句之后再推进显示选项；无选项则进入 next，ending 或没有 next 时结束。空对白章节也需一次推进。
- 选项支持 variable 条件 gte/lte/eq/gt/lt，以及 add-variable/set-variable 动作。先验证全部数值操作和目标，再提交选择；数值限制于变量 min/max，拒绝未知动作或变量。无可用选项时报错，并发选择只执行一次。
- 每个流程的 story.awaiting 记录等待选择状态；剧情进度和对象快照一起保存。恢复存档不重新进入节点，不重复累计变量或历史；自动播放开关在恢复时关闭。旧全局存档仅在能唯一确定对应流程时迁移，不能确定时拒绝加载并保留当前进度。
- story-editor 的面板 ID 为 novel.editor，编辑通过 narrative.update 校验与保存。选中流程后从检查器进入已绑定资源；也可从资源库打开、新建和切换剧情。章节、对白、变量和分支属于当前资源，试读需选择引用该资源的场景/实例。人物显示和会话对象由 characters 提供人物与表情编辑入口。

流程对象事件：

| 事件 | 负载 | 模板中的接收方法 |
| --- | --- | --- |
| stage | {background,characterId,expression,position,scale} | 背景和立绘的 present({value}) |
| line | {speaker,text,key,active}，speaker 为显示名称 | 对白 present({value}) |
| choices | [{id,text}] | 选项 present({value}) |
| chapter | {title,ended} | 进入章节时触发；同章翻页、读档和界面同步不会重发 |
| playback | {title,ended} | 播放控制 present({value}) |
| history | [{name,text}] | 回看 present({value}) |
| waiting / ended | 无业务负载 | 自动推进 stop() |

对白 continued → 流程 advance；选项 selected(id) → 流程 choose({id})；对白 started/completed → 自动推进 reset/ready；自动推进 elapsed → 对白 advance；回看 opened → 自动推进 stop。连接都存为作品数据，可在场景编辑器改接。没有流程对象时，其他对象仍可通过 present 显示内容，通过事件驱动按钮、计数器等能力。

自动推进在后台页面、隐藏/停用/暂停、设置弹窗打开时等待；模板在选项和结局事件上停止。逐字显示的计时器仅更新当前实例，空格和 Enter 只在对白框获得焦点时推进。全屏使用当前逻辑视口等比缩放并居中留黑边，退出时将原画布归还编辑器。

旧 visual-novel 的 story-player 在 validateProject 时迁移为容器与独立对象，保留原 ID、父子位置和状态；指向旧对象 advance/choose 的连接改指向流程对象。迁移更新插件清单并验证结果，重复读取不重复拆分，下次保存写入新格式。

### 能力引用与结构化参数

refs 槽位既支持原有类型字符串，也支持 {type?,methods?:string[],events?:string[],optional?:boolean}。目标需满足所声明的类型及公开能力；optional 只允许不绑定，不允许绑定到不兼容对象。编辑阶段允许缺失能力以便补齐，运行前严格校验。

fields 支持 kind:'story' 选择剧情资源，以及 kind:'json'，用于对白、舞台、选项等结构化消息；拒绝循环、非有限数字和非 JSON 对象，默认最大序列化长度 250000、最大嵌套深度 64。方法仍自行验证业务结构。connection.argument 将完整事件负载映射到指定方法参数，常量参数保留在 args；属性检查器提供 JSON 编辑和参数映射入口。对白显示的 allowContinue:false 隐藏继续入口并阻止推进事件，可用于调查说明等被动显示。

### 编辑器视口与布局偏好

- narrativeUI.mountEditorToolbar(node) 将编辑器工具栏挂入应用顶部单行区域，返回卸载函数；没有此能力时编辑器保留自己的工具栏。窄屏将次要操作收进菜单。
- 编辑器与内嵌试玩共用固定逻辑视口：横屏 1280×720，竖屏 540×960。按可用宽高等比缩小并居中留黑边，不通过改变逻辑尺寸来适配编辑器面板。场景内部仍可滚动；compact 布局与聊天密度取决于逻辑视口宽度。
- 对象拖拽尺寸需把显示坐标按预览缩放倍数换回逻辑像素；拖拽重排与锚点命中仍使用显示坐标。
- 左右侧栏及资源库支持分隔条拖拽、方向键微调、双击复位、Esc 取消；面板保留最小尺寸，中间视口实时适配。窄屏保留区域标签切换。
- 资源库中的 Ctrl + 滚轮调整卡片与缩略图大小，拦截该区域内的浏览器缩放；普通滚轮仍滚动列表。资源大小范围 80–240px，点击百分比恢复默认。
- 分区尺寸、横竖屏和资源缩放使用插件本地存储 narrative:editor-layout:v1 保存，不进入作品或玩家存档，不增加编辑版本。监听、ResizeObserver 与顶部工具栏均随编辑器卸载清理。
