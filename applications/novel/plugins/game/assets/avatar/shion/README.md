# 汐音 · 月下听潮

- 生成日期：2026-11-12。
- 生成工具：funtoken-image2；模型：gpt-image-2.5-sunburst。
- 设计：银紫长发、青绿色眼睛、青玉月牙发饰、白青配色中式服装。
- 成品：source.png，1024 × 1536，RGBA 真透明背景。
- 默认姿势：正面站立、头部端正、双臂自然垂放，与参考角色的托脸姿势不同。
- 已完成独立 Mesh Avatar 绑定与游戏示例：呼吸、眨眼、视线、转头、俯仰、歪头、口型、双臂与发丝/丝绦物理。
- `rig.json` 是按这张新图重新标注的绑定；没有沿用 Miko 的托脸手部绑定。
- `variants/` 保留全尺寸眼型与口型：闭眼、半睁眼、笑眼、A / I / O 及中间口型。局部使用 funtoken-image2 补画，经特征对齐后只合成眼嘴蒙版内的像素；中间口型从 A 口型派生。
- `built/` 是上游分层与表情工具的构建产物，可在 Mesh Avatar Studio 继续编辑，随作品包导入导出。
- 重建：在仓库根运行 `uv run applications/novel/plugins/game/scripts/build-shion.py`。试玩和编辑无需再次生图。

画风参考来自项目内的 Mesh Avatar Studio Miko 示例，汐音为独立生成的新角色，与原作者没有官方关联：
mesh-avatar/vendor/samples/miko-qipao/source.png。
参考角色署名：© Yuki Shindo (AITuber OnAir)。
参考素材说明见 mesh-avatar/vendor/samples/miko-qipao/MIKO_ASSET_TERMS.md。

生成提示词、原始生成图片与抠像过程保存在本工作树的
work/character-design/shion-v2/。
