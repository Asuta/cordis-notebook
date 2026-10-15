# 页面模板库

通过“更多笔记操作 → 模板库”打开。将当前页面的正文和属性保存为模板；选择具体数据库时作为该数据库的记录模板，选择通用时可用于普通页面或其他父页面。

- “使用模板”创建新的独立页面，原模板和现有页面都不覆盖。可指定新标题；数据库记录模板自动进入所属数据库。
- “编辑模板”使用对应格式的编辑器。修改仅影响以后创建的页面；默认属性可通过 Agent 的 notebook_update 修改模板自身的 properties。
- “删除模板”需要再次确认，移入现有回收站。历史恢复、附件和完整 JSON 备份沿用笔记机制。
- 模板不出现在普通笔记列表、页面 @ 菜单或数据库记录中，保存在同一原子存储里；停用模板插件后可重新启用找回。
- 模板复制一篇页面，不复制子页面。数据库页面模板复制字段与命名视图，不复制记录；内嵌数据库仍引用原数据库，普通页面引用也保持原目标。
- 暂无定时重复模板、模板变量或模板市场。

模板元数据为 `template:{databaseId:null|'数据库ID'}`，实际页面为 null 或省略；模板必须位于顶层且不能拥有子页面。恢复备份时会重映射模板范围；所属数据库删除后可以保留模板，但使用前须恢复数据库或将模板改为通用。

Agent 工具：`notebook_templates` 列出模板和数值 revision；`notebook_template_save({sourceId,revision,name,databaseId?})` 另存；`notebook_template_apply({templateId,revision,title?,parentId?,select?})` 创建；`notebook_template_delete({templateId,revision})` 回收。正文读取与修改仍用 notebook_read/open/update 或 BlockNote 块工具。模板接口 revision 是 note.revision 的数值，不是通用 notebook_update 的内容哈希。

模板和数据库记录的创建先锁定当前操作、保存原稿，再执行 notebook/before-save 校验，校验快照包含将要使用的稳定页面 ID；拒绝时不会创建新页面。模板表单与数据库属性表单会保护未保存输入。
