# 笔记应用上下文

应用 ID 是 notebook。业务全部在本目录 `plugins/` 中：storage 管持久化；notes/notes-api 管业务与 HTTP；note-formats 和 plain/markdown/freeform 格式插件管数据类型；notebook 管浏览器选择、草稿、保存；editor/markdown-editor/free-page-editor 管实际编辑界面；rich-text 封装 TipTap。

工具在 `plugins/agent-tools/client.js`，依赖 notebook 服务，停用该插件后这些工具应消失。工具通过浏览器公开模型读取当前页面及未保存内容，不直接读写 notes.json。

- `notebook_list` 列出笔记和当前选择。
- `notebook_read` 返回笔记与 revision；`notebook_open` 先保存当前笔记，再打开目标。
- `notebook_create` 创建 plain、markdown 或 freeform 笔记，也可用已安装格式插件的类型。工具并不保证未启用的格式可用。
- `notebook_update` 只修改已打开笔记，要求刚读取的 revision。patch 遵循格式自己的约定；不要把普通 content 字段误用于 freeform blocks。先读相关格式类型和实现。整篇替换不能保证编辑器的局部撤销历史，局部修改优先用选区工具。
- `replace_selection` 由通用桥接提供，具体修改由捕获选区的编辑器负责，支持普通、Markdown 与自由页面富文本。选区替换插入纯文字，保留编辑器撤销；不会把模型文本当 HTML 执行。

自由页面采用 block/outline 富文本数据，历史、粘贴、缩进和缩放有专门实现。改交互前阅读 `docs/自由页面设计与使用.md`、相应测试；不要绕过 model.edit、历史边界或格式校验。图片存储归 note-assets，不依赖笔记文件路径。

用户继续输入后，旧 revision 和旧选区应被拒绝。不要自动用新 revision 重试旧的整篇内容。刷新会失去选区附件定位，需要重新添加；聊天中的引用文字会保留。
