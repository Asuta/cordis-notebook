# 灵感画布应用

应用 ID：studio。用户与当前工作台 Agent 操作同一张画板，组织文字、图片、视频及生成卡片。只有明确发起生成才会提交请求，连线只是输入关系。

先用 app_list_tools 发现工具，再 app_call。studio_read 返回当前画板、revision、卡片、连线、素材、任务和 dirty。修改使用 studio_edit，生成使用 studio_generate；均须传刚读取的 revision。用户正在编辑或版本冲突时重新读取，不修改底层 JSON 绕过保护。

卡片类型从 studio_read.types 发现：text（text 内容）、image/video（已存在 assetId）、generator。坐标 x/y 为无限画布坐标；生成卡片内容较多，应留足空间。id 使用 UUID。text/image/video 可连接到 generator，成功后增加独立 image/video 结果卡片，也可继续作为其他生成卡片的参考。连线数组顺序决定文字组合顺序，可用 reorder 调整；媒体还有下述统一顺序。

studio_edit 的 operations 支持 add、update、remove、connect、disconnect、reorder、rename；变更自动保存、进入当前页面撤销历史。一次批量操作原子提交，保留用户未要求删除的卡片和连线。先新建图片节点，再通过 connect 接到生成卡片。

studio_import_image 保留旧工具名，支持用户指定的本机 PNG/JPEG/WebP 图片（20 MB）和 MP4/WebM 视频（200 MB），返回素材 id、kind 及尺寸等。导入后重新读取，使用对应 image/video 类型加入画布，或作为卡片内参考。旧素材没有 kind 时按图片处理。studio_inspect_image 仅返回图片预览，不能用它检查视频内容，也不能只根据文件名或提示词声称看过图。不要读取任何提供者的私有配置文件或输出 Key。

生成卡片可选择 provider。Pixel 保留 prompt、ratio、resolution：1k/2k/4k 为目标长边，按 64 像素对齐；比例 1:1、4:3、3:4、16:9、9:16、3:2、2:3，最多 8 张图片参考，不支持视频参考。

WaveSpeed 使用 provider="wavespeed"、model=完整模型 ID。先在 studio_read.actions 发现操作，再用 studio_action 调用 models（query、kind=image/video、type、offset）搜索整个图片/视频目录；model（model=完整 ID）读取真实 schema、fields、mediaFields、defaults 和 supported。不能猜测模型 ID、参数名或必填素材；supported=false 时说明原因并选择可用模型。prompt 保存在卡片 prompt 字段，其他参数保存在 modelParameters["wavespeed:完整模型ID"]，按各模型定义填写；切换模型时保留其他模型的参数。

卡片内参考用 references=[{id,assetId}]，连线参考来自 image/video 卡片。referenceOrder=["direct:参考id","edge:连线id"] 共同排序两种来源；未列出的素材会按初始顺序追加。按 model.mediaFields 的 path 写入 referenceBindings["wavespeed:完整模型ID"]，例如 {"edge:连线id":"/start_image","direct:参考id":"/end_image"}。只有一个匹配输入位置时可自动分配；有首尾帧、蒙版等多个位置时必须明确绑定。每份素材都要被模型使用，超限或不支持时先调整，不能静默丢弃参考。

studio_generate 只启动指定节点，立即返回任务 ID；queued/running 不是成功。用 studio_jobs 查询状态，不要因等待而再次提交。图片、视频及多份输出自动保存为独立结果卡片，重新生成保留旧结果。任务固定保存服务、模型、实际参数、参考顺序、绑定和远端任务 ID。并发 2 项，最多 20 项未结束任务。

只有用户明确要求生成时才调用，改文字、连线不代表发起生成。WaveSpeed 的 studio_cancel 暂停本地查询，远端可能仍生成并计费；paused 且有 remote.taskId 时通过 studio_action resume{jobId} 继续查询同一任务，不重新 POST。应用或服务重启后会恢复之前未结束且有 ID 的查询，账户必须与原任务一致。uncertain 表示 POST 已发出但没有确认 ID，必须先核对远端记录，不能自动重试；确认后才可用 detach{jobId} 结束本地跟踪再生成。Pixel 中断后不会自动重试。验收用隔离数据和模拟接口；未经用户授权不做真实付费生成。

## 插件开发快速入口

优先按启动目录调用 workspace_development_info：菜单动作选 task="studio-action"，新卡片选 "studio-card"，新生成服务选 "studio-provider"，Agent 扩展操作选 "studio-agent-action"，已有卡片和侧栏增强选 "studio-extension"。五条路径提供模板、参数、完整示例和公共验收场景；通过返回的 recommendedScaffold 生成默认停用的插件。具体指南见 development/README.md。

生成服务的 HTTP 提交/轮询/恢复、模型目录和动态参数选 task="studio-provider-advanced"；可组合设置和私有持久化选 "studio-settings"。两者是复用 studio-provider 的配方，不能把 task ID 当作 template。骨架附带 advanced/ 与 settings/ 清单，按 README 切换入口并重新构建；组合已有插件时合并依赖及入口。进阶配方带本机 HTTP mock，设置只公开地址、hasKey 和 revision，不向前端回传 Key。

生成服务契约可单独用 capability="server:imageGeneration" 展开。provider 模板默认输出固定 PNG，标为本地模拟；公共 provider 场景不会生成。菜单公共场景不点击未知业务，rename-sample 仅用于默认重命名示例。Agent 专用的发现、参数和 revision 行为仍须额外测试。业务通过公开服务注册，客户端模板的 mutation.js 已处理异步期间的新编辑、切板及停用保护，避免绕开它直接写回。

通用流程见 `docs/插件开发导航.md` 和 `docs/灵感画布插件设计.md`。画布插件按注册接口扩展卡片、视图、图片服务或 Agent 操作；先看 `plugins/canvas/`、`plugins/canvas-ui/` 和目标能力最接近的插件清单，不要把 notebook 的编辑器、布局或存储服务带入本应用。涉及图片服务时区分纯 UI、模拟请求和真实生成，测试报告要分别说明范围。

开发模式下用 `workspace_status` 确认新增插件或源码的实际热更新，再用 `workspace_test` 验证；正式构建和浏览器验收分别报告，不能互相替代。
