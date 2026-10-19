# 可组合的设置与持久化配方

workspace_development_info({task:'studio-settings'}) 直接返回三个 settings-*.js 和清单示例，可组合到菜单、卡片、界面扩展或生成服务，不新增业务模板。studio-provider 已附带这些文件；已有其他插件时将三个文件复制到插件根，把参数化的 id/name 换成该插件的安全字符串常量。不要跨插件导入内部文件。

## 接入清单

settings/package.json 是独立设置插件示例。组合已有插件时合并 requires.client 的 canvasUI 和 requires.server 的 http，保留原有业务依赖；在现有 client 入口 import settingsClient from './settings-client.js' 并调用 settingsClient(ctx, sdk)。在 server 入口调用 createSettings(runtime.dataDir, runtime.writeSnapshot) 和 mountSettings(ctx, config)，或调用 settings-server.js 的默认入口。新增前后端时参照示例合并 build/client/public/server 声明。不要用示例清单覆盖已有业务。

只需要独立设置插件时，可先生成 studio-provider，再用附带的 settings/package.json 覆盖根 package.json，两个构建入口即切换到设置示例，不再注册生成服务。运行 pnpm test:plugin --app studio --plugin {{id}}、pnpm build studio，再通过 workspace_status 确认清单和源码的热更新。

## 持久化与公开边界

settings-store.js 使用插件自己的 runtime.dataDir/settings-private.json 与宿主 writeSnapshot，串行原子保存。revision 检查避免两个窗口相互覆盖；写入失败不更新内存；损坏文件保持原样并报错，不能自动重置。配置字段严格校验，空 Key 保留旧值，clearKey=true 明确删除；公开响应只有 baseUrl、hasKey、revision，不包含密钥。私有文件是本机明文配置，需随插件数据备份；不要加入 public 构建资源、画板、任务日志或 Agent 工具输出。

settings-server.js 通过 owner 注册 GET/POST /api/studio/<插件ID>/settings，沿用宿主应用会话保护。保存后的附属刷新失败用 warning 单独返回。设置可供服务端业务通过 config.private() 读取快照，禁止由前端调用该私有接口。

settings-client.js 注册 canvasUI.settings，展示在统一“应用设置”内，复用画布的 studio-app-settings-field/actions/status 样式，字段带可见标签和独立的可访问名称。请求期间禁用输入；保留未保存输入，重开面板不覆盖草稿；“重新读取”明确丢弃未保存输入。保存不重复提交，失败保留地址/清除选项并清空临时 Key；停用时清空 Key，迟到响应不会更新已卸载面板。SDK request 当前不提供 AbortSignal 参数，因此这里使迟到响应失效，不声称撤销服务端已经提交的保存。

## 验收

settings.test.js 验证公开信息不含 Key、重启持久化、并发版本冲突、清除 Key、写入失败与损坏文件保留。settings-lifecycle 公共场景只验证设置区块停用/恢复，不修改未知插件配置；settings-sample 仅用于本配方默认字段，在独立实例中保存本地示例地址和虚拟 Key，刷新后验证，再清除 Key。业务字段变更后补专属场景。生成服务进阶示例已组合本配方，可参考 advanced/server.js。
