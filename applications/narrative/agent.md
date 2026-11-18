# 叙事引擎开发说明

应用 ID narrative。独立插件目录和数据，勿修改 novel / roleplay 的业务实现。优先 pnpm，页面调试优先 Codex 内置浏览器。用户未要求时不提交；提交说明使用中文。

从 CONTEXT.md、CONTRACT.md 和各插件清单读取术语与能力边界。project 提供 narrative（作品与运行能力），shell 提供 narrativeUI（面板、舞台叠层、工具栏），scene-runtime 提供 sceneRuntime（对象类型、实例和行为连接），scene-ui 提供 sceneViews（场景 DOM 挂载）。业务通过公开服务协作，不跨插件导入实现。不要把功能塞回通用宿主。

搭建新玩法先 narrative_scene_read，读取真实类型、字段、引用、事件、方法和 version，再用 narrative_scene_edit 提交命令；与手动属性面板共用校验、保存和撤销。批量操作用 batch，并明确 sceneId。预制体子对象编辑写到实例 overrides，不能修改其他实例。试玩中仅 narrative_scene_call 调用公开方法，不直接改 runtime.states。新增类型或编辑器能力仍通过工作台代码编辑修改所属插件。

作品的剧本放在 stories[]，不要重新添加全局 nodes/startNodeId/variables/rules。story-flow 以 props.storyId 引用资源，每个实例独立保存进度；同场景可有多份。试读明确 sceneId/objectId/storyId/nodeId。没有剧情的玩法使用 stories:[]，不要为内核添加占位剧本。旧作品和存档的迁移必须幂等，恢复失败不能覆盖当前进度。

新增对象的专用编辑入口用 narrativeUI.registerInspector 注册，随 owner 释放；不要在通用场景编辑器中硬编码各个业务面板。复用资源库中的对白演出组合或剧情播放组合，也可通过 add-prefab 与 instantiate 创建自定义组合。组合只是作品数据，插件继续独立注册能力。

事件故障先查看 narrative_scene_trace：它只读返回最近 200 条调用的来源、目标、参数摘要、结果和耗时。用户界面入口为「更多 → 设置… → 事件调试」。调试记录不写入作品或存档，不通过调试接口直接改对象状态。

编辑数据先调用 narrative_read 读取当前作品和 version；用 narrative_edit 提交完整 project 与原 version。工具自动校验与保存，试玩模式不能修改作品。API Key 通过 AI 对话面板设置，不能写入作品、截图、示例或 Agent 工具参数。

先验证受影响的插件业务测试和真实浏览器交互。完整验证见 README。上传图片和音频作为作品素材保存；内置素材在 project 自己的 assets 内。验证需覆盖旧格式迁移、多个流程实例隔离、组合展开/撤销及存档失败保护；调查模板用于验证显示插件在没有剧情流程时也可独立复用。
