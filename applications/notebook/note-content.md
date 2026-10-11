# 笔记正文与格式字段

格式 ID 与插件目录不同，目录均相对于本应用：

| note.type | 插件目录 | 源码字段 | note.content |
| --- | --- | --- | --- |
| plain（type 缺失也按 plain） | plugins/format-plain | content | 正文原文 |
| markdown | plugins/format-markdown | markdown | markdown 服务 toText 生成的纯文本 |
| freeform | plugins/format-freeform | blocks、page、version | 按块位置排序合并的纯文本 |
| block | plugins/format-block | document（version、blocks） | 按块及子块顺序提取的纯文本 |

`plugins/markdown` 是渲染/转换服务，格式定义在 `plugins/format-markdown/format.js`。`note-formats` 按 fields 规范化格式数据，再通过 toText 派生 content。普通笔记更新 `{ content: "…" }`；Markdown 更新 `{ markdown: "…" }`；自由页面按块和版本契约更新。读取当前草稿用 notebook.current()/observe，不从磁盘读取或改其他编辑器的内部 DOM。

按空行分段是一项源码规则，不是 Markdown 渲染段落规则。例如 `# 标题\n\n正文一\n\n正文二` 按此规则是 3 个非空段落；其派生 content 会成为单换行连接的纯文本，不能用它还原这 3 段。`- 项目一\n- 项目二` 没有空行，按此规则是 1 段。空行可包含空格或制表符；CRLF 和 LF 均需处理；空白正文是 0 段。

只支持普通和 Markdown 的功能可按 type 选择原文，明确处理不支持的格式：

```js
const type = note.type || 'plain'
const source = type === 'plain' ? note.content
  : type === 'markdown' ? note.markdown : null
// source === null 表示本功能未支持的格式；空字符串表示空正文。
```

不要在 Markdown 源码为空时用 content 回退，否则可能把过期派生文本当成正文。新增格式应查它的 fields、normalize 和 toText 契约，再确定是否适用同一统计规则。

块页面更新 `{ document: { version: 1, blocks: [...] } }`，块类型、富文本正文和嵌套关系由 `blockDocument` 服务校验；契约见 `plugins/format-block/types/data.d.ts`。不能用派生 `content` 还原结构，也不要套用自由页面的坐标块字段。

`note.revision` 是服务端保存版本；HTTP 更新/删除必须传读取时的版本，收到 409 且错误 `code` 为 `NOTE_REVISION_CONFLICT` 时保留本页草稿并另存副本。格式插件暂时不可用等其他 409 保留重试能力。`notebook.current()` 和 `visible()` 返回缓存的只读快照，不能直接修改。只关心内容/选择的订阅可用 `observe(ctx, render, { reasons: ["edit", "selection", "filters", "busy"] })`，跳过仅保存状态变化的通知；默认订阅仍接收全部事件。
