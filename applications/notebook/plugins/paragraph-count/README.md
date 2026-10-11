# 段落计数

在编辑区底栏显示当前笔记按空行分段后的非空段落数，没有选中笔记或正文为空时显示清楚的空状态。

- 消费公开的 `notebook` 服务与 `shell` 的 `footer` 扩展位，不依赖其他插件的内部实现。
- `note.content` 由格式插件派生，普通笔记直接计数；Markdown 改用 `note.markdown` 源码分段，因为派生正文会把段落用单换行连接。编辑和切换笔记时通过 `notebook/changed` 即时更新。
- 无设置项、无额外依赖。

测试放在 `test/**/*.test.js`；运行 `workspace_test({plugins:["paragraph-count"]})` 或 `pnpm test:plugin --app notebook --plugin paragraph-count`。
