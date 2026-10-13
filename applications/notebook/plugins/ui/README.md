# UI 能力插件

统一提供 React 运行时、shadcn/ui 组件、Lucide 图标和跟随消费插件清理的挂载接口。
其他插件通过 `ctx.ui` 使用组件和 hooks，不直接导入此目录。`cordis.runtimePackages` 声明 React/React DOM 的所有权；`runtimeModules` 将它们的公开入口映射到本插件的独立 ESM 产物。UI 本身和 BlockNote 等第三方库共用这些产物，避免重复 React 导致 hooks 失效。消费插件源码仍必须使用 `ctx.ui`，且声明 `requires.client: ['ui']`。第三方库内部的 CommonJS require 会通过构建器生成的 ESM 适配模块连接到相同实例。开发模式由 Vite 解析同一份工作区依赖。

components/ 内为 shadcn/ui 官方 new-york registry 的组件源码（2026-09-24 获取，MIT，见 SHADCN-LICENSE.md），调整了 utils 导入路径和弹窗关闭按钮的中文标签。
来源：https://ui.shadcn.com/r/styles/new-york/{组件名}.json

`mount(owner, container, element)` 首次同步挂载，后续 render 保留组件状态。消费插件释放时执行 root.unmount()；useObserve 解除服务订阅；Slot 只把外部节点放入专属容器，避免 React 与命令式编辑引擎共同修改同一 DOM。
本插件只编译自己的通用组件样式；消费插件编译各自 JSX 的 utilities，业务 CSS 也由其自身管理。构建时可通过公开入口 @cordis-notebook/ui/theme.css 引用共享色彩 token。运行时 styles 清单自动加载和清理样式，宿主恢复管理界面不依赖本插件。
