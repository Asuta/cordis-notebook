# 角色剧场

面向单 NPC 自由角色扮演的创作应用，由一个 chat 插件实现。游玩页展示角色立绘、场景背景、章节与开场情境，旁白和对白分别排版。桌面使用立绘与聊天双栏；竖屏以聊天为主，角色资料折叠，底栏可切换故事、创作、记忆与设置，其他编辑页和故事列表收进导航抽屉。

编辑器提供人物卡、玩家身份、开场情境、画面与氛围、属性编辑、世界观和上下文设置。立绘和背景可上传 PNG、JPEG 或 WebP，内置可离线使用的默认插画与三套氛围配色。桌面右侧实时预览当前草稿并可独立试聊；较窄屏幕通过“预览 / 试聊”切换。试聊消息不会写进正式故事，编辑内容仍按正常流程自动保存。

每个故事独立保存玩家身份、开场和剧情记忆。新建故事前可以选择本次身份与第一幕；游玩页的玩家姓名入口可调整当前身份。“剧情记忆”支持手工修改共同经历、当前情境、当前关系和重要约定，每条约定可单独关闭；“从对话整理候选记忆”只生成草稿，核对并点击“保存并生效”后才会进入后续上下文。记忆独立于最近消息窗口，从较早消息分支时清空后来的记忆。

“接话灵感”生成三个不同方向的回复或行动，点击建议会填入输入框，玩家可修改后发送。对话还支持多会话、编辑玩家消息后继续、从任意消息分支和重新生成 NPC 回复；NPC 回复以流式输出逐字显示，生成中可以随时停止。

「设置」页集中管理模型调用参数：思考强度（服务商默认 / 关闭 / 低 / 中 / 高）、请求超时秒数和流式输出开关。Responses 协议发送 `reasoning.effort`，Chat Completions 发送 `reasoning_effort`；不支持这些参数的服务商会忽略它们。关闭流式输出后回复一次性返回，生成期间不再提供停止按钮。

应用首次启动时会创建一张原创示例人物卡和一条带 NPC 开场白的对话。模型连接支持 OpenAI Responses 与 Chat Completions（默认）两种接口，可填写任意兼容服务，例如 https://ollama.com/v1 与 deepseek-v4.1-flash:1017；保存后可用「测试连接」发一条最小请求确认。API Key 只保存在应用运行数据目录下的 settings-private.json，浏览器只知道是否已配置。工作台 Agent 可通过 roleplay_read / roleplay_edit 读取与编辑作品，用 roleplay_edit_session 编辑当前故事的身份与记忆；编辑器源码仍由现有工作台编辑。

玩家消息可以附带 1–2 张 PNG、JPEG 或 WebP 图片，浏览器端会自动缩放到 1280 像素并转为 JPEG 后随消息保存，调用模型时按 input_image 发送。应用进程会沿用 HTTPS_PROXY / HTTP_PROXY 作为模型服务的网络代理。

生成走 POST /api/roleplay/sessions/:id/stream，以 SSE 推送 delta 事件，最后发送 done 并携带保存后的会话；中途停止或断开会取消上游请求，不写入半截回复。关闭流式输出时改走一次性的 /reply 与 /regenerate。

作品使用 schemaVersion 2，增加 player、opening 与 presentation；旧版作品和会话在读取时补齐字段，保留原文案、版本和消息。辅助接口为 PUT /api/roleplay/sessions/:id/state、POST /api/roleplay/sessions/:id/suggestions、POST /api/roleplay/sessions/:id/memory-draft 和 POST /api/roleplay/playtest；前三者分别更新故事状态、生成接话建议和生成候选记忆，试聊接口接收当前作品草稿与独立消息。生成建议和候选记忆不改动正式数据。

从仓库根目录运行 pnpm install --frozen-lockfile 和 pnpm workbench，在「切换应用」中选择「角色剧场」。运行 pnpm build roleplay 构建正式版，针对性验证运行 pnpm test:plugin --app roleplay --plugin chat。

第一版聚焦单 NPC 和本机创作。暂不包含群聊、插件市场、在线分享、自动修改角色属性、图像或语音生成和 SillyTavern 卡片格式兼容。
