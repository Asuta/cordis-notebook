# Agent 扩展操作模板

client.js 向 canvasSession.actions 注册操作，ID 等于插件 ID。用户菜单与 Agent 的 studio_action 共用该入口，studio_read.actions 自动发现 schema。无需另建 studio_* 工具。要从 Agent 调用，现有 canvas-agent-tools 必须启用；它不是手动菜单的运行依赖。

先 studio_read 得到当前 revision，再 studio_action({id:'<插件ID>', revision, args:{title:'新画板名称'}})。不要在 args 内塞 revision；外层工具传给 action.run。action.js 既提供发现用 schema，也校验运行参数，因为 schema 不是运行时校验器。

写动作保持 mutates:true，交给 mutation.js 检查输入版本、异步期间新编辑/切板/停用并通过 expectedRevision 保存。只读扩展可另行使用 mutates:false，但不能调用写接口。异步业务只返回 operations，别绕开保护。默认示例重命名，可从界面撤销；菜单参数 boardTitle 仅供手动示例。

扩展异步业务时可将 action.js 的 operations 改为 async operations(args, {board, signal})：board 是保存已有草稿后的快照，signal 在插件停用时中止。业务由 mutation.js 通过检查后才开始，远端请求应传入 signal，最后只返回 operations。

公共菜单场景检查注册释放；重命名示例场景检查 UI 行为。Agent 发现、参数校验和 revision 冲突另由真实 canvasSession + studio_* 工具集成测试验证，菜单测试不能替代 Agent 协议测试。

## 开发和验收

通过 workspace_scaffold_plugin 生成后默认停用。先实现业务，再运行：

`pnpm test:plugin --app studio --plugin {{id}}`

开发模式用 workspace_status 检查热更新，启用并核对依赖及运行状态。浏览器在独立数据实例中 browser_open → browser_plugin({id:'{{id}}',enable:true}) → browser_scenario（参数见 workspace_development_info 返回）→ 业务差异验证 → browser_finish。分别报告构建、单元/集成测试、公共浏览器场景与未覆盖部分。
