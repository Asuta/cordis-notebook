# 已有卡片和界面增强

此模板通过 canvasUI.extend 增加卡片按钮和侧栏信息面板，不创建新卡片类型、不修改画板。业务展示在 extension.js 的 describe，挂载逻辑在 client.js。修改 actionLabel/panelTitle 可改变入口名称。

card 钩子处理新渲染的卡片；refresh 还处理注册前已有卡片和复用的 video DOM，按插件专属标记去重。dispose 移除面板和当前卡片上的按钮，stopped 防止已经脱离 DOM 的旧按钮继续执行。不要缓存历史卡片 DOM 或节点快照；按钮点击时按 ID 重新读取当前画板。

extend 不提供任意 slot 或 order；本例使用公开的 side/cards 容器。需要写操作时组合 studio-action 的 mutation.js 和 createMutation(ctx, ctx.canvasSession)，不能直接修改 node 或底层 JSON；需要设置时读取 task=studio-settings 配方。

## 验收

先运行 pnpm test:plugin --app studio --plugin {{id}}。独立浏览器中启用插件后，运行 extension-lifecycle（pluginId、actionLabel）：场景创建一张文字卡，验证面板、卡片按钮、刷新和停用恢复；不会执行任意扩展业务。默认信息业务另点击新卡片的信息按钮，检查标题/类型/连线数。修改业务后补充自己的结果断言，尤其验证切板、删除卡片和反复刷新。
