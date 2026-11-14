# 叙事引擎

一个独立的插件式 2D 叙事创作应用。用舞台、角色、对白、剧情分支、事件规则和 AI 聊天组装作品；作者编辑与玩家试玩共用同一份作品数据。应用 ID 为 narrative，与故事工坊、角色剧场分别保存数据。

## 开始使用

仓库根目录运行 pnpm install --frozen-lockfile、pnpm workbench，在右上角「切换应用」打开「叙事引擎」。独立开发可在 PowerShell 设置环境变量 APP=narrative 后运行 pnpm dev。控制台会打印实际地址。正式构建使用 pnpm build narrative。

首次打开即有可编辑的《星光观测站》：固定开场、两轮自由对话、赠送唱片、好感度条件和两个结局。未配置模型时，「示例对话」按轮次显示作者编写的固定回复。配置模型后才调用真实接口；调用失败会显示错误，不会伪装成模型回复。

「新建作品」提供经典视觉小说、角色互动酒馆、剧情与自由对话三套模板。上传自己的背景和角色图片、调整舞台、修改台词与选项、配置事件规则，然后从任意节点或起点试玩。示例美术从本仓库故事工坊的原创生成素材复制到本应用，运行时无跨应用引用。

## 插件组成

| 插件 | 职责 |
| --- | --- |
| project | 作品、模板、自动保存、草稿恢复与运行能力注册 |
| shell | 工作室外壳、插件贡献面板、预览舞台、作品库 |
| stage | 背景、角色站位、缩放与静态舞台呈现 |
| characters | 人物档案、立绘、情绪图片映射与素材导入 |
| flow | 剧情/结局节点、对白、分支与节点编辑 |
| dialogue | 对话框、条件选项、剧情推进与两种对白样式 |
| rules | 属性、条件判断、事件规则与可登记动作 |
| ai-dialogue | 聊天节点、示例回复、世界设定与真实模型连接 |
| sound | 音频素材、预听、音量与播放/停止动作 |
| saves | 三个手动存档位与自动游玩进度 |
| live2d | 可选 Cubism 模型加载、表现预览与动画动作，默认停用 |
| mesh-studio | 完整 Mesh Avatar Studio：动态立绘绑定、分层重建、实时预览、游戏演出及 Agent 编辑 |

插件通过公开 narrative 和 narrativeUI 服务合作，清单声明运行依赖。停用插件会移除其面板、动作或节点处理器；作品数据继续保留。需要该能力的节点会提示启用对应插件。模板选择提供初始作品内容，插件开关由当前应用的插件管理器控制。

Live2D 插件需要作者提供可访问的 .model3.json 模型及其资源、合法取得的 Web Core 脚本地址。Cubism 模型仍从外部导入；未配置或加载失败时保留静态立绘。运行库本地打包，Core 与模型由配置地址加载。请在模型所在服务允许本机页面跨域读取。

「角色工作室」提供另一套完整动态立绘制作与播放流程，使用 Mesh Avatar 原生 .mavatar 格式。点击「创建 Miko 演示作品」可立即体验转头、表情、口型、待机与发饰物理；「载入 Miko 示例」将角色加入当前作品。可编辑五官和头发控制点、预览姿态、导入眼嘴差分、重建分层，保存后用于剧情。导入自己的 .mavatar 后可继续编辑其原生工程。它不输出 Cubism .moc3。

编辑、播放和示例均可离线使用。重建分层和差分处理另需 uv、Python 3.10–3.13 与 numpy、Pillow、OpenCV；缺少依赖会显示实际失败原因。新插画的精确五官标注和差分素材仍需作者或 Agent 制作，不能把任意图片一键变成示例质量的角色。

## 规则与模型

事件规则支持进入节点、选择选项、聊天完成等触发，结合数值条件与「增减属性、设置属性、切换表情、跳转节点」动作。声音、Live2D 等插件可以贡献额外动作。数值变化按属性上下限约束，事件递归有次数上限。AI 回复只生成角色文字，数值与剧情变化由作者规则决定。

AI 对话面板支持 Chat Completions 与 Responses 两种协议。接口与模型名称由用户填写；API Key 在后端单独保存。保存设置后可测试连接。回复有请求时限、响应大小限制和过期节点结果保护。此版模型回复完成后整段显示，不包含 TTS、自动图片生成或多人发言调度。

## 保存与交付

作品数据位于 data/apps/narrative/plugin-data/project/projects/，索引在同插件目录的 index.json。作品保存使用原子快照与 revision 冲突检查；浏览器另外保留未保存草稿。

AI 私有连接位于 data/apps/narrative/plugin-data/ai-dialogue/settings-private.json。作品 JSON 不包含连接与 API Key。手动存档与自动进度按作品保存在当前浏览器的插件专属空间，包含节点、对白位置、属性、规则触发情况与聊天记录。编辑后的作品版本与旧存档不同会提示重新试玩。

导出 .narrative.json 包含作品、上传的 data URL 素材和动态角色原生工程；导入创建独立副本，并先恢复角色资源。带动态角色时须启用角色工作室再导出。内置素材由相同版本应用提供。首版不导出独立网页、不托管在线链接、不实现插件市场。

单作品最多 300 节点、40 角色、80 属性、200 规则、100 素材，轻量作品 JSON 最多 24 MB；含角色资源的导入包最多 128 MB。单个 .mavatar 最多 64 MB，导出时角色资源的 base64 总量最多 100 MB。单次图片/音频上传最多 5 MB。独立应用运行包可用通用 pnpm export:app narrative 命令导出，详见宿主应用指南。

角色原生工程与资源包单独位于 data/apps/narrative/plugin-data/mesh-studio/，不写入其他应用。更新编辑器适配代码后运行 pnpm --filter @cordis-narrative/mesh-studio prepare:studio，再运行 pnpm build narrative。compiled/ 是随源码保留的构建输入，普通构建无需联网获取上游项目。

## 扩展与验证

插件接口见 [CONTRACT.md](CONTRACT.md)。插件拥有自己的实现、样式、资源与清单，不通过跨插件实现导入协作。新增节点用 registerNode，新增规则动作用 registerAction，面板与舞台表现通过 registerPanel、registerSurface 贡献，并随 Cordis owner 释放。

验证使用 pnpm typecheck、pnpm build narrative、pnpm test:plugin --app narrative --plugin project --plugin flow --plugin rules --plugin ai-dialogue。实际页面另用 Codex 内置浏览器检查编辑、试玩、存档和插件启停。Live2D 需要另提供模型与 Core 完成模型动画验收。
