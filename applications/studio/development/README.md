# 灵感画布插件开发路径

| 开发需求 | task | 推荐 template | 业务入口 | 公共验收 |
| --- | --- | --- | --- | --- |
| 菜单动作 | studio-action | studio-action | action.js 返回原子 operations | menu-lifecycle；默认示例另跑 rename-sample |
| 新卡片 | studio-card | studio-card | card.js 数据定义、client.js 视图 | card-lifecycle |
| 新生成服务 | studio-provider | studio-provider | provider.js 的 prepare/generate | provider-lifecycle（不生成） |
| Agent 扩展操作 | studio-agent-action | studio-agent-action | action.js 参数与 operations | menu-lifecycle；默认示例另跑 rename-sample |
| 已有卡片与界面增强 | studio-extension | studio-extension | extension.js 信息、client.js 卡片按钮与侧栏 | extension-lifecycle |
| 生成服务进阶配方 | studio-provider-advanced | studio-provider | advanced/ 目录、HTTP 提交/轮询/恢复与设置 | provider-lifecycle、settings-lifecycle；另验生成结果 |
| 设置与持久化配方 | studio-settings | studio-provider（独立演示） | settings-*.js，可组合到其他插件 | settings-lifecycle；默认配方另跑 settings-sample |

先 workspace_development_info({task:'studio-card'})，再使用返回的 recommendedScaffold。五个模板和两个配方任务提供清单、源码、README 和可执行测试；task 是资料入口，template 是可生成骨架，两个配方都复用 studio-provider，不要把配方 task ID 作为 template。模板正文中的 {{...:json}} 是脚手架参数，生成后为安全转义的 JS/JSON 字符串；不要手工替换清单。

生成 studio-provider 后默认运行无网络模拟；进阶示例在生成插件目录执行 Copy-Item -LiteralPath advanced/package.json -Destination package.json，独立设置示例使用 settings/package.json，随后重新构建并核对 workspace_status。已有插件添加设置时按 recipes/settings/README.md.txt 合并依赖和入口。进阶配方带本机 HTTP mock，无需真实服务 Key；恢复应用时保持 mock 运行。

shared/mutation.js.txt 是三类客户端模板的共同源，脚手架将它复制进各插件，运行时没有跨插件相对路径依赖。它锁定目标画板、阻止重复调用，并在异步工作前后检查版本和生命周期；一次事务保留撤销历史。改变副作用逻辑时补充对应测试。

公共场景由本应用维护，使用工作台 browser_scenario 记录步骤、断言和场景 hash。menu-lifecycle 不执行未知业务；rename-sample 仅适用于模板默认重命名业务；card-lifecycle 需要空画板和一个支持正文的卡片；provider-lifecycle 只选择目标服务并检查停用恢复，不提交生成。extension-lifecycle 在空画板创建文字卡并检查按钮及侧栏停启，settings-lifecycle 只检查设置区块，settings-sample 会写入并清除虚拟 Key，只在独立默认配方中运行。新业务应补充自己的结果断言。

生成服务的公开契约可通过 workspace_development_info({capability:'server:imageGeneration'}) 单独展开。本地模拟验证队列、资产和结果卡片；进阶配方用本机 HTTP 验证动态参数、任务 ID 持久化、恢复不重提和未知提交状态。接入真实服务时仍需按厂商协议补测。
