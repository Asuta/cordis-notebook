# Cordis 插件应用宿主

本地、单用户的网页版应用框架。每个应用在自己的目录中拥有整套插件；同一服务一次只运行一个应用。页面右上角「切换应用」可在笔记、画图与灵感画布之间切换，各自保存数据、插件启停和设置。

常驻宿主负责 HTTP、应用发现与切换、插件生命周期、配置和恢复界面。业务功能与界面归各应用内的插件所有；通用宿主、SDK 与 npm 基础依赖仍可复用。

## 启动与使用

需要 Node.js 22.19+ 与 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm start
```

打开 http://127.0.0.1:3210/ 。首次默认打开笔记，以后恢复上次选择；关闭当前应用后重启也保持关闭。多个标签页跟随同一个全局选择，切换应用会刷新页面；应用内部启停插件仍即时生效。

- [笔记应用](applications/notebook/README.md)：普通笔记、Markdown、自由页面、BlockNote 页面、数据库、图片、搜索、主题、配置和 Agent 工具。
- [画图应用](applications/drawing/README.md)：2 个独立插件，基础画笔、撤销、自动保存和 PNG 导出，验证完全不同的应用组合。
- [灵感画布](applications/studio/README.md)：6 个插件，提供无限画布、可扩展卡片、图片生成、Pixel 接口和 Agent 操作。

需要内置 AI 时运行 `pnpm workbench`，打开 http://127.0.0.1:3211/ 。内嵌应用默认以 Vite 开发模式运行，Agent 改完代码自动热更新；发布前验收用 `pnpm workbench:production`。工作台使用独立 Pi 进程和 DeepSeek API，提供右下角聊天、代码编辑、应用工具与「选区添加到 Chat」，支持执行时间线、Markdown、模型与推理强度选择、上下文压缩和多图输入（Flash）。应用进程崩溃后聊天仍可用。密钥在聊天设置中配置，保存在 Git 忽略的 `.workbench/`。详见 [Agent 工作台设计与使用](docs/Agent工作台设计与使用.md)。

## 目录与开发

```text
applications/
  notebook/
    package.json           cordisApp 应用元数据
    assets/                应用图标
    plugins/<id>/          清单、实现、类型和 dist/
  drawing/
    package.json
    assets/
    plugins/<id>/
packages/host/             通用 SDK 与生命周期类型
server/host/               HTTP、应用切换、插件生命周期和配置
client/host/               浏览器宿主、应用选择、插件管理与恢复
shared/                    宿主共用协议
scripts/                   通用构建与导出
workbench/                 独立聊天页面、Pi 进程与应用进程管理
agent/ARCHITECTURE.md       Agent 的通用架构上下文
```

新增应用只需增加自己的目录、应用清单与插件，再安装依赖、构建和重启。插件用 dependencies 声明代码依赖，用 cordis.requires 声明运行时服务依赖；安装代码不会自动启用服务。应用名称与图标来自清单。

```sh
pnpm build                  # 全部应用及宿主浏览器入口
pnpm build drawing          # 指定应用及宿主入口
pnpm test                   # 类型检查、构建和运行时测试
pnpm dev                    # Vite 源码开发：前后端插件源码热更新，新增插件无需重启
pnpm export:app drawing work/drawing-release
```

`pnpm dev` 由 Vite 提供页面和前端源码模块，按清单加载插件。JS/JSX 更新会先保存编辑内容，再通过 Cordis 释放和重建受影响的前端插件；CSS 直接更新。后端插件通过 Vite Module Runner 按需执行源码；新增或修改插件与清单会先校验、等待已就绪页面保存，再原地更新，后端 PID 与页面不变。缺失依赖安装完成后会自动重试。宿主实现或构建工具更新仍可能需要重启。详见 [Vite 开发与热更新](docs/Vite开发与热更新.md)。

`pnpm start` / `pnpm start:runtime` 仍使用各插件 dist。正式构建的前端由 Vite 打包，后端由 esbuild 打包；修改源码后重新构建，修改后端或清单后还需重启服务并刷新浏览器。导出只含应用清单、图标及插件清单和 dist，不包含用户数据；宿主单独提供。

支持环境变量 PORT、DATA_DIR、APPLICATIONS_DIR、APP。DATA_DIR 指定宿主数据根目录。APP 指定本次启动的应用，成功后保存为最后选择；没有 .env 自动加载。旧 PLUGINS_DIR / createApp() 保留为单目录开发测试入口，默认使用应用宿主 createHost()。

## 数据与升级

```text
data/
  applications-state.json   当前应用 ID
  apps/
    notebook/              notes.json、插件配置、plugin-data、旧图片
    drawing/               插件配置、plugin-data
```

首次打开笔记应用时，将旧根目录的笔记、插件配置、plugin-data 与旧图片目录复制到 data/apps/notebook/。保留原件，不改变笔记内容格式，不覆盖已有应用数据目录。后续写入新目录。备份整个 data/；不要让多个服务进程写同一份数据。

「灵感画布」左侧栏的「应用设置」中提供该应用自己的数据目录，只控制 `data/apps/studio/`。迁移会先复制到目标旁的暂存目录，校验 JSON、图片和视频后切换；接入已有目录会直接使用所选应用目录。两种方式都不会移动笔记、画图、应用选择或宿主配置，原应用目录保留作备份。应用目录映射保存在项目根目录的 `.cordis-application-data.json`，不要与数据备份一起清理。

浏览器草稿通过 sdk.storage.local/session 按应用和插件区分。笔记应用一次性导入旧草稿、当前笔记选择及自由页面视图，保留旧键。Git 不备份数据或浏览器草稿。

旧第三方 API v1 已移除，不再支持 JSON 插件安装、worker、RPC、卸载或清理数据。旧 data/plugins/ 不执行，遗留文件保留；新的第三方安装协议不在本次范围内。

## 文档

- [框架操作协议与能力声明](docs/框架操作协议与能力声明.md)：插件操作查询、错误与重试语义、提供者契约索引。

- [应用开发与切换指南](docs/应用开发与切换指南.md)：应用清单、切换流程、数据隔离与交付。
- [项目接手与维护指南](docs/项目接手与维护指南.md)：启动、源码入口、API、备份和排错。
- [Vite 开发与热更新](docs/Vite开发与热更新.md)：开发服务器、更新策略、保存保护和错误恢复。
- [Workspace 插件开发指南](docs/Workspace插件开发指南.md)：自声明、构建、资源、类型和生命周期。
- [插件设计与协作指南](docs/插件设计与协作指南.md)：设计建议，保留插件实现自由。
- [内置插件服务契约](docs/内置插件服务契约.md)、[React 界面插件开发指南](docs/React界面插件开发指南.md)：笔记应用的服务与 UI 扩展。

## 边界

完全信任模式：后端插件在同一 Node 进程中拥有当前账户权限，前端在同一页面执行。目录和运行实例独立不是恶意代码安全沙箱；插件应登记文件句柄、定时器和子进程的清理。

应用切换先在发起页面保存，再排空后端请求、释放旧业务 Context，创建新 Context；旧页面写入会被拒绝。预检或后端启动失败会保留或恢复原应用；前端加载失败通过常驻管理器修复。其他页面未保存内容由插件草稿保留，不支持跨页面协同编辑或跨应用服务调用。

Cordis 固定为 4.0.0-rc.10。不提供插件市场、签名、自动升级、完整数据迁移回滚或应用进程隔离。

保存与存储边界见 [保存可靠性与性能边界](docs/保存可靠性与性能边界.md)，当前插件数量见 [应用插件清单](docs/应用插件清单.md)。
