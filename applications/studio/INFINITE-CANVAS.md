# infinite-canvas 移植说明

来源：[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas/tree/3a6b64b602ad062b29fac66902ed18a7ef5fd9dc)，提交 `3a6b64b602ad062b29fac66902ed18a7ef5fd9dc`，界面版本 v0.20.0，MIT 许可证。两个接收插件的 `upstream/LICENSE` 保留原版权声明。

## 直接复用的源码

| 上游 `web/src/` 文件 | 本项目位置 |
| --- | --- |
| `components/canvas/infinite-canvas.tsx` | `plugins/canvas-ui/upstream/infinite-canvas.js` |
| `components/canvas/canvas-connections.tsx` | `plugins/canvas-ui/upstream/canvas-connections.js` |
| `components/canvas/canvas-mini-map.tsx` | `plugins/canvas-ui/upstream/canvas-mini-map.js` |
| `lib/canvas-theme.ts` | `plugins/canvas-ui/upstream/canvas-theme.js` |
| `components/canvas/canvas-node.tsx` | `plugins/canvas-ui/upstream/canvas-node.js` |
| `lib/image-thumbnail.ts` 的图片源选择 | `plugins/canvas-ui/upstream/image-thumbnail.js` |
| `i18n/locales/zh-CN.ts` 的卡片文案 | `plugins/canvas-ui/upstream/node-messages.js` |
| `components/canvas/canvas-node-crop-dialog.tsx` | `plugins/image-editing/upstream/canvas-node-crop-dialog.js` |
| `components/canvas/canvas-node-split-dialog.tsx` | `plugins/image-editing/upstream/canvas-node-split-dialog.js` |
| `components/canvas/use-image-editor-viewport.ts` | `plugins/image-editing/upstream/use-image-editor-viewport.js` |
| `lib/canvas/canvas-image-data.ts` | `plugins/image-editing/upstream/canvas-image-data.js` |
| `i18n/locales/zh-CN.ts` 的 `canvas.editors` | `plugins/image-editing/messages.js` |

TS/TSX 转为可直接执行、测试的 ESM JavaScript，保留组件结构、交互和样式类；模块路径、主题状态和文案入口改为插件内部模块。没有复制上游整个应用、路由、浏览器数据库、模型 Key 存储或 Agent 实现。

## 适配边界

- `canvas-ui/surface.js` 管理视口、网格、连线和小地图；`node-presenter.js` 把上游 `CanvasNode` 接入卡片插件。文字、图片采用上游卡片结构、悬浮标题、双击编辑/预览、蓝色选中边框和四角缩放。图片缩放保持比例。卡片字段仍接入 `canvasSession` 的草稿、保存和冲突保护，用户与 Agent 共用一个服务端文档。
- `image-generation/panels.js` 按上游 `CanvasConfigNodePanel`、`CanvasNodePromptPanel` 裁减适配：保留紧凑配置卡、输入计数、下方提示词面板、参考缩略图与生成按钮。模型和比例/分辨率使用 Cordis 提供者的真实选项；原版 Ant Design 模型选择和设置弹层换为本地控件，不显示尚未接入的生成模式、提示词库、批次或高级参数。
- 卡片使用持久 React root，保存和轮询不替换正在编辑的 DOM；卸载插件和切换画板会清理对应 root。旧 DOM 卡片插件仍可使用原 `render` 接口。`upstream: true` 的卡片通过 `nodeCard` 返回可更新、可销毁的控制器。拖动和缩放由同一指针控制器提交，一次手势对应一次撤销，取消手势不写入文档。
- 左栏、顶部和底部工具按上游布局接入 Cordis 的插件注册接口。保留原卡片渲染扩展方式；没有照搬上游庞大的 `project.tsx` 业务入口。
- 画布缩放沿用 Cordis 的 15%–300% 数据约束；手势取消、退出清理及拖动期间的 Agent 写入保护已经接入。文字输入区域保留滚动。
- 裁剪/切分界面直接复用上游。结果通过现有素材上传接口保存，批量卡片一次提交、一次撤销。保留原图，并通过 `sourceNodeId` 显示来源。画板版本冲突时不覆盖另一页面；已上传素材仍可在素材库找到。切分受现有单次 100 个文档操作限制。
- 分组是独立的 `canvas-groups` 插件。公共可选字段 `width/height/groupId` 在核心校验并支持撤销。第一版仅平面分组；删除分组前需解除成员关系，界面删除整个组时连同成员删除，均可撤销。
- 继续使用 `studio.json` v1、资产 ID、图片目录和任务记录。旧节点没有新增字段时仍按默认尺寸显示，无需重写用户的旧文档。
- React 与现有笔记应用统一到同一已安装版本，避免 Vite 多应用依赖预构建产生多实例。插件正式构建仍各自包含运行依赖。

## Agent 扩展操作

先调用 `studio_read` 获取 revision 和 actions，再调用 `studio_action`：

- `group`：`{ ids: [卡片ID], title?: 名称 }`，最多 99 张尚未编组的卡片。
- `ungroup`：`{ ids: [分组或成员ID] }`。
- `image-crop`：`{ nodeId, crop: { x, y, width, height } }`，区域用 0–1 比例坐标。
- `image-split`：`{ nodeId, split: { rows, columns } }`。

停用对应插件后，操作从 `studio_read.actions` 中移除。生图仍使用 `studio_generate`，任务状态用 `studio_jobs`；编辑、连线、裁剪均不发起付费生成。

## 第一版范围

支持文字、图片与图片生成配置。视频/音频、上游独立 Agent、脚本节点插件、蒙版局部重绘、批量生成堆叠卡片和提示词库暂未接入；没有对应的无效入口。图片生成继续由已有提供者支持的参数决定。引用顺序调整和断开仍由现有连线协议处理。
