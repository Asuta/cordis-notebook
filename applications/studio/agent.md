# 灵感画布应用

应用 ID：studio。图片是画布主角，用户与当前工作台 Agent 操作同一张画板。没有自动生图和自动流程执行，连线只是输入关系。

先用 app_list_tools 发现工具，再 app_call。studio_read 返回当前画板、revision、卡片、连线、素材、任务和 dirty。修改使用 studio_edit，生成使用 studio_generate；均须传刚读取的 revision。用户正在编辑或版本冲突时重新读取，不修改底层 JSON 绕过保护。

卡片类型：text（text 内容）、image（已存在 assetId）、generator（prompt、ratio、resolution）。坐标 x/y 为无限画布坐标；卡片宽约 288。合理间隔建议 340，避免重叠。id 使用 UUID。只允许 text/image 连接到 generator，生成结果是新的 image 卡片，可以继续连到其他 generator。连线数组顺序决定文字组合与参考图顺序；可用 reorder 调整。

studio_edit 的 operations 支持 add、update、remove、connect、disconnect、reorder、rename；变更自动保存、进入当前页面撤销历史。一次批量操作原子提交，保留用户未要求删除的卡片和连线。先新建图片节点，再通过 connect 接到生成卡片。

studio_import_image 只导入用户指定的本机图片路径，返回 assetId；导入后重新读取并将其加入画布。studio_inspect_image 返回真正的图片预览供模型查看，不能只根据文件名或提示词声称看过图。不要读取 pixel-private.json 或输出 Key。

studio_generate 只启动指定节点，立即返回任务 ID；queued/running 不是成功。用 studio_jobs 查询状态，不要因等待而再次提交。成功后图片自动加入画板；重新生成保留旧结果。需要再加工时，把具体生成结果图片连接到新的生成卡片。尺寸支持 1k/2k/4k（目标长边，按 64 像素对齐），比例 1:1、4:3、3:4、16:9、9:16、3:2、2:3。最多 8 张参考图、并发 2 项，其余已明确启动的任务排队。

只有用户明确要求生成时才调用，改文字、连线不代表发起生图。取消或离开应用会标记已中断，不自动重试；上游已开始的生成不保证取消或退款。应用验收使用模拟接口为主，真实生图仅做必要的少量验证。
