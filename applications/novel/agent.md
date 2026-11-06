# 雨幕故事工坊 Agent 上下文

应用 ID 是 `novel`。第一版只有 `plugins/game` 一个业务插件。前端在 `client.js`、`editor.js`、`player.js`；剧情校验和分支规则在 `model.js`；后端存储与 HTTP 在 `server.js`；作品包在 `package.js`。不要向通用宿主加入本应用的业务逻辑。

## 编辑游戏内容

优先用当前页面注册的工具，而不是直接改用户数据文件：

- `novel_read` 返回作品列表、当前作品（含未保存修改）、`localVersion` 和剧情问题。
- `novel_open` 按作品 ID 打开，`novel_create` 创建空白作品。
- `novel_edit` 用 `projectId`、`localVersion` 和操作数组修改作品。操作包括 `set_project`、`upsert_scene` / `remove_scene`、`upsert_character` / `remove_character`、`upsert_variable` / `remove_variable`。upsert 传完整对象；修改前先读取并保留用户未要求改变的内容。保存会检查后端 revision，冲突时不要绕过校验。删除场景后检查悬空选项。

选项条件为 `{variableId,op,value}`，op 为 `eq`、`neq`、`gte`、`lte`；效果为 `{variableId,op,value}`，op 为 `add` 或 `set`。数字/好感度可增加或设值，布尔变量只用设值。角色立绘、场景背景和音乐引用素材 ID；素材在编辑器的素材库中导入，避免直接把文件路径写到作品里。

## 编辑编辑器功能

工作台 Agent 的代码工具可以修改上述源码，开发模式保存后热更新。新增 UI 或玩法逻辑仍在 `game` 插件内部按模块组织，保持首版单插件边界；不要为了功能变化直接编辑 `dist/` 或用户数据。修改共享剧情结构时同时检查编辑器、试玩、服务端校验和作品包兼容。验证使用 `pnpm test:plugin --app novel --plugin game`，并在浏览器里检查实际体验。正式模式需构建并重启业务应用。
