# 可选 Live2D 插件

插件默认关闭（`defaultEnabled: false`）。`pixi.js@6.5.10` 与 `pixi-live2d-display@0.4.0` 作为本插件的依赖打包；页面不会从 CDN 加载这些模块，也不会设置 `window.PIXI`。

启用后，在「Live2D 角色」面板选择角色，填写模型 URL 和 Core URL，再点「加载预览」。缺少任一 URL 时明确显示缺失项。预览成功后显示模型实际定义的动作按钮、表情 Name 建议列表；可以配置平静、开心、难过的映射及点击动作。编辑器只在点击预览时加载；试玩按 `runtime.stage.characterId` 自动加载，返回编辑时释放舞台模型。

## 必须由作者提供的外部文件

- 从合法取得的 **Cubism 4 SDK** 提供 `live2dcubismcore.js`（如该 SDK 版本要求额外运行文件，也应按其发布要求提供）。Core URL 必须由作者明确填写。插件没有内置 Core、SDK 下载地址或示例模型。
- 自有或获授权模型的 `角色名.model3.json` 及其 `FileReferences` 引用的 `.moc3`、纹理图片、`.motion3.json`、`.exp3.json`、可选 `.physics3.json`、`.pose3.json` 和声音文件。保持相对目录结构；资源服务器需要正确的文件类型和 CORS 许可。

Core 通过带 AbortSignal 的 fetch 下载，再作为本插件拥有的临时脚本执行，成功后才动态导入 Cubism4。站点 CSP 必须允许此 Core 来源的连接和 `blob:` 脚本，以及模型来源的连接和 `blob:` 图片/音频。HTTPS 页面应使用 HTTPS 或同源资源路径。

角色扩展格式（完全可省略，不改变静态角色字段）：

```json
{
  "live2d": {
    "modelUrl": "/models/lin/lin.model3.json",
    "coreUrl": "/live2d/live2dcubismcore.js",
    "expressions": { "neutral": "calm", "happy": "smile", "sad": "sad" },
    "tapMotion": { "group": "TapBody", "index": 0 }
  }
}
```

`expressions` 的值是模型 Expressions 的 `Name`，留空表示恢复默认表情。`tapMotion.group` 留空关闭点击动作，省略 `index` 在该组随机选取；也兼容 `tapMotion: "TapBody"`。所有动作都从模型定义中读取。引擎动作：

```json
{ "type": "live2d-expression", "value": "happy" }
{ "type": "live2d-motion", "group": "TapBody", "index": 0 }
```

## 叠层与释放

注册 `live2d` surface，`order: 20`，处于舞台与对话之间。透明画布覆盖完整 `.ne-preview`，按舞台 position/scale 和底部居中的立绘框对齐，支持鼠标注视与点击动作。成功渲染第一帧才在当前预览父级添加 `.ne-live2d-active`，隐藏 `.ne-surface-stage` 中的 `.ne-stage-portrait` / `.ne-stage-character`。CSS 全部限定在 `.ne-app`，不会隐藏角色编辑面板或缩略图。

退出试玩、切换场景/角色/模型 URL、停止预览和停用插件都会取消所属 fetch、释放模型、私有纹理与 blob URL、Ticker、ResizeObserver、事件监听和 WebGL 上下文。场景代次检查阻止旧模型挂回舞台。Core 引用计数归零后移除本插件的脚本，并恢复原有全局变量描述符；不会覆盖后来由其他代码替换的全局 Core。加载失败时保留静态立绘并显示原因。

## 验证

从本目录执行 `pnpm test`。测试覆盖配置、舞台几何、取消下载、Core 导入顺序、全局恢复、重复启用、并发引用、模型加载及部分失败的释放；使用受控的 Core/工厂接口测试生命周期，不冒充真实模型渲染验证。无外部 Core 与模型时，尚不能验证真实动画观感。安装依赖与整仓构建由集成方统一执行，避免共享仓库并行安装。

API 依据官方 README 和 Complete Guide：

- https://github.com/guansss/pixi-live2d-display
- https://github.com/guansss/pixi-live2d-display/wiki/Complete-Guide
