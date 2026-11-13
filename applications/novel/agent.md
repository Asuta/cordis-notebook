# 雨幕故事工坊 Agent 上下文

应用 ID 是 `novel`。第一版只有 `plugins/game` 一个业务插件。前端在 `client.js`、`editor.js`、`player.js`；剧情校验和分支规则在 `model.js`；后端存储与 HTTP 在 `server.js`；作品包在 `package.js`。不要向通用宿主加入本应用的业务逻辑。

## 编辑游戏内容

优先用当前页面注册的工具，而不是直接改用户数据文件：

- `novel_read` 返回作品列表、当前作品（含未保存修改）、当前模式 `mode`（library/edit/play）、`localVersion` 和剧情问题。
- `novel_open` 按作品 ID 打开，`novel_create` 创建空白作品。
- `novel_edit` 用 `projectId`、`localVersion` 和操作数组修改作品。操作包括 `set_project`、`upsert_scene` / `remove_scene`、`upsert_character` / `remove_character`、`upsert_variable` / `remove_variable`。upsert 传完整对象；修改前先读取并保留用户未要求改变的内容。保存会检查后端 revision，冲突时不要绕过校验。删除场景后检查悬空选项。

选项条件为 `{variableId,op,value}`，op 为 `eq`、`neq`、`gte`、`lte`；效果为 `{variableId,op,value}`，op 为 `add` 或 `set`。数字/好感度可增加或设值，布尔变量只用设值。角色立绘、场景背景和音乐引用素材 ID；素材在编辑器的素材库中导入，避免直接把文件路径写到作品里。

## 第二版演出与预览

打开作品时将 schemaVersion:1 升级为 2。第二版以 scenes[].commands 为演出的唯一依据；lines、backgroundId、musicId 是兼容旧工具的投影，不要只修改投影字段。手工与 Agent 共用撤销/重做及版本保护。

- novel_edit 增加 upsert_command{sceneId,value,index?}、remove_command{sceneId,id}、move_command{sceneId,id,index}。value 为完整指令，index 为零基索引。
- novel_preview{sceneId,commandId,values?} 选择并预览指令，返回舞台、变量和当前位置。测试变量不写入存档；从当前场景初始状态重建，不推测上游路径。
- novel_history{projectId,localVersion,direction:undo或redo} 撤销或重做一次编辑并保存。

指令均含 id、type，可选 condition（同选项条件）。类型与字段：

- say{speakerId,text,voiceId?}；voiceId 引用本作品音频素材，用于对白语音与音量口型。
- background{assetId,duration}；空素材清除背景。
- show{characterId,expressionId,x,y,scale,opacity,duration}；空表情使用默认立绘。
- hide{characterId,duration}
- transform{characterId,x,y,scale,opacity,duration}
- model{characterId,expressionId,motionId,parameters,idle}；角色需关联 modelId，表情 / 动作 ID 来自该模型。parameters 为参数 ID 到数值的覆盖，空表情 / 动作清除对应演出；idle 控制自动呼吸、眨眼。合成顺序为默认值、待机、表情、动作、口型、显式参数覆盖。
- camera{x,y,scale,rotation,duration,easing} 背景镜头；x/y -50–50%，scale 0.5–3，rotation -180–180°。恢复使用 x:0,y:0,scale:1,rotation:0。
- shake{strength,duration,frequency} 画面震动；强度 0–5%，时长 0–10000ms，每秒 1–30 次。一次性效果，在读档和回退时不重播。
- weather{effect:none或rain或snow或sakura,intensity,speed} 密度 0–1，速度 0.1–3；跨场景持续，用 none 清除。
- filter{brightness,contrast,saturation,grayscale,sepia,blur,hue,duration} 前三项 0–3，黑白 / 怀旧 0–1，模糊 0–20px，色相 -180–180°。原色值为 1,1,1,0,0,0,0；滤镜持续到后续指令更改。
- animate{target:background或stage或character,characterId,animationId} 指向作品 animations 中的 ID，characterId 在非角色目标时用空字符串；空 animationId 停止该目标动画。同一目标替换，角色动画切场景清理。
- music{assetId,volume,duration}；空素材停止音乐。
- sound{assetId,volume}
- wait{duration}
- set{variableId,op:set或add,value}
- choice{} 使用场景 choices，选择后应用效果并进入目标场景。
- jump{targetId} 直接进入场景，连续无交互跳转有循环保护。

时长单位毫秒（0–30000）；x 为画面宽度百分比（-50–150），y 为从底部上移百分比（-100–100）；scale 0.1–3，opacity、volume 0–1。角色可带 expressions:[{id,name,portraitId}]。变量可带 scope:save（默认）或 global（跨周目，读档和回退不重置）。

作品可带 `animations:[{id,name,duration,iterations,keyframes}]`。novel_edit 支持 `upsert_animation{value:完整定义}` 与 `remove_animation{id}`，共用版本保护和撤销。动画时长 16–30000ms，iterations 为整数 0–20（0 循环），2–32 个关键帧，格式 `{at,x,y,scale,rotation,opacity,easing}`。at 从 0 到 1 严格递增，首尾固定为 0 和 1；x/y -100–100%，scale 0.1–3，rotation -360–360°，opacity 0–1。easing 可为 linear、ease-in、ease-out、ease-in-out，适用于镜头与关键帧。最多 60 个动画；删除前先处理所有引用。

`say` 可选 `mode:dialogue|monologue|subtitle`；可选 `textStyle:{color,size,align,bold,italic}`，颜色为 #RGB / #RRGGBB，size 为 70–180%，align 为 left / center / right。分段样式为 `segments:[{text,color,bold,italic,ruby}]`，最多 60 段，ruby 为最多 100 字的注音（无需注音时空字符串）。所有分段 text 拼接必须等于 say.text；文字按文本渲染，不支持 HTML。普通对白无这些字段时保持原行为。

运行逻辑在 engine.js，共用渲染在 stage.js，演出编辑在 director.js，连线在 graph.js。存档绑定作品 revision；编辑后旧 revision 存档不可用。新旧作品包均支持导入，新包重映射指令和表情中的素材 ID。

## 驱动当前页面试玩

工作台通过 `app_list_tools` 发现工具，再用 `app_call` 调用 `novel_play`。这是当前页面的真实播放器，与手工点击共用进度、变量、自动存档、已读和结局解锁；静态画面检查继续用不写入游玩进度的 `novel_preview`。

`novel_play` 必填 `action`，可传 `projectId` 校验当前作品，避免作品切换后误操作。先 `novel_open` 打开作品，再启动试玩：

| action | 参数与行为 |
| --- | --- |
| start | 默认从作品起点重新启动，先保存未保存的编辑；可指定 `sceneId`、该场景内的 `commandId` 和 `values` 测试变量。未指定场景时使用作品起始场景，不自动续读。 |
| status | 读取当前试玩状态，不推进或关闭面板。 |
| advance | 补全当前逐字显示并推进到下一个交互点，也可跳过当前等待。到达分支时必须先 choose，故事结束后需要 restart 或 exit。 |
| choose | 必填 `choiceId`，使用最新状态 `choices` 中的 ID；应用选项效果并进入目标场景，不允许选择条件未满足的选项。 |
| rollback | 回到上一个交互点并跳过等待记录；可用性见 `canRollback`。普通变量随之恢复，global 变量保留。 |
| restart | 从作品起点重新开始，清空本次历史，重置普通变量；保留 global 变量、已读及已解锁结局。 |
| exit | 退出试玩回到编辑器，返回 `mode`、`projectId` 和 `localVersion`。 |

除 exit 外，成功调用返回 `mode:play`、`projectId`、`revision`、`sceneId`、`sceneTitle`、`index`、`current`（指令含 id/type/text 等）、`speakerName`、`stage`、`values`、`ended`、`textComplete`、`choices:[{id,text,targetId}]`、`historyLength`、`canRollback`、`unlockedEndings`，以及 `auto`、`skip`、`dialogueHidden`、`panelOpen`。只在当前为分支时返回条件满足的 choices。返回值是快照，手工操作或等待计时结束后可再次 status 获取最新状态。

控制动作 advance/choose/rollback/restart 会停止自动播放和已读快进、显示对白并关闭阅读面板。start 的测试变量需使用作品中已有的变量 ID 和相同类型；数值范围 -9999–9999。从指令启动按当前场景重建，不推测上游路径。测试值不修改编辑器中的变量初始值，但此次真实试玩会更新游玩存档，global 变量也会持久保留。

例如工作台调用启动：`app_call {name:"novel_play",arguments:{action:"start",projectId:"作品ID"}}`；推进：`app_call {name:"novel_play",arguments:{action:"advance"}}`；分支：`app_call {name:"novel_play",arguments:{action:"choose",choiceId:"最新choices中的ID"}}`。未启动试玩时，status/advance/choose/rollback/restart/exit 会提示先 start。试玩中应先 exit，再调用编辑、静态预览或编辑撤销工具。

## 动态角色工作室与开放模型

模型模块在 `plugins/game/live2d/`。`document.js` 管理工程与批量编辑，`controller.js` 管理页面历史和保存，`studio.js` 是工作室，`renderer.js` 封装 Canvas 渲染，`generation.js` 处理 AI 分区 / 补画 / 拆层 / 绑定，`server.js` 保存模型快照与制作任务。StandRig 固定提交与 Apache-2.0 许可证见 `live2d/vendor/standrig/PROVENANCE.md`；不要直接修改 vendor 源码。开放工程不是 Cubism `.moc3`。

先用 `novel_open` 打开作品，退出试玩后再编辑模型。以下工具与工作室共用同一模型、未保存修改和撤销历史：

| 工具 | 参数与行为 |
| --- | --- |
| novel_model_read | 无参数；返回当前模型完整文档、models 清单、localVersion、预览状态、诊断、撤销状态与制作任务。 |
| novel_model_open | `{id,projectId?}` 打开模型并显示工作室。 |
| novel_model_create | `{name?,model?,projectId?}` 创建空白模型或复制完整开放工程；纹理必须引用当前作品图片。返回新 ID。 |
| novel_model_edit | `{modelId,localVersion,operations,projectId?}` 原子应用 1–100 个操作并保存；校验失败整批不修改。 |
| novel_model_preview | `{modelId?,parameters?,expressionId?,motionId?,time?,playing?}` 设置预览；time 为毫秒，0–60000，不改工程。 |
| novel_model_build | `{modelId,localVersion}` 按语义部件自动绑定，可撤销；锁定部件不改。 |
| novel_model_check | `{modelId?,poseId?,verdict?:pass或repair,note?}` 返回14个固定姿态、缺失眼嘴素材、物理和网格翻折诊断。传 poseId 冻结姿态，供看图或精修；记录本轮通过/返修备注，编辑后清空。自动诊断不能判断美术自然度。 |
| novel_model_history | `{modelId,localVersion,direction:undo或redo}` 撤销 / 重做并保存。 |
| novel_model_generate | `{sourceAssetId,name?,segmentationAssetId?,repairAssetId?,featureAssetId?,projectId?}` 启动单张立绘制作；可复用本作品内的阶段图片，先产出候选。featureAssetId 是与原图对齐的闭眼和张嘴补画。 |
| novel_model_job | `{action:status或cancel或retry或adopt,id?,projectId?}` 管理任务；未传 id 时使用当前任务，adopt 幂等且不覆盖已有模型。 |

每次修改前先 read，携带最新 `modelId/localVersion`，不要复用旧版本。后端另以模型 `revision` 检查跨页面冲突；冲突保留本地草稿，不要绕过校验。关联角色使用 `novel_edit` 的 `upsert_character`，保留完整角色字段并设置 `modelId`。角色的 `portraitId` 保留静态回退图。

工程结构为 `{schemaVersion:1,id,name,revision,sourceAssetId,rig,expressions,motions,generation}`。`rig` 含 `stage:{width,height}`、`assets`、`parts`、`parameters`、`deformers`、`physics:{enabled,chains}`。纹理格式 `{id,name,type:"image",src:"asset:素材ID",width,height}`；顶点使用纹理像素坐标 `{id,x,y,u,v}`，u/v 在 0–1，三角形是顶点索引数组。部件 transform 的 x/y 使用舞台像素坐标；剧情 show/transform 的 x/y 仍是舞台百分比。

`novel_model_edit.operations` 中每项都有 `type`，其余字段如下。upsert 必须保留完整对象：

| 操作 | 字段 |
| --- | --- |
| rename | `name` |
| set_part | `id,patch`；允许 name、visible、locked、drawOrder、parentId、deformerId、role、clip、blendMode、assetId |
| transform | `id,patch`；允许 x、y、rotation、scaleX、scaleY、pivotX、pivotY、opacity |
| add_image | `asset:{id,name,width,height},role?,x?,y?`；id 是本作品图片素材 ID |
| upsert_part / remove_part | `value:完整部件` / `id` |
| generate_mesh | `id,columns?,rows?`，行列各 1–40，重建会清除该部件原网格绑定 |
| move_vertex | `id,vertexId,x,y` |
| add_vertex / remove_vertex | `id,value:{id,x,y,u,v}` / `id,vertexId` |
| set_triangles / mirror_mesh | `id,triangles:索引数组` / `id` |
| set_keyform / remove_keyform | `id,parameter,input,offsets`；多参数改用 `parameters:[ID...],inputs:{ID:值}`，最多 3 个维度；remove 不传 offsets |
| bind_transform / remove_binding | `id,binding:{parameter,property,keys:[{input,value}]}` / `id,parameter,property`；property 是 transform 字段 |
| upsert_parameter | `value:{id,label,min,max,default}` |
| upsert_deformer / remove_deformer | `value:完整变形器` / `id`；kind 为 rotate、warp 或 group |
| upsert_expression / remove_expression | `value:{id,name,values:{参数ID:值}}` / `id` |
| upsert_motion / remove_motion | `value:{id,name,duration,loop,tracks:[{parameter,keys:[{at,value,easing}]}]}` / `id`；duration 100–60000ms，at 为 0–1 严格递增，easing 为 linear、smooth、hold |
| upsert_physics / remove_physics | `value:完整物理链` / `id` |

关键形 offsets 是 `[{vertexId,x,y}]`，x/y 是相对基础网格的像素偏移。部件 role 可用 torso、face、hair-back、hair-front、eye-left、eye-right、brow-left、brow-right、mouth、accessory、unknown。锁定部件只允许 set_part 修改 visible/locked，先显式解锁才能调整网格或绑定。物理链字段包括 id、name、enabled、targetPartIds、sourceParameters:[{parameter,scale}]、stiffness、damping、mass、gravity、wind、output:{property,scale}；可先读已有链再修改。

示例：读取模型后调用 `app_call {name:"novel_model_preview",arguments:{modelId:"模型ID",parameters:{ParamAngleX:15,ParamEyeLOpen:0,ParamEyeROpen:0}}}` 检查转头闭眼；用 `novel_model_edit` 的 `upsert_expression` 保存表情，再在剧情中加入 model 指令。预览不创建表情，必须显式编辑工程。

AI 制作读取服务端的图像服务配置，密钥不返回页面或工具结果。依次生成分区图、补画脸部、按原图拆层、自动绑定；任务失败 / 取消可重试，完成后检查候选和阶段图片再采用。复杂遮挡和极限姿态需手工修整。作品包导出 `models/<id>.json` 和所有纹理、原图、阶段图片，导入后仍可编辑。每部作品最多 30 个模型、800 个素材，总素材 256 MB，单素材 8 MB，单模型 12 MB；不要直接改模型清单或绕过专用保存接口。

## Mesh Avatar 原生角色与官方编辑器

作品库「✦ Miko 官方角色示例」创建含官方 Miko 的独立作品。角色使用 `engine:"mesh-avatar"`，与原有 StandRig 模型共存；不要把两种工程的参数或编辑操作混用。模块在 `plugins/game/mesh-avatar/`，`vendor/` 为固定提交的上游源码与素材，适配在 `editor-bridge.ts`、`editor-entry.tsx`、`studio.js`、`renderer.js` 和 `server.js`；来源和构建方式见 `PROVENANCE.md`。不要直接修改 `vendor/`。

先打开对应作品并退出试玩，再调用以下工具。工具操作的就是页面嵌入式编辑器，保留未保存修改、撤销历史及版本检查：

| 工具 | 参数与行为 |
| --- | --- |
| novel_mesh_open | `{modelId?}` 打开当前作品中的原生角色及完整编辑器，返回绑定、`localVersion` 和未保存状态。 |
| novel_mesh_read | 读取当前工程的原生 `rig`、口型配置、`localVersion` 和保存状态。 |
| novel_mesh_edit | `{localVersion,operations:[{path,value}]}` 原子替换 1–100 个已有原生字段，先通过上游校验再更新编辑器，可撤销。路径和取值以最新 read 为准，例如 Miko 的 `head.shiftX`；不能使用 StandRig 的字段名。 |
| novel_mesh_preview | `{parameters?,expression?,idle?}` 控制实际姿态预览；参数使用 `angleX`、`angleY`、`angleZ`、`gazeX`、`mouthOpen` 等原生名。表情支持 neutral、smile、shy、surprise、halfLidded、angry、sad、wink。 |
| novel_mesh_save | 保存并同步为游戏使用的新模型版本；作品数据会刷新，旧快照保留。 |
| novel_mesh_check | 调用上游绑定校验器，返回 issues；画面质量仍需实际看预览。 |
| novel_mesh_rebuild | 保存标注并运行上游分层重建工具，完成后同步游戏模型；需要本地 uv、Python 及图像依赖。 |

编辑后显式调用 `novel_mesh_save`，再用 `novel_play` 试玩。模型文档保留 `editorProject`、`nativeRig`、`manifest` 及游戏侧参数 / 表情映射；原生 `.mavatar` 按 revision 保存于模型快照目录，作品包携带其完整工程。导入后可继续编辑，不生成 Cubism `.moc3`。Miko 的许可与来源必须随包保留，不可作为独立素材包分发。

## 编辑编辑器功能

工作台 Agent 的代码工具可以修改上述源码，开发模式保存后热更新。新增 UI 或玩法逻辑仍在 `game` 插件内部按模块组织，保持首版单插件边界；不要为了功能变化直接编辑 `dist/` 或用户数据。修改共享剧情结构时同时检查编辑器、试玩、服务端校验和作品包兼容。验证使用 `pnpm test:plugin --app novel --plugin game`，并在浏览器里检查实际体验。正式模式需构建并重启业务应用。
