# 生成服务模板

默认仅返回固定 1×1 PNG，无网络、无密钥、无计费，分辨率声明为 sample，名称自动标注“本地模拟”。server.js 负责 owner 注册，provider.js 是独立的生成服务实现。生成卡片选择本服务、比例 1:1、分辨率 sample，填写提示词后才能手动生成。

接入真实服务时：prepare 同步校验所有参数、参考和模型并冻结输入及私有配置；generate(media, signal, context) 内进行网络操作，必须传 signal；返回 Buffer 或 [{bytes,kind,name}]。public/parameters/bindings 和日志不放密钥。私有配置由本插件服务端管理，不能从其他提供者抄取账户配置。

有远端任务时再实现 checkpoint/resume：提交前保存 submitting，获取 ID 后先保存 submitted/taskId/account，再轮询。resume 只查询同一个任务，不能重新 POST。此模拟模板没有声明恢复能力。扩大参数或参考支持时同步 public、prepare 和测试，不要静默忽略未支持的输入。

公共 provider-lifecycle 场景只检查服务可选、停启和选择保留，不点击生成；任务输出和取消需独立测试。真实请求只能在用户明确授权后进行，模拟验收不能冒充真实服务验收。

## 开发和验收

骨架同时附带两套可运行配方。task=studio-provider-advanced 返回 advanced/ 的 HTTP 提交、轮询、模型目录与恢复示例，以及共用的 settings-*.js；按 advanced/README.md 切换到 advanced/package.json。task=studio-settings 返回可组合设置与私有持久化配方；只需要设置演示时按 settings/README.md 切换到 settings/package.json。默认清单仍运行无网络的基础模拟，切换清单后需重新构建并核对热更新。不要把配方 task ID 传给脚手架，两者都复用 studio-provider 模板。

通过 workspace_scaffold_plugin 生成后默认停用。先实现业务，再运行：

`pnpm test:plugin --app studio --plugin {{id}}`

开发模式用 workspace_status 检查热更新，启用并核对依赖及运行状态。浏览器在独立数据实例中 browser_open → browser_plugin({id:'{{id}}',enable:true}) → browser_scenario（参数见 workspace_development_info 返回）→ 业务差异验证 → browser_finish。分别报告构建、单元/集成测试、公共浏览器场景与未覆盖部分。
