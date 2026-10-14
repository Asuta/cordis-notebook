# BlockNote 页面

新建菜单选择「BlockNote 页面」，使用 `blocknote` 格式保存原生块结构。Markdown 笔记可在「更多笔记操作」中选择「复制为 BlockNote 页面」，按可表示的块结构生成副本并保留原件。

## 数据与服务

`format-blocknote` 在前后端提供 `blockNoteDocument` 服务并注册 `blocknote` 格式；`blocknote-editor` 提供编辑界面；`blocknote-agent-tools` 提供 Agent 工具。格式停用时沿用通用笔记的只读回退、搜索、导出和草稿恢复规则。

保存字段为 `document: { version: 1, blocks: [...] }`，其中 `blocks` 使用 BlockNote 0.55 的原生 JSON 加本项目自定义 schema（callout/equation/tableOfContents 及行内 math/pageLink），不是旧格式的 OutlineDocument。`content` 是自动派生的搜索、字数和 TXT 导出正文。不要手动覆盖它。

```js
{
  version: 1,
  blocks: [{
    id: 'task-1', type: 'checkListItem', props: { checked: false },
    content: [{ type: 'text', text: '检查保存', styles: { bold: true } }],
    children: [],
  }],
}
```

`ctx.blockNoteDocument.normalize(input)` 校验并复制文档；`create(type?, text?, id?)` 创建块；`text(document)` 提取正文。默认支持段落、六级标题、可折叠标题/列表、有序和无序列表、待办、引用、代码、分割线、表格、图片、音频、视频和文件块。代码只接受无样式纯文本。图片/音视频/文件通过 `props.url` 保存地址；图片限制为 1 MiB 的 PNG/JPEG/GIF/WebP，其他附件支持本地上传，单个最多 16 MiB。PDF/MP4/WebM/MP3/OGG/WAV 按内容头验证并返回对应类型，其他文件以二进制附件下载，不能作为 HTML 执行。是否能播放仍取决于浏览器支持的编解码器。备份包含本地附件，外部资源仍是链接。

`/` 菜单新增“提示框”“目录”“公式”“行内公式”。提示框 `callout` 使用原生富文本 content，`props.tone` 为 info/warning/success；目录 `tableOfContents` 不接受正文，按标题自动更新，点击定位。公式块 `equation` 使用 `props.expression`；行内公式为 `{type:'math',props:{expression:'x^2'}}`，编辑后点击完成。两种公式最多 4096 字符，使用 KaTeX MathML 渲染，关闭可信 HTML/URL 命令并限制展开次数；错误公式显示错误而不阻止编辑。HTML 导出保留自定义数据标记，Markdown 可能降级为源码或文字。未完成的行内公式会阻止页面切换及插件停用，可点击完成或取消。

最多 1000 个块、12 层子块、200000 个正文字符、1.75 MB 格式 JSON；表格最多 100 行、20 列。支持合并单元格，但每行须保留至少一个单元格；0.55 上游无法从原生 JSON 重载完全被上方合并单元格覆盖的空行，因此先拒绝这种整行纵向合并，避免保存后打不开。未知字段或超出范围的内容会拒绝，不静默丢弃。编辑器提交事务前也执行校验。

## Agent 编辑

正文输入 `@` 可插入页面引用，原生行内结构为 `{type:'pageLink',props:{noteId:'目标笔记ID',title:'插入时标题'}}`。标题显示随目标改名更新；`blockNoteDocument.references(document)` 提取引用，`remapReferences(document,ids)` 在恢复副本时重映射。子页面与反向引用见 [页面关系](../note-relations/README.md)，导入导出与图片备份见 [导入与备份](../note-transfer/README.md)。

1. `notebook_create({type: 'blocknote'})` 创建，或 `notebook_open({id})` 打开已有页面。
2. `notebook_blocknote_read({includeContent: true})` 读取块 ID、原生属性/内容及当前 `revision`，包含未保存草稿。
3. 将读取结果的 `id`、`revision` 传给 `notebook_blocknote_edit`：

```js
{
  id: '<笔记 ID>', revision: '<刚读取的 revision>',
  operations: [
    { op: 'insert', block: { id: 'task-2', type: 'checkListItem', text: '新任务', props: { checked: false } } },
    { op: 'update', blockId: 'task-1', patch: { props: { checked: true } } },
    { op: 'move', blockId: 'task-2', placement: 'inside', targetId: 'task-1' },
  ],
}
```

操作有 insert/update/remove/move；位置有 start/end/before/after/inside。一次 1–100 项，校验全通过后一次提交；非法批次不会部分应用。`props` 合并属性，`text` 将文字正文替换为纯文本并清除原样式；保留样式请读出并修改原生 `content`。表格必须使用 `tableContent`，媒体用 `props.url`。删除带子块的块会一并删除子树。

修改块 `type` 会重建目标类型的属性并保留 ID 与子块。转换为文字或表格时必须明确提供新正文；转换为 image/video/audio/file/divider 时不传 `text` 或 `content`，例如 `{op:'update',blockId:'a',patch:{type:'image',props:{url:'https://example.com/image.png'}}}`。

版本过期、页面切换、保存冲突或插件停用会拒绝操作。保存失败保留草稿，应恢复保存后重读。外部文档修改及切换笔记会重建编辑器，隔离撤销历史；段落内选区可以「添加到 Chat」并用 `replace_selection` 进行纯文本替换。

## 依赖与升级

使用 `@blocknote/core`、`@blocknote/react`、`@blocknote/ariakit` 0.55.0 的开源核心，公式使用 KaTeX（MIT）；不包含 XL、多栏、协作后端或商业 AI 功能。轻量数据库是另一个独立笔记格式，由 format-database/database-editor 提供，不嵌在 BlockNote 文档中。React 由 UI 插件共享；不得在编辑器里再创建独立 React 副本。Tiptap 补丁版本在 pnpm overrides 中对齐，升级时同步检查。

升级 BlockNote 时先核对默认 schema 与 `document.js`，再运行 `blocknote-editor/test/document.test.js`、`blocknote-agent-tools/test/agent.test.js` 及 `test/notebook-browser.test.js` 的 BlockNote 场景，确认原生编辑、保存刷新、Agent、选区、图片和旧格式复制均正常。
