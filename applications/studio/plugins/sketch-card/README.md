# 手绘参考卡片

画板上的小画板卡片：在卡片内用鼠标或触控画几笔，点击“生成参考图”把当前笔画导出为 PNG 素材，卡片随即成为可连接到生成卡片的图片输入。

## 数据结构

- `strokes`：笔画数组，每笔为 `{ color: '#rrggbb', width: 1–16, points: [x1, y1, x2, y2, …] }`，坐标基于 360 × 240 的逻辑画布。最多 400 笔、40000 个点；单笔最多 8000 个点。
- `assetId`：最近一次导出的参考图片素材 ID，`resolve` 只返回它。
- `referenceDigest`：导出时的笔画摘要，用于提示“参考图已是最新”还是“手绘已修改，参考图待更新”。

`card.js` 是服务端与客户端共用的定义，包含类型 ID、默认值、校验、摘要和生成输入解析；`server.js` 向 `canvasDocuments.types` 注册，`client.js` 向 `canvasUI` 注册视图和菜单。

## 保存与交互

绘制过程用 `canvasSession.draft(node, 'strokes', …)` 接入草稿、自动保存和冲突保护，不直接写画板文件；绘制期间通过 `view.beginEditing` 暂停重绘，笔画结束后保存。导出先渲染 3 倍分辨率 PNG，再经 `canvasSession.uploadMedia` 上传素材，最后由 `mutation.js` 以一次带 revision 校验的 `update` 写回 `assetId` 和 `referenceDigest`。素材上传在原子写回之外，超时或冲突不会覆盖画板。

卡片停用后 `strokes`、`assetId` 和连线仍保留，界面显示占位；重新启用后恢复绘制与参考图。菜单“✎ 手绘”通过 `mutation.js` 新增卡片并进入撤销历史。

## 验证

`pnpm test:plugin --app studio --plugin sketch-card`

`test/card.test.js` 覆盖笔画、素材、摘要校验与输入解析；`test/mutation.test.js` 覆盖异步写回保护。浏览器公共场景 `card-lifecycle` 的参数为：

- `pluginId`: `sketch-card`
- `actionLabel`: `✎ 手绘`
- `contentLabel`: `手绘参考图：按住并拖动即可绘制`

公共场景不覆盖手绘笔画、导出参考图和连接到生成卡片的业务差异，需要单独验收。
