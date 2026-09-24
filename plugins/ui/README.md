# UI 能力插件

统一提供 React 运行时、shadcn/ui 组件、Lucide 图标和跟随消费插件清理的挂载接口。
其他插件通过 `ctx.ui` 使用组件和 hooks，不直接导入此目录。React 只打入本插件的 runtime.bundle.js 一次。

components/ 内为 shadcn/ui 官方 new-york registry 的组件源码（2026-09-24 获取，MIT，见 SHADCN-LICENSE.md），调整了 utils 导入路径和弹窗关闭按钮的中文标签。
来源：https://ui.shadcn.com/r/styles/new-york/{组件名}.json

`mount(owner, container, element)` 首次同步挂载，后续 render 保留组件状态。消费插件释放时执行 root.unmount()；useObserve 解除服务订阅；Slot 只把外部节点放入专属容器，避免 React 与命令式编辑引擎共同修改同一 DOM。
业务 UI 样式由本插件及对应功能插件提供，宿主恢复管理界面不依赖本插件。
