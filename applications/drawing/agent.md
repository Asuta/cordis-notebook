# 画图应用上下文

应用 ID 是 drawing。此应用独立于 notebook，不能依赖笔记服务、编辑器或笔记数据格式。

`plugins/storage` 管画作文件与 HTTP；`plugins/canvas` 管浏览器画笔、撤销、草稿、自动保存和 PNG 导出。Agent 工具由 canvas 插件注册：

- `drawing_read` 读取当前画布与本页 version，包含未保存的画作。
- `drawing_update` 接受 version 和可选 title/strokes。version 必须与当前页面相同；用户正在画或页面停止准备期间拒绝修改。画作先进入撤销历史再自动保存。
- 每个笔画有十六进制 color、1–40 的 width、0–1 归一化坐标 points。最多 3000 条笔画、30000 个点。修改前先读取，保留用户未要求删除的笔画。

保存采用后端 revision 防止不同页面覆盖。冲突时先向用户说明，保留本页草稿，不要绕过 revision 写文件。Flash 模型可理解用户主动上传的图片；当前没有图像生成或自动画布截图功能。应用工具返回的是结构化笔画，没有图片附件时不要声称已看见图像。

## 插件开发快速入口

通用流程见 `docs/插件开发导航.md` 和 `docs/Workspace插件开发指南.md`。本应用只有两个业务插件：持久化参考 `plugins/storage/`，浏览器界面参考 `plugins/canvas/`；它们不依赖 notebook 的服务、编辑器或数据格式。新增界面插件前先确认是否需要 `drawingStorage`，不要把笔记应用的 `shell`、`notebook` 或编辑器服务写进依赖。

开发模式下用 `workspace_status` 确认热更新，普通插件用 `workspace_test` 验证；报告要分别说明类型契约、构建、测试文件、浏览器验收和缺口。
