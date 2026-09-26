# Workspace 插件开发指南

插件位于 `applications/<app>/plugins/*`，各自是 pnpm workspace 包。本文以笔记应用 `applications/notebook/plugins/` 为例；新增应用见 [应用开发与切换指南](应用开发与切换指南.md)。插件自己声明入口、服务、配置、公开资源和构建任务；宿主扫描 JSON 清单，不维护业务注册表。当前只保留 workspace 插件体系；旧第三方 API v1 的安装和执行路径已移除。

宿主页面不再固定显示笔记应用品牌，浏览器默认标题为「插件应用」，顶栏只保留连接状态和插件管理入口。应用名称与品牌展示应归属具体界面插件。

关于如何划分职责、减少隐含耦合并保留插件灵活性，另见 [插件设计与协作指南](插件设计与协作指南.md)。该指南提供设计建议，不增加强制检查。

## 1. 新增一个普通插件

新增 `applications/notebook/plugins/note-caption/package.json`：

```json
{
  "name": "@cordis-notebook/note-caption",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@cordis-notebook/host": "workspace:*",
    "@cordis-notebook/notebook": "workspace:*",
    "@cordis-notebook/layout": "workspace:*"
  },
  "cordis": {
    "schemaVersion": 1,
    "id": "note-caption",
    "name": "当前笔记提示",
    "description": "在页脚显示当前笔记标题。",
    "defaultEnabled": false,
    "client": "client.js",
    "requires": { "server": [], "client": ["notebook", "shell"] },
    "provides": { "server": [], "client": [] },
    "settings": {
      "mode": "live",
      "fields": { "showTitle": { "type": "boolean", "label": "显示标题", "default": true } }
    },
    "public": ["client.js"],
    "build": [{ "type": "bundle", "input": "client.ts", "output": "client.js", "platform": "browser" }]
  }
}
```

再新增 `applications/notebook/plugins/note-caption/client.ts`：

```ts
import type { ClientContext, ClientSDK } from '@cordis-notebook/host'
import type {} from '@cordis-notebook/notebook/client'
import type {} from '@cordis-notebook/layout/client'

export default function (ctx: ClientContext, sdk: ClientSDK) {
  const node = sdk.el('span')
  ctx.shell.mount(ctx, 'footer', node)
  const render = () => {
    const note = ctx.notebook.current()
    node.textContent = !note ? '未选择笔记'
      : sdk.config.showTitle ? note.title || '无标题笔记' : '已选择笔记'
  }
  ctx.notebook.observe(ctx, render)
  sdk.onConfig(render)
}
```

在仓库根目录执行 `pnpm install`、`pnpm build`，重启服务并刷新页面，在管理器中启用插件。安装引起的 `pnpm-lock.yaml` 变更需要提交；不需要修改 `server/builtins.js`、宿主类型入口或 `scripts/build.js`。

`private: true` 表示这些包供当前 workspace 使用，不要求发布到 npm。JavaScript 插件同样受支持。新增声明或依赖后需要重新安装、构建和重启；目前没有清单热发现或构建热更新。

## 2. 清单字段与路径

| 字段 | 含义 |
| --- | --- |
| package `name` / `version` / `type` | 有效且全 workspace 唯一的 npm 包名、`x.y.z`、`module`；笔记继续使用 `@cordis-notebook/<id>` |
| package `dependencies` | 实际代码包依赖、公开类型所在的 workspace 包；交给 pnpm 安装 |
| `cordis.schemaVersion` | 当前清单格式版本固定为 1 |
| `id` / `name` / `description` | 持久身份、显示名、描述；改 ID 会改变启停及配置键，不宜随意修改 |
| `order` | 可选显示排序，默认 1000；不决定依赖调度顺序 |
| `defaultEnabled` | 新安装默认是否启用，省略视为 true；已有用户保存的选择优先 |
| `client` | 相对 `dist/` 的浏览器入口，必须在 public 中 |
| `server` | `{ "entry": "server.js", "export": "name" }`，entry 相对 dist；export 是具名或 default 导出 |
| `requires.client/server` | 各侧依赖的服务名数组；服务未就绪时由 Cordis 等待 |
| `provides.client/server` | 各侧提供的服务元信息；实现仍需真正注册服务 |
| `public` | 相对 dist 的公开文件白名单，允许子目录；不等于整个 dist 可访问 |
| `build` | 声明式构建任务数组，见下一节 |
| `settings` | live/restart 配置 schema，支持内置前端、后端或双端插件 |
| `styles` | 相对 dist 的 CSS 数组，必须同时列入 public；前端激活前加载，停用时移除 |
| `category` / `icon` | 分类 `{ "id":"tools", "label":"工具" }` 与 UI 图标名；分类自动出现，默认 features/功能、Puzzle |
| `exclusiveGroup` / `groupLabel` / `swatch` | 通用互斥组、显示名、可选预览色；互斥组不决定插件分类，也不限于主题 |
| `runtimePackages` | 可选共享运行时包清单；UI 包声明 React/React DOM，其他插件不得重复打包 |

清单中不写任意 shell 命令。当前支持指定的一套构建方式；新增通用构建方式才需要扩展执行器。

发现器只读取所选应用的 `plugins/*/package.json`。未知字段、无效版本、重复 ID、非法路径或公开后端入口都会使发现失败，并指出插件名称。构建模式额外检查输入文件、公开资源的构建来源及 Node 产物；运行模式只要求清单和已构建的入口、公开文件，不读取源码，也允许清单省略 build。不会悄悄跳过损坏的插件。目录符号链接及越出插件根目录的文件链接不被接受。

宿主 API 的 `packageDependencies` 展示代码包依赖，`requires` / `provides` 展示运行时服务需求与能力。代码包关系不会进入服务启动拓扑，也不会因为一个公开类型引用就禁止停用对应插件。

## 3. 通用构建

`pnpm build` 构建全部应用，`pnpm build drawing` 只构建指定应用；二者均构建宿主入口。每个应用独立校验共享运行时提供者。

所有 `input` 相对插件源码目录，`output` 相对插件 `dist/`。构建前清理该插件的 dist；不要在 dist 存放手工文件。宿主浏览器入口仍生成到 `public/runtime.js`。

| type | 用途 | 示例 |
| --- | --- | --- |
| `bundle` | JS / TS / JSX / TSX → ESM JS；本包相对实现合入产物 | `{ "type":"bundle", "input":"client.js", "output":"client.js", "platform":"browser" }` |
| `bundle` + node | 后端入口，本包实现打包，npm 包保持 external | `{ "type":"bundle", "input":"server.js", "output":"server.js", "platform":"node" }` |
| `copy` | 普通 CSS、图片、字体、JSON 等静态资源 | `{ "type":"copy", "input":"style.css", "output":"style.css" }` |
| `tailwind` | 根据该插件的 CSS 入口和 @source 声明编译 | `{ "type":"tailwind", "input":"tailwind.css", "output":"style.css" }` |

bundle 支持 `minify` 和 `jsx: { "factory":"h", "fragment":"Fragment" }`。JSX 插件在源码中从 `ctx.ui` 取得 h 和 React.Fragment；不直接 import React。UI 自己把 React/React DOM 打包一次，其他插件只使用服务。

客户端源码直接导入自己目录中的 `./view.jsx`、`./format.js` 等源文件，构建器把它们合入 dist/client.js。不要再导入旧的 view.bundle.js。后端导出函数 `(ctx, config, runtime) => ...` 或 `{ apply(ctx, config, runtime), inject? }`；若仍声明 inject，必须与清单 requires.server 一致。Service 类可在 apply 中实例化。

构建器检查本包直接导入的 npm 包是否声明 dependencies；拒绝跨插件或宿主目录实现导入、workspace 包运行时导入、从浏览器入口导入后端入口，以及不属于本插件的共享运行时包。**类型引用使用 `import type`，运行时协作使用 `ctx`。** 这些是架构约束，不构成恶意代码沙箱。

`/builtin/<id>/<资源路径>` 对应当前应用的 `plugins/<目录>/dist/<资源路径>`。前端宿主加载模块和样式时附加 appSession，过期页面资源请求被拒绝。只有 public 中的文件可以访问；即使 dist 中有 server.js 或未公开 JSON，HTTP 也返回 404。源码、package.json、类型文件和 source map 不会因为在插件目录中就自动公开。新增静态资源需要同时声明构建任务及 public。

## 4. 类型归属与前后端隔离

宿主通用类型包为 `@cordis-notebook/host`：配置、停止准备、ClientSDK、ClientContext、ServerContext。后端 HTTP 类型单独从 `@cordis-notebook/host/server` 引用。`client/contracts/index.d.ts` 只保留宿主类型兼容转发，不汇总插件业务类型。

| 能力 | 类型所有者 |
| --- | --- |
| 基础 Note / NotePatch、后端 NotesService | `@cordis-notebook/notes/data`、`/server` |
| 前端 NotebookService 与 notebook 事件 | `@cordis-notebook/notebook/client` |
| 富文本文档 / 浏览器编辑器 / 后端文档操作 | `@cordis-notebook/rich-text/data`、`/client`、`/server` |
| 自由页面 TextBlock / FreeformNote | `@cordis-notebook/format-freeform/data` |
| 格式声明和注册服务 | `@cordis-notebook/note-formats/data`、`/client`、`/server` |
| Markdown、主题引擎、图片资源 | 对应插件的 data/client/server 导出，按能力提供 |
| UI、布局、列表挂载、编辑器注册 | `ui/client`、`layout/client`、`note-list/client`、`editor-host/client`（均带 @cordis-notebook/ 前缀） |

插件在自己的 package.json 使用类型专用 exports，例如：

```json
{ "exports": { "./client": { "types": "./types/client.d.ts" } } }
```

`types/client.d.ts` 可以扩展前端服务映射：

```ts
import type {} from '@cordis-notebook/host'
export interface Counter { readonly value: number }
declare module '@cordis-notebook/host' {
  interface ClientServices { counter: Counter }
}
```

后端使用 `ServerServices`。使用服务的一方引用提供者的 `/client` 或 `/server` 类型入口，使用 `ClientContext` 或 `ServerContext`。不要再把业务属性直接合并到全局 Cordis Context，否则同名服务的前后端接口会混在一起。业务事件声明保留在其所有者插件中；宿主只声明通用生命周期事件。

类型检查自动收集 `applications/*/plugins/*/types/*.d.ts` 和 `applications/*/plugins/*/test/*.types.ts`，因此新插件不需要加入类型总表。现有根类型测试是类型的消费者，其 imports 对应根包 devDependencies；这不是运行时插件注册机制。esbuild 会移除 TS 类型，但不负责类型检查；插件作者应在自己的 test/*.types.ts 中引用并检验实现或契约。

## 5. 加载与兼容

发现阶段不 import 后端入口，即使扫描一个默认关闭的插件，其顶层代码也不会运行。先读已保存启停选择，启用记录才进入 Cordis；后端服务依赖满足后才导入 dist 入口并执行 apply。等待服务时仍保留启用选择。Node 会缓存模块，启停用于释放/重新创建插件实例，修改后端代码后需构建并重启进程。

应用目录迁移保留原有插件 ID、服务、启用选择、配置与笔记结构。笔记数据根目录改为 `data/apps/notebook/`；首次使用复制旧数据且保留原件，应用内相对路径不变。旧 API v1 插件不再加载，磁盘上的旧安装文件和专属数据不会自动删除。Workspace 后端仍在宿主进程内按完全信任模式执行。

## 6. 验收与排查

```sh
pnpm install --frozen-lockfile
pnpm test
```

`test/plugin-workspace.test.js` 在独立临时 workspace 中新增插件，验证发现不执行代码、独立类型扩展、构建及 HTTP 白名单、前端卸载、后端启停与重启恢复，并核对宿主注册/类型/构建入口未改变。它也验证包依赖不启用服务、等待恢复、损坏清单和实现导入边界。

`test/service-sides.types.ts` 验证前后端同名能力不会串用：后端不能挂载 DOM 编辑器，前端不能取得本地图片存储目录。原有笔记、富文本、React 生命周期、配置、主题回归继续运行；`test/plugins.test.js` 验证旧安装记录不执行、旧数据保留和已移除路由返回 404。

清单错误先检查 package.json；模块加载失败先运行 pnpm install 和 pnpm build，再看插件后端错误与浏览器控制台；不要用手改 dist 来掩盖源码或清单问题。完整构建与类型检查通过后，再验证真实页面中的输入、主题和插件启停。

## 7. 后端配置与插件数据

后端第二个参数是该插件经过 schema 校验的设置，不再由宿主塞入笔记文件配置。第三个参数 `runtime` 的类型是 `@cordis-notebook/host/server` 导出的 `ServerRuntime`：

```ts
import type { ServerContext, ServerRuntime } from '@cordis-notebook/host/server'
export default function (ctx: ServerContext, config: Record<string, unknown>, runtime: ServerRuntime) {
  // runtime.dataDir 已存在：<宿主 dataDir>/apps/<应用 ID>/plugin-data/<插件 ID>
  // runtime.config 始终返回当前设置；config 是本次激活的初始设置。
  ctx.http.route(ctx, 'GET', /^\/api\/counter$/, () => ({ value: runtime.config.value }))
  runtime.onConfig(async (next, signal) => {
    // 仅 live 模式需要：更新本插件的内部状态；异步任务应响应 signal。
    // 失败时抛异常，不要吞掉错误；回调随 ctx 自动清理。
  })
}
```

清单须声明 `requires.server: ["http"]`、后端入口和 settings。`live` 保留实例，等待 `onConfig` 成功；`restart` 重建后端实例及 Cordis 管理的依赖。双端插件还由发起页面应用前端设置并确认；纯后端插件也使用同一设置页面与确认协议。

正式配置仍写入 `plugins-config.json`，启停状态仍写入 `plugins-state.json`。预览失败、页面确认超时或写盘失败时，后端重建为原配置，前端恢复正式快照；恢复失败会明确报错。后端预览期间服务已使用候选设置，但尚未写入正式配置，其他页面不会主动挂载该未确认后端代次。这不是跨所有页面、数据库和外部副作用的原子事务；插件自己的文件写入或外部命令不能靠配置回滚自动撤销。

新插件将私有数据存入 `runtime.dataDir`。本段的 `<dataDir>` 指应用数据根目录，默认笔记是 `data/apps/notebook/`。原存储插件读取该目录的 `notes.json`。图片插件的新文件写入 `<dataDir>/plugin-data/note-assets/`，旧 `<dataDir>/note-assets/` 及自定义 file 旁的 note-assets/ 保留兼容读取，不迁移或删除。`createApp({file})` 仍作为兼容入口，通过 `runtime.legacyFile` 供相关插件兼容旧路径；默认运行使用 `createHost({dataDir})`，会再按应用划分数据；`createApp({dataDir})` 是保留原根目录语义的单应用测试适配器。自定义旧路径仍有图片时，保留该入口或先显式处理旧图片。

## 8. 界面挂载与样式所有权

宿主只提供通用的命名挂载注册表，不认识 shell、noteListUI 或特定布局插件 ID。提供者用 `sdk.slot(name, element)` 或 `sdk.slot(name, (consumer, node) => …)` 注册挂载点，消费者用 `sdk.mount(name, node)` 挂载。注册与节点随各自的 Cordis 上下文释放。消费者仍须在 requires 中声明提供该插槽的服务；插槽名称本身不参与依赖调度。

布局插件声明 sidebar/editor/toolbar/footer 等挂载点，列表插件声明 list-filters。复杂扩展也可以继续通过服务的 mount 方法使用。挂载点由提供者拥有，同名挂载点不可重复注册；提供者停用后可由其他插件重新提供。

业务插件自己订阅 `plugins/before-stop` 保护操作；宿主通过 `plugins/remote-stop` 并行通知其他页面或远端触发的移除，事件参数是 `{targets: string[]}`。笔记草稿提示由 notebook 插件处理，宿主不读取 notebook 的内部状态。

业务 CSS 放回所属插件；布局只保留布局表面和插槽样式，UI 只拥有通用组件样式。声明 `public: ["client.js", "style.css"]`、`styles: ["style.css"]` 以及对应构建任务后，宿主在执行前端插件前等待 CSS 加载，失败则标记启动失败，停用则移除样式。不再手写 link 元素。

JSX 插件各自编译自己的 Tailwind utilities，禁止 UI 跨插件扫描源码。使用共享 UI 色彩契约时，在 dependencies 声明 `@cordis-notebook/ui: workspace:*` 和 tailwindcss，入口示例：

```css
@import "@cordis-notebook/ui/theme.css";
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
@source "./*.jsx";
```

这里共享的是 UI 插件公开的主题 token，不是业务组件实现；React 仍仅通过 ctx.ui 共享。工具栏按钮可声明 `data-variant="destructive"` 和 `data-menu-label`，布局无需识别删除或置顶等业务操作。

## 9. 导出不带源码的运行包

```powershell
pnpm build
pnpm export:plugins C:\deploy\notebook-plugins
pnpm --dir C:\deploy\notebook-plugins install
$env:PLUGINS_DIR = 'C:\deploy\notebook-plugins'
pnpm start:runtime
```

导出目标必须尚不存在，父目录须存在。每个插件只携带 package.json 和 dist；删除 build、类型 exports、devDependencies 与 workspace 类型/样式开发依赖。普通 npm dependencies 保留，由导出目录自己的 pnpm workspace 安装，后端依赖不借用原源码插件的 node_modules。需要可复现部署时，保存首次安装生成的锁文件，后续用 `--frozen-lockfile`。

运行仍需要宿主的 server/client-host/shared/public 文件及其生产依赖；这是插件运行包导出，不是整个应用的单文件发行包。`start:runtime` 不构建；`start` 与 `dev` 仍是源码开发入口。清单发现会验证 dist 文件存在，公开资源继续受 public 白名单限制。管理页面不提供安装功能；workspace 导出包通过 `PLUGINS_DIR` 接入。

实际验收覆盖新增自定义分类、声明 CSS、纯后端设置、独立数据目录、配置失败回滚及移除源码后的启动恢复。新普通插件使用现有构建方式时，只需添加自身目录、清单与依赖，不需要再维护宿主业务注册列表。

新增应用优先使用 `pnpm export:app <应用ID> <新目录>`，将应用清单、图标及插件运行包一并交付；上文 `export:plugins` / `PLUGINS_DIR` 保留为单目录开发入口。前端业务请求用 `sdk.request()`，浏览器持久化用 `sdk.storage.local/session`，避免不同应用的草稿和偏好混用。
