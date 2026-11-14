# 叙事引擎开发说明

应用 ID narrative。独立插件目录和数据，勿修改 novel / roleplay 的业务实现。优先 pnpm，页面调试优先 Codex 内置浏览器。用户未要求时不提交；提交说明使用中文。

从 CONTRACT.md 和各插件清单读取能力边界。project 提供 narrative（作品与运行能力），shell 提供 narrativeUI（面板、舞台叠层、工具栏）。业务只通过这两个公开服务协作，节点与动作由功能插件登记。不要把功能塞回通用宿主。

编辑数据先调用 narrative_read 读取当前作品和 version；用 narrative_edit 提交完整 project 与原 version。工具自动校验与保存，试玩模式不能修改作品。API Key 通过 AI 对话面板设置，不能写入作品、截图、示例或 Agent 工具参数。

先验证受影响的插件业务测试和真实浏览器交互。完整验证见 README。上传图片和音频作为作品素材保存；内置素材在 project 自己的 assets 内。Live2D 默认停用，只有实际模型加载成功才隐藏静态立绘。

动态立绘制作使用 mesh-studio Cordis 插件。先 narrative_mesh_open（sample:true 可载入 Miko），然后 narrative_mesh_read 取得绑定和 localVersion，再 narrative_mesh_edit；预览后 narrative_mesh_save。narrative_mesh_check 只证明结构有效，姿态需目视检查；narrative_mesh_rebuild 运行真实 Python 制作工具。未指定生图任务时不调用生图服务。

作品导出使用异步 narrative.exportBundle()，完整角色资源随包携带；exportProject() 只返回轻量快照。新增资源能力走 registerResources，不跨插件导入 mesh-studio 实现。宽屏编辑器不得因每次状态事件重建 iframe。
