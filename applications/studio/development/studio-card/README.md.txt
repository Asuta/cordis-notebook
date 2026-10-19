# 新卡片模板

card.js 共用类型 ID、label、默认正文和权威校验；server.js 向 canvasDocuments.types 注册，client.js 向 canvasUI 注册视图和菜单。body 是专属字段，id/type/title/x/y 等公共字段不能覆盖声明。更换字段时同步 defaults/validate/resolve/render 和测试。

内容输入使用 view.field 接入草稿、自动保存和冲突保护，单独设置可访问名称；不要自行直接写 DOM 或持久化文件。output='text'、resolve 返回文字，允许连接到生成卡片；连线本身不会开始生成。新增卡片操作通过 mutation.js 提交并进入撤销历史。

停用后专属字段和连线仍保留，界面显示占位；重新启用后恢复编辑。公共场景在空实例中创建一张卡片，填写、保存、撤销、重做、刷新、停用和恢复；如改变字段/输入名称，同时调整场景参数或补充业务测试。

## 开发和验收

通过 workspace_scaffold_plugin 生成后默认停用。先实现业务，再运行：

`pnpm test:plugin --app studio --plugin {{id}}`

开发模式用 workspace_status 检查热更新，启用并核对依赖及运行状态。浏览器在独立数据实例中 browser_open → browser_plugin({id:'{{id}}',enable:true}) → browser_scenario（参数见 workspace_development_info 返回）→ 业务差异验证 → browser_finish。分别报告构建、单元/集成测试、公共浏览器场景与未覆盖部分。
