# React 界面插件开发指南

本文的业务接口与示例属于笔记应用，源码位于 `applications/notebook/plugins/`，数据根目录为 `data/apps/notebook/`。应用层说明见 [应用开发与切换指南](应用开发与切换指南.md)。

业务服务与数据格式仍由 Cordis 管理。React 负责界面，shadcn/ui 提供组件；专用编辑引擎可以继续维护自己的 DOM，放入独立的 Slot 中。

## 目录与构建

- `applications/notebook/plugins/ui/`：唯一的 React/React DOM 运行时、shadcn 组件源码、Lucide 图标和生命周期桥接。
- `applications/notebook/plugins/<id>/view.jsx`：该插件自己的视图，通过 `ctx.ui` 取得组件与 hooks，不跨目录导入业务实现。
- `applications/notebook/plugins/<id>/dist/client.js`：浏览器构建产物，包含自己的 view.jsx，不提交。
- `applications/notebook/plugins/ui/dist/style.css`：仅 UI 通用组件样式；每个 JSX 插件用自身 tailwind.css 编译 utilities.css，@source 只扫描自身源码。公共色彩 token 从 UI 公开的 theme.css 引用，见 Workspace 指南第 8 节。
- 插件业务 CSS 由所属插件清单的 styles 声明，不依赖布局插件代管；自动加载完成才激活，停用时自动清理。
- `applications/notebook/plugins/plugin-manager-ui/`：新版插件中心，通过宿主提供的 pluginManagement 操作现有管理流程。

`pnpm build` 编译 Tailwind、UI 运行时、各插件 JSX 和宿主入口。`pnpm dev` 只监视后端导入图，修改 JSX 后需要重新构建并刷新。

## 消费 UI 服务

在插件自己的 package.json 中声明 `cordis.requires.client: ['ui', ...]`，把 dist 的 client.js 与所需样式列入 public，并把要自动加载的 CSS 列入 styles。源码 client.js 直接导入 ./view.jsx；bundle 任务声明 `jsx: { factory: 'h', fragment: 'Fragment' }`。从 ctx.ui 取得 h，不重复打包 React。完整清单见 [Workspace 插件开发指南](Workspace插件开发指南.md)。

```jsx
export function mountView(ctx, container) {
  const { h, Button, useObserve } = ctx.ui
  function View() {
    const model = useObserve(ctx, ctx.notebook)
    return <Button disabled={model.busy} onClick={() => model.flush()}>保存</Button>
  }
  return ctx.ui.mount(ctx, container, <View />)
}
```

使用 Fragment 时声明 `const Fragment = ctx.ui.React.Fragment`。组件定义应在一次插件激活内保持稳定，避免每次更新重新定义组件造成输入框重建。

## 所有权与清理

`ui.mount(owner, container, element)` 首次同步渲染，便于后续插件立即使用扩展位；返回的 `render(element)` 更新现有组件。owner 停用时调用 root.unmount()，同时清理组件订阅、弹出层与事件。

`ui.useObserve(owner, service)` 将现有 observe 服务接入 React。Cordis 上下文代理的引用可能随读取变化，所以 hook 固定一次挂载的服务引用；服务提供者变化时由 Cordis 重启消费插件重新绑定。

`ui.Slot` 在专属容器中挂载外部节点。React 不维护这个节点的内部子树；自由页面的手势/滚动/历史及 Markdown 原生输入继续由各自编辑引擎管理，React 更新工具栏不会重建输入框。

## 宿主恢复与主题

插件中心 React 界面是可停用的插件。宿主仍保留独立的管理弹窗、配置表单和安装恢复流程；界面插件停用后立即恢复宿主管理界面。它提供的 pluginManagement 服务仅在浏览器宿主中存在，管理操作仍经过保存准备、依赖保护、配置和主题确认事务。

theme-engine 只设置 CSS 变量，不枚举并覆盖所有业务组件选择器。组件样式使用 `--theme-*`，停用主题后使用宿主默认变量，停用 UI 服务后仍能使用原生管理入口。

Workspace 插件不强制使用 React，也可通过 SDK 和服务提供的挂载点扩展 DOM；资源需随插件生命周期清理。
