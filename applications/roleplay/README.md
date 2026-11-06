# 角色剧场

面向单 NPC 自由角色扮演的创作应用，第一版由一个 chat 插件实现。左侧可以切换对话与编辑页面；作者可维护人物卡、自定义属性、关键词触发或常驻的世界信息、系统指令与作者备注，并预览实际发送给模型的上下文。对话支持多会话、编辑玩家消息后继续、从任意消息分支和重新生成 NPC 回复；NPC 回复以流式输出逐字显示，生成中可以随时停止。

应用首次启动时会创建一张原创示例人物卡和一条带 NPC 开场白的对话。模型连接支持 OpenAI Responses 与 Chat Completions（默认）两种接口，可填写任意兼容服务，例如 https://ollama.com/v1 与 deepseek-v4.1-flash:1017；保存后可用「测试连接」发一条最小请求确认。API Key 只保存在应用运行数据目录下的 settings-private.json，浏览器只知道是否已配置。工作台 Agent 可通过 roleplay_read / roleplay_edit 读取与编辑内容，代码编辑仍由现有工作台完成。

玩家消息可以附带 1–2 张 PNG、JPEG 或 WebP 图片，浏览器端会自动缩放到 1280 像素并转为 JPEG 后随消息保存，调用模型时按 input_image 发送。应用进程会沿用 HTTPS_PROXY / HTTP_PROXY 作为模型服务的网络代理。

生成走 POST /api/roleplay/sessions/:id/stream，以 SSE 推送 delta 事件，最后发送 done 并携带保存后的会话；中途停止或断开会取消上游请求，不写入半截回复。

从仓库根目录运行 pnpm install --frozen-lockfile 和 pnpm workbench，在「切换应用」中选择「角色剧场」。运行 pnpm build roleplay 构建正式版，针对性验证运行 pnpm test:plugin --app roleplay --plugin chat。

第一版聚焦单 NPC 和本机创作。暂不包含群聊、插件市场、在线分享、自动修改角色属性、图像或语音生成和 SillyTavern 卡片格式兼容。
