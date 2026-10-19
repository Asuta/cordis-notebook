# 生成服务进阶配方

workspace_development_info({task:'studio-provider-advanced'}) 返回本配方；推荐脚手架仍是 studio-provider。基础骨架已经附带 advanced/、settings-* 和测试。默认仍使用无网络的 provider.js。

## 启用完整 HTTP 示例

在生成插件目录执行 Copy-Item -LiteralPath advanced/package.json -Destination package.json，切换到 advanced/server.js 与 settings-client.js 两个构建入口；插件 ID 不变。然后从仓库根运行 pnpm test:plugin --app studio --plugin {{id}} 和 pnpm build studio。开发模式也须用 workspace_status 核对清单热更新，再启用插件。

独立终端在插件目录运行 node advanced/mock-server.js；它只绑定 127.0.0.1，打印随机端口和固定测试 Key，不访问外网。打开画布应用设置，将接口地址和测试 Key 保存到本插件设置区。创建生成卡片，选择本插件、sample-image 模型、填写提示词与 steps，再点击生成。成功输出固定 1×1 PNG。稳定调试可传指定空闲端口：node advanced/mock-server.js 45678。mock 的任务存在内存中，测试应用重启恢复时需保持 mock 进程运行；重启 mock 会丢失模拟远端任务，即使端口和 Key 相同也无法恢复。

## 替换真实服务的位置

catalog.js 提供可搜索、分页的模型目录和动态 steps 参数，prepareInput 在服务端再次校验。transport.js 的 POST /tasks 与 GET /tasks/:id 是本示例约定，不代表任何厂商协议；接厂商时替换 URL、请求体、状态和输出解析，同时更新目录、能力声明和测试。此示例明确不支持参考素材或视频；需要时必须实现上传/绑定和真实输出验证，再声明支持。

prepare 同步校验并冻结输入和私有配置。submitting 必须在 POST 前持久化，submitted/taskId/account 必须在首次 GET 前持久化。POST 开始后不因本地暂停丢弃迟到的 ID，但受 15 秒超时约束；停用最多等待该提交结束。轮询响应 AbortSignal，超时或网络错误保留原 ID 以便恢复。resume 只 GET 原任务并校验原账户；uncertain 没有确认 ID 时不得自动 POST。任务错误不回显上游响应、地址或 Key。

密钥只在 settings-store.js 的私有快照中。settings-server.js 的公开响应只含 baseUrl、hasKey、revision；修改配置只影响新任务，原任务闭包保留原账户。设置保存后调用 imageGeneration.recover，仅恢复宿主标记为可自动恢复的任务。

## 验收范围

随附 advanced.test.js 用真实本机 HTTP 验证目录/参数、输入快照、先保存任务 ID 再查询、取消、恢复不重提、缺 ID 和失败。仓库集成测试还验证实际任务队列的 paused/uncertain 和重启恢复。公共 provider-lifecycle 只检查入口，不发请求；真实供应商、网络代理、视频/多输出需补对应验收。真实服务 Key 和付费生成不属于本地示例验收。
