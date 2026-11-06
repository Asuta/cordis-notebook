# 角色剧场 Agent 上下文

应用 ID 为 roleplay，第一版只有 plugins/chat 一个业务插件。client.js 负责应用状态、对话、工作台 Agent 工具与自动保存；chat.js 渲染聊天与图片附件；editor.js 渲染人物卡、属性、世界观、上下文与模型设置；model.js 定义项目结构、验证、图片校验和上下文组装；server.js 负责本地持久化、模型调用与连接测试。

模型设置使用 schemaVersion 2，包含 protocol（responses 或 chat）、baseUrl、model 与 apiKey；旧版只有 baseUrl/model/apiKey 的设置会在读取时迁移为 chat 协议。Responses 请求把系统提示放在 instructions，逐轮发送完整 input；图片以 input_image 的 data URL 发送。

对话生成使用流式接口：服务端路由 /sessions/:id/stream 以 SSE 推送 {type:'delta',text}，完成后推送 {type:'done',session}；客户端通过 sdk.stream 读取并增量更新界面，停止按钮通过 AbortController 取消请求。只有完整生成才会保存会话，停止或报错都不写入半截回复。

## 编辑项目内容

优先使用页面工具，不直接改用户数据文件。先调用 roleplay_read 查看当前项目和 localVersion，再通过 roleplay_edit 以 projectId 与刚读取的 localVersion 提交原子操作。工具只修改项目内容，不读取或写入 API Key。项目结构包括：

- character：姓名、简介、性格、背景、情境、开场白与示例对话。
- attributes：作者定义的任意属性，是否注入上下文由 includeInContext 控制。第一版由作者编辑属性值。
- worldInfo：关键词、设定内容、启用状态及是否始终注入。
- context：系统指令、作者备注、历史轮数、随机度及回复长度。

玩家消息可选带 images 数组（最多 2 张，PNG/JPEG/WebP 的 data URL），只有玩家消息可以带图。上下文预览会返回 imageCount 而不返回图片本体。

修改会通过应用验证和 revision 检查并自动保存。发生版本冲突时重新 roleplay_read，保留用户同时修改的内容。不要通过文件工具直接编辑用户数据或密钥。

## 编辑器实现

工作台可使用代码工具修改本插件源码，开发模式保存后热更新。保持第一版单插件边界，按 client.js、chat.js、editor.js、model.js、server.js 分工。修改数据结构时同步检查验证器、上下文组装、前端编辑器、Agent 工具、test/roleplay.test.js 和 test/roleplay-client.test.js。运行 pnpm test:plugin --app roleplay --plugin chat；界面变化还要通过 Codex 内置浏览器检查。

## 对话与数据

对话内容由本机应用后端发送至用户配置的模型服务商。不要记录或返回 API Key；测试应使用本机模拟 OpenAI 兼容服务，不触发真实付费请求。每次调用都使用当前角色卡、匹配到的世界信息、作者备注和设定数量范围内的历史消息。
