# 段落计数

在编辑区底栏显示当前笔记的非空段落数（按空行分段）。

- 支持普通笔记（`content`）与 Markdown（`markdown` 源码）；其他格式显示「当前格式不支持段落计数」，不回退派生 `content`。
- 没有选中笔记显示「未选择笔记」，正文只有空白显示「正文为空」。
- 编辑正文与切换笔记都会即时更新；订阅与节点随插件上下文释放，停用再启用不会重复挂载。
- 不提供设置项，也不引入额外依赖。

测试放在 `test/**/*.test.js`；运行 `workspace_test({plugins:["paragraph-count"]})` 或 `pnpm test:plugin --app notebook --plugin paragraph-count`。
