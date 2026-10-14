# {{name:json}}

此骨架已接入 notebook/shell、更多笔记操作菜单、选择订阅、无选择禁用、异步防重复点击、错误提示和 owner 释放。业务逻辑在 action.js：label/mode/supports/run。默认 run 只显示当前标题，仍需按需求修改。

- read 模式允许只读操作；edit 模式受 busy/editable 限制。修改用 await update(patch)，它会重新检查选中笔记及内容是否变化，再调用 notebook.edit/flush。等待期间有新编辑时会拒绝旧结果并提示重新运行；仅保存原有草稿不会触发冲突。连续 update 会跟踪自身写入，但不会接受保存期间的其他编辑。异步业务结束后不要直接写旧快照或其他笔记。
- 正文按实际格式读取：plain 的 content、markdown 的 markdown。需要只支持部分格式时修改 supports(note)，不要猜字段或回退到派生文本。
- sdk.button 的工具栏入口在真实界面中是“更多笔记操作”里的 menuitem，不是单独可见的 button。菜单使用 aria-label 和 menuLabel，无 order 参数。
- 验收先 browser_open、browser_plugin({id:{{id:json}},enable:true})，然后 browser_scenario({id:"note-action-lifecycle",parameters:{pluginId:{{id:json}},actionLabel:{{actionLabel:json}}}})。该场景要求全新空实例，默认创建普通笔记，可用 formatName 指定支持的格式。
- 公共场景只验证无选择禁用、创建/切换后的可用性、停用移除、重新启用唯一入口和刷新恢复。结束时菜单已关闭、选中第一篇测试笔记，当前标题和控件由 snapshot 返回。打开“更多笔记操作”，点击 actionLabel 对应的 menuitem 并验证业务结果，例如剪贴板或持久化正文；公共场景未验证业务效果。最后 browser_finish。
- 业务功能和失败分支应补定向测试。无需重写 client.js 接入层或清单；公共场景/骨架成功不代表功能已完成。
