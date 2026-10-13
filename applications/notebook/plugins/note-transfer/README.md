# 导入与备份

在「更多笔记操作 → 导入与备份」粘贴 Markdown / HTML，或选择 `.md`、`.html`、`.json` 文件。导入创建新笔记，不覆盖原件。旧 Markdown 笔记也可用「复制为 BlockNote 页面」。

- Markdown / HTML 导入和导出使用 BlockNote 的转换器，可能简化样式、嵌套、合并单元格和页面引用；导出的媒体仍使用原地址。需要带走本地图片时使用完整 JSON 备份。
- 原生 BlockNote JSON 是 `{version:1,blocks:[...]}`，不是旧块页面的 OutlineDocument。
- 现有「导出页面 JSON」的 `cordis-note` 文件可恢复为顶层新副本；它不包含图片数据，引用的本地图片必须仍存在于当前设备。
- 「备份全部笔记（含图片）」生成 `cordis-notebook-backup` 版本 1，包含所有已保存格式、父子层级、原生页面引用和本地图片。限制：32 MiB、1000 篇笔记、2000 张图片。外部媒体仅保留链接。
- 恢复给每篇笔记分配新 ID，并重映射备份内的父页面和页面引用。引用备份之外的页面保留原 ID。每个格式需处于启用状态；未知格式、非法层级、缺失/损坏图片会拒绝整批恢复。笔记批量原子写入；磁盘异常可能留下尚未引用的内容寻址图片，但不会覆盖原笔记。

Agent 可用 `notebook_import_document({format,content,title?,parentId?})` 导入，`notebook_export_document({format})` 导出当前 BlockNote 页面文本（含草稿）；导出 JSON 保留原生结构，Markdown/HTML 返回 `lossy:true`。导入备份时采用备份自身的标题与层级。

`blocknote-editor` 提供 `blockNoteIO.parse(format,source)` / `export(note,format)` 同步转换服务；`note-transfer` 负责文件界面、备份 API 和 Agent 工具。导入调用 `notebook.importNotes` 保持保存与卸载保护，服务端通过 `notes.importMany` 校验整批并原子追加。
