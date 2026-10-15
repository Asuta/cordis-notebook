# 笔记应用上下文

应用 ID 是 notebook。业务全部在本目录 `plugins/` 中：storage 管持久化；notes/notes-api 管业务与 HTTP；note-formats 和 format-plain/format-markdown/format-freeform/format-blocknote/format-database 格式插件管数据类型；markdown 提供 Markdown 渲染与纯文本转换服务；notebook 管浏览器选择、草稿、保存；editor/markdown-editor/free-page-editor/blocknote-editor/database-editor 管实际编辑界面；rich-text 为自由页面封装 TipTap。

通用工具在 `plugins/agent-tools/client.js`，依赖 notebook 服务；块级工具在 `plugins/blocknote-agent-tools/client.js`，依赖 notebook 和 blockNoteDocument，两个工具插件均默认启用。停用各自插件后对应工具消失；停用块格式不影响通用工具。工具通过浏览器公开模型读取当前页面及未保存内容，不直接读写 notes.json。

- `notebook_list` 列出笔记和当前选择。
- `notebook_read` 返回笔记与 revision；`notebook_open` 先保存当前笔记，再打开目标。
- `notebook_create` 创建 plain、markdown、freeform、blocknote（BlockNote 页面）或 database（数据库页面）笔记，也可用已安装格式插件的类型。工具并不保证未启用的格式可用。
- `notebook_update` 只修改已打开笔记，要求刚读取的 revision。patch 正文分别为 plain 的 content、markdown 的 markdown、freeform 的 blocks/page/version、blocknote 的 document；不要用非 plain 格式的派生 content 修改正文。数据库的 database 字段保存 fields、views、activeViewId，记录是直接子页面；修改优先 notebook_database_configure，避免整对象覆盖丢失配置。整篇替换不能保证编辑器的局部撤销历史，局部文字改写优先用选区工具。
- `notebook_blocknote_read` 读取当前 BlockNote 页面的块树、稳定 ID、文字、props 与 revision；需要富文本/表格原结构时传 `{includeContent:true}`。
- `notebook_blocknote_edit` 使用刚读取的 `{id,revision,operations}` 批量插入、修改、删除或移动块。insert/update 的 text 是纯文字替换，content 是原生行内内容或表格结构，两者互斥；待办状态用 `props.checked`。move 的 inside 嵌套到目标下，after 放在目标同级之后，start/end 放在页面顶层首尾。移动保留子树，删除包含子树；类型转换必须明确提供正文。每批 1–100 项，全部校验后一次应用保存；失败保存会保留草稿，应重新读取确认，不要盲目重放批次。完整格式见 `plugins/format-blocknote/README.md`。
- `replace_selection` 由通用桥接提供，具体修改由捕获选区的编辑器负责，支持普通、Markdown、自由页面和 BlockNote 页面。选区替换插入纯文字，保留编辑器撤销；不会把模型文本当 HTML 执行。

自由页面采用 block/outline 富文本数据，历史、粘贴、缩进和缩放有专门实现。改交互前阅读 `docs/自由页面设计与使用.md`、相应测试；不要绕过 model.edit、历史边界或格式校验。图片存储归 note-assets，不依赖笔记文件路径。

用户继续输入后，旧 revision 和旧选区应被拒绝。不要自动用新 revision 重试旧的整篇内容。刷新会失去选区附件定位，需要重新添加；聊天中的引用文字会保留。

正文语义见 `note-content.md`：普通笔记源码是 `content`，Markdown 源码是 `markdown`，自由页面是 `blocks/page/version`，BlockNote 页面是 `document`。Markdown、自由页面和 BlockNote 页面的 `content` 是派生纯文本，不保留原始空行或块结构；按空行计数必须使用对应源码。创建或修改 Markdown 用 `{ markdown: "…" }`。

## 插件开发快速入口

通用流程见 `docs/插件开发导航.md` 和 `docs/Workspace插件开发指南.md`。工作台会从本应用的 `development.json` 自动提供可选任务与模板目录；按当前需求选择入口，首次调用就获取相应的完整契约与真实示例。统计展示、按钮动作和格式/编辑器使用不同路径，不要把页脚统计示例用于所有界面需求。样式由插件自己通过清单的 `public`、`styles` 和 `build` 声明加载，主题变量见 `plugins/ui/theme.css`。

新增插件后，在工作台管理的开发模式中先看 `workspace_status` 的热更新事件，不要例行构建或重启。测试放在插件自己的 `test/**/*.test.js`；`workspace_test` 的类型检查只覆盖项目声明文件和类型测试，不会自动为 JavaScript 运行实现做静态类型检查。界面改动是否做真实浏览器验收以本轮开关为准。

BlockNote 页面（`type: blocknote`）是 Notion 风格流式编辑器，与自由页面（`type: freeform`）分别注册。正文使用 `document: { version: 1, blocks: [...] }`，每个块包含原生 `id/type/props/content/children`。通过 blockNoteDocument 服务创建和校验文档；不要写入 Tiptap JSON 或把派生 `note.content` 当作可编辑源码。图片与附件通过 note-assets 保存；数据库、页面关系、历史恢复分别使用对应插件提供的工具。

## 数据库和模板

`notebook_database_read` 返回数据库结构、命名视图、记录及数值 revision；`notebook_database_configure` 更新完整 fields/views 数组；`notebook_database_write` 写记录，properties.custom 以稳定字段 ID 为键。字段类型支持 text/number/select/multiSelect/checkbox/date/url，null 清空值。数据库视图保存筛选排序，正文的 databaseView 块用 props.databaseId/viewId 引用同一数据源；完整备份会重映射这些 ID。

`notebook_templates` 列出模板；`notebook_template_save` 另存当前页面；`notebook_template_apply` 创建独立副本；`notebook_template_delete` 回收。模板范围为通用或指定数据库，不复制子页面和记录。模板接口使用 note.revision 的数值；通用 notebook_update 仍使用 notebook_read 返回的内容哈希。
