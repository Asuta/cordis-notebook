# 文本编辑格式

此骨架已接好双端格式注册、editorHost、notebook.edit 自动保存和 owner 释放。
按需求修改 format.js 的字段规则、client.js 的编辑行为；无需重写构建清单。
test/format.test.js 覆盖格式规范化，不代表保存与生命周期已经通过浏览器验收。

验证：workspace_test({plugins:[{{id:json}}]})。
工作台启用：workspace_enable_plugin({id:{{id:json}}})。
独立浏览器：browser_open → browser_plugin({id:{{id:json}},enable:true}) →
browser_scenario({id:"note-editor-lifecycle",parameters:{pluginId:{{id:json}},formatName:{{name:json}},editorLabel:{{editorLabel:json}}}})。
场景覆盖公共创建、切换、刷新、空正文、启停与再编辑；按本次业务差异补断言，最后 browser_finish。
