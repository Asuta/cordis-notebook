# 角色剧场 Agent 上下文

应用 ID 为 roleplay，只有 plugins/chat 一个业务插件。client.js 负责应用状态、正式故事、试聊、工作台 Agent 工具与自动保存；chat.js 渲染沉浸式聊天与图片附件；editor.js 渲染创作页面与模型设置；story-editor.js 复用身份、开场与记忆表单；experience.js 提供默认插画、氛围和安全叙事排版；model.js 定义结构、迁移、验证和上下文组装；server.js 负责本地持久化与模型调用。style.css 提供基础控件，theatre.css 提供桌面双栏、编辑器预览、移动底栏与抽屉。

作品 schemaVersion 为 2，与模型设置的版本分开。normalizeProject 将 v1 作品补齐到 v2，normalizeSession 补齐旧会话的 player/opening/memory，不改动原文案、revision 和消息。项目最大 2 MB，立绘与背景只接受 PNG/JPEG/WebP data URL，每张最多 800000 字符；默认 SVG 只存在源码，不允许通过作品字段注入 SVG 或任意 URL。

模型设置使用 schemaVersion 3，包含 protocol（responses 或 chat）、baseUrl、model、apiKey、reasoningEffort（default/off/low/medium/high）、timeoutSeconds（30–600）与 stream。旧版设置读取时会自动迁移并补齐默认值。Responses 请求把系统提示放在 instructions，逐轮发送完整 input；图片以 input_image 的 data URL 发送。思考强度在 Responses 下发送 reasoning.effort，在 Chat Completions 下发送 reasoning_effort，default 不发送该字段。

对话生成使用流式接口：服务端路由 /sessions/:id/stream 以 SSE 推送 {type:'delta',text}，完成后推送 {type:'done',session}；客户端通过 sdk.stream 读取并增量更新界面，停止按钮通过 AbortController 取消请求。只有完整生成才会保存会话，停止或报错都不写入半截回复。

## 编辑项目内容

优先使用页面工具，不直接改用户数据文件。先调用 roleplay_read 查看当前项目和 localVersion，再通过 roleplay_edit 以 projectId 与刚读取的 localVersion 提交原子操作。工具只修改项目内容，不读取或写入 API Key。项目结构包括：

- character：姓名、简介、性格、背景、情境、开场白与示例对话。
- player：新故事默认玩家的 name、description、relationship，使用 set_player{patch} 修改。
- opening：新故事默认第一幕的 title、location、time、situation，使用 set_opening{patch} 修改。
- presentation：portrait、background、theme（amber/forest/midnight），使用 set_presentation{patch} 修改。
- attributes：作者定义的任意属性，是否注入上下文由 includeInContext 控制。第一版由作者编辑属性值。
- worldInfo：关键词、设定内容、启用状态及是否始终注入。
- context：系统指令、作者备注、历史轮数、随机度及回复长度。

玩家消息可选带 images 数组（最多 2 张，PNG/JPEG/WebP 的 data URL），只有玩家消息可以带图。上下文预览会返回 imageCount 而不返回图片本体。

修改会通过应用验证和 revision 检查并自动保存。发生版本冲突时重新 roleplay_read，保留用户同时修改的内容。不要通过文件工具直接编辑用户数据或密钥。

## 编辑当前故事

会话独立保存 player、opening 和 memory；memory 包含 summary、scene、relationship 与 facts:[{id,content,enabled}]。先 roleplay_read，再调用 roleplay_edit_session，传入当前 sessionId、revision 和 patch；patch 只可包含完整的 player 或 memory。界面正在处理对话、打开编辑弹窗或 revision 陈旧时，重新读取后再操作。不要用作品默认身份覆盖当前故事。

PUT /api/roleplay/sessions/:id/state 更新身份或记忆并检查 revision。POST /sessions/:id/suggestions 返回三个建议，点击只填入草稿；POST /sessions/:id/memory-draft 返回候选记忆，用户确认保存前不生效。辅助生成遇到会话、作品或模型配置变化会拒绝陈旧结果。从完整消息创建分支继承记忆，从较早消息分支清空记忆，防止未来事件泄漏。

composeContext 组装人物卡、玩家身份、开场、已确认记忆、属性、匹配的世界信息、作者备注与最近消息。关闭的 facts 不注入；记忆独立于最近消息窗口，maxHistoryMessages 为 0 时也必须保留本轮玩家消息。

## 编辑器实现

工作台可使用代码工具修改本插件源码，开发模式保存后热更新。保持单插件边界。编辑器预览随本地草稿实时更新；POST /api/roleplay/playtest 接收 {project,messages,message}，使用草稿设定生成独立回复，不保存正式会话或项目。前端试聊与正式消息状态分离，试聊后修改设定的下一次回复使用最新草稿。窄屏可用“预览 / 试聊”在表单与预览间切换。

修改数据结构时同步检查验证器、迁移、上下文组装、编辑器、Agent 工具、test/roleplay.test.js 和 test/roleplay-client.test.js。运行 pnpm test:plugin --app roleplay --plugin chat；界面变化还要通过 Codex 内置浏览器检查桌面和 390×844、360×640 竖屏，包括底栏、导航抽屉、弹窗与输入区。

## 对话与数据

对话内容由本机应用后端发送至用户配置的模型服务商。不要记录或返回 API Key；测试应使用本机模拟 OpenAI 兼容服务，不触发真实付费请求。每次调用都使用当前角色卡、匹配到的世界信息、作者备注和设定数量范围内的历史消息。
