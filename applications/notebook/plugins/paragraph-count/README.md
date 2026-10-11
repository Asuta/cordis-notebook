# 段落计数

在编辑区底栏（`footer` 扩展位）显示当前笔记按空行分段的非空段落数。

## 规则

- 分段按**源码空行**规则：一段是连续的非空白行，空行（可含空格或制表符）分隔段落；CRLF 与 LF 等价，空白正文是 0 段。
- 普通笔记读 `content`；Markdown 读 `markdown` 源码，不用 `content` 派生纯文本（它不保留空行），源码为空时也不回退。
- 自由页面等其他格式明确显示“暂不支持该格式”，不做错误统计。
- 状态提示：没有选中笔记 → “未选择笔记”；正文为空 → “正文为空（0 段）”。

编辑正文与切换笔记都会触发 `notebook/changed`，订阅时立即渲染一次。节点与订阅都由 `sdk.mount` 挂载点和 `ctx` 拥有，停用时释放，重新启用只挂载一份，不重复。

无设置项、无额外依赖，只消费公开的 `notebook` 服务与 `shell` 的 `footer` 扩展位。

## 验证

```bash
pnpm test:plugin --app notebook --plugin paragraph-count
```

测试文件：`test/paragraphs.test.js`（分段规则与格式源码选择）、`test/client.test.js`（挂载、状态提示、编辑与切换更新、停用重启不重复挂载）。桩 DOM 不替代真实浏览器验收。
