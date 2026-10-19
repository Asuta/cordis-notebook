# 菜单动作模板

业务入口是 action.js 的 run({board, signal})，默认重命名当前画板。client.js 负责注册菜单，mutation.js 负责 flush、单次执行、异步写回前检查和原子保存。只修改业务计算；不要从 run 直接调用 session.edit 或其他插件内部实现。

返回非空 CanvasOperation[]，一次提交进入撤销历史。需要网络时传 signal；切板、停用、未保存草稿或版本变化会拒绝迟到的写回。已经提交到服务端的事务不会因随后停用而撤销。

参数 actionLabel 为入口名称，boardTitle 为示例标题。使用 canvasUI 的 order 排序与现有按钮样式；此模板不依赖文字卡片插件。

## 开发和验收

通过 workspace_scaffold_plugin 生成后默认停用。先实现业务，再运行：

`pnpm test:plugin --app studio --plugin {{id}}`

开发模式用 workspace_status 检查热更新，启用并核对依赖及运行状态。浏览器在独立数据实例中 browser_open → browser_plugin({id:'{{id}}',enable:true}) → browser_scenario（参数见 workspace_development_info 返回）→ 业务差异验证 → browser_finish。分别报告构建、单元/集成测试、公共浏览器场景与未覆盖部分。
