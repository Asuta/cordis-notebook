# 叙事引擎角色制作指南

此目录由角色工作室复制到当前作品的数据目录。tools/ 是固定版本的 Mesh Avatar Studio 工具，projects/ 保存当前作品的独立角色工程；不要编辑 vendor 或其他作品的工程。

1. 先检查原图尺寸、透明背景、正面姿势和五官可见性。从新图开始时使用 tools/new-project.py <原图.png> <新名称>；已有目标必须换一个未占用名称。脚本创建的是待标注草稿，不是完成的模型。
2. 打开 projects/<名称>/source.png，核对图像像素坐标。逐项标注头部、眼睛开口、嘴部、脸部、头发和饰品；不要直接沿用 Miko 的坐标。将完成的绑定保存为 rig.json。
3. 用 uv run --no-project --no-python-downloads --python ">=3.10,<3.14" --with numpy --with pillow --with opencv-python-headless tools/build-layers.py projects/<名称> 构建图层。工具路径和工程路径均相对本文档上一级目录。
4. 在角色工作室中打开工程，检查原图控制点与实际五官是否对齐，使用左右转头、抬头低头和倾斜滑块检查。编程助手修改绑定前先 narrative_mesh_read 取得 localVersion，修改后用 narrative_mesh_check 检查结构。
5. 修改会影响分层的轮廓后，使用编辑器“保存并重建分层”或 narrative_mesh_rebuild。目视检查闭眼、张嘴、极限角度及发饰边缘；结构校验不代表视觉质量。
6. 需要眼嘴差分时先运行 tools/variant-requests.py projects/<名称>，查看生成的请求和蒙版。遵循用户指定的生图工具和授权，保持原图尺寸和五官位置，将差分保存到工程 variants/，再运行 tools/build-sprites.py projects/<名称>。未得到生图任务时只说明缺少哪些差分。

在应用外准备的新工程，先用编辑器打开，再导出包含源文件的 .mavatar，通过外层“导入角色包”关联到叙事角色。保存并用于游戏后，在舞台布景选择该角色。完整作品包会保留 source.png、rig.json、built/ 和 variants/，可以继续编辑和重新构建。

已有角色的 Agent 操作链为 narrative_mesh_open → narrative_mesh_read → narrative_mesh_edit → narrative_mesh_preview/check → narrative_mesh_save。所有路径应来自当前编辑器实际显示的工程目录，不能从别的应用直接引用实现或数据。
