---
name: funtoken-image2
description: Generate or edit raster images through the user's FUN Token (token.fun.tv) Image2 endpoints using a bundled local Node script. Defaults to gpt-image-2.5-sunburst with flare as the alternate style variant, and also routes qwen-image / wan / doubao-seedream models. Use when the user explicitly asks for FUN Token, $funtoken-image2, token.fun.tv image generation, or wants the FUN provider for text-to-image and reference-image edits.
---

# FUN Token Image2

用 **token.fun.tv** 作为 Image2 供应商独立出图。工作流参照 `ai-pixel-image2`，但端点行为按本地实测修正，有几处和 AI Pixel **不一样**，踩错会静默拿到"没参考图"的结果。

- 文生图：`POST https://token.fun.tv/v1/images/generations`（JSON）
- 参考图改图：`POST https://token.fun.tv/v1/images/edits`（multipart，重复 `image` 字段）
- 火山 SeedDream：`POST https://token.fun.tv/v1/volc/images/generations`

默认模型 **`gpt-image-2.5-sunburst`**；需要另一个风格变体时用 `--model flare`（= `gpt-image-2.5-flare`）。
本项目内的技能位于 `.agents/skills/funtoken-image2/`，脚本路径为
`.agents/skills/funtoken-image2/scripts/generate-image.mjs`。以下命令都从项目根目录执行。

## Quick Start

单张文生图：

```powershell
node .agents/skills/funtoken-image2/scripts/generate-image.mjs --prompt "一只可爱的小狗，写实摄影，无文字无水印。" --quality medium --out-dir output/funtoken
```

参考图改图：

```powershell
node .agents/skills/funtoken-image2/scripts/generate-image.mjs --prompt "把图中的猫换成哈士奇，保留窗台和樱花背景、光线不变。" --reference C:\path\to\ref.png --out-dir output/funtoken
```

换用 flare 变体：

```powershell
node .agents/skills/funtoken-image2/scripts/generate-image.mjs --prompt "赛博朋克城市夜景" --model flare --aspect-ratio 9:16
```

JSON 参数：

```json
{
  "prompt": "一只可爱的小狗，写实摄影，无文字无水印。",
  "model": "sunburst",
  "quality": "medium",
  "aspectRatio": "1:1",
  "resolution": "1k",
  "referenceImagePaths": [],
  "outDir": "output/funtoken"
}
```

## Workflow

1. 参考图来自 Codex 聊天附件时，先用 `codex-thread-images` 落成本地文件路径；在工作台中，聊天图片不保证有本地路径，改图时请使用本机文件路径或先把图片保存到项目目录。
2. 简单请求用 CLI flag，复杂请求用 `--json args.json`。首次使用或怀疑配置失效时先运行 `--check-config`。
3. 模型选择：**默认 sunburst**；要切换另一个风格变体时用 `--model flare`。两者参考图能力、画质差异很小，实测均约 22–27s，主要按风格偏好挑。
4. shell 超时给 5–10 分钟。`gpt-image-2-bd-edits` 实测可到 90s 以上，别用短超时。
5. 读 stdout 的 `filePath`、`model`、`request.endpoint`、`request.referenceImageCount`、`request.imageSource`、`actualSize`。
6. 用 `filePath` 存在性 + 看图双重校验。
7. 展示时用正斜杠绝对路径的 Markdown 图片语法。

## Arguments

- `prompt` 必填。
- `model` 默认 `gpt-image-2.5-sunburst`。支持别名：`flare`、`sunburst`、`image2`、`bd`、`ms`、`seedream`、`qwen`，也可直接传完整模型名。
- `quality` 可选 `low` / `medium` / `high`，透传给服务端；服务端可能忽略。
- `aspectRatio` 可选 `1:1`、`3:2`、`2:3`、`16:9`、`9:16` 等，映射为 size。
- `resolution` 覆盖尺寸：`1k`→1024x1024，`2k`→2048x2048，`4k`→4096x4096，或显式 `2048x2048`。优先级高于 `aspectRatio`。
- `referenceImagePaths` 本地图片路径数组。
- `referenceImages` data URL 或 HTTP(S) 图片 URL 数组。
- `seed` 随机种子，部分模型支持。
- `outDir` 默认 `output/funtoken`。
- `outputFormat` 默认跟随上游。
- `--check-config` 只输出密钥是否存在、来源、端点和默认模型，不发送请求。

## 与 AI Pixel 的关键差异（实测）

| 行为 | AI Pixel | token.fun.tv |
|---|---|---|
| edits 字段名 | `image[]` | **`image`**（重复 append） |
| generations 传参考图 | 可能 200 但忽略参考图 | **HTTP 400 `Unknown parameter: 'image'`** |
| 返回格式 | b64_json | gpt-image 系 b64_json；**阿里/火山系 http 外链** |
| size 是否被遵循 | 较接近 | **不严格**，请求 1024x1024 可能返回 1536x1024 |

脚本已内置三条兜底：edits 用 `image`、外链自动下载、SeedDream 像素下限自动抬升。

## 可用模型（实测）

| 模型 | 端点 | 返回 | 备注 |
|---|---|---|---|
| `gpt-image-2.5-sunburst` | generations / edits | b64 PNG | **默认**，约 20–27s |
| `gpt-image-2.5-flare` | generations / edits | b64 PNG | 风格变体，约 20–25s |
| `gpt-image-2` | generations / edits | b64 PNG | 约 23s |
| `gpt-image-2-bd` | generations / edits | b64 PNG | 较慢 |
| `gpt-image-2-ms` | generations / edits | b64 PNG | 约 24s |
| `gpt-image-2-bd-edits` | edits | b64 PNG | 慢，90s+ |
| `qwen-image-2.0` | generations | http 外链 | 快，约 4–6s |
| `qwen-image-2.0-pro` | generations | http 外链 | 约 11s |
| `wan2.6-t2i` | generations | http 外链 | 约 7s |
| `doubao-seedream-4-0-250828` | volc/generations | http 外链 | 约 11s |
| `doubao-seedream-4-5-251128` | volc/generations | http 外链 | 约 7s |
| `doubao-seedream-5-0-lite-260128` | volc/generations | http 外链 | 需 ≥ 3686400 像素 |

不可用（会返回 503 无渠道或 400）：`doubao-seedream-3-0-t2i-250415`、`qwen-image-edit-plus`、`wan2.7-image`、`wan2.7-image-pro`。

注意：`/v1/models` 只登记了 6 个 `gpt-image-*`，上面其余模型**不在列表里但仍可调用**，别以 `/v1/models` 为准。

## 已知限制

- `size` 不被严格遵守，以 stdout 的 `actualSize` 为准。
- `gpt-image-2.5-*` 的参考图只验证过 **1 张**；多张 `--reference` 的权重与顺序未验证。
- `response_format=url` 在 gpt-image 系上是 `data:image/png;base64,...` 内联数据，不是外链，别指望能存链接。
- SeedDream 下限：`1024x1024` 只有 1M 像素会报 `image size must be at least 3686400 pixels`，脚本会自动抬到 `2048x2048` 并写进 `request.note`。

## 批量并发生成

```powershell
$script = "C:\Users\fun\.dsh\skills\funtoken-image2\scripts\generate-image.mjs"
$cwd = (Get-Location).Path

$job1 = Start-Job -ScriptBlock {
  Set-Location $using:cwd
  node $using:script --prompt "阳光厨房里的小狗，写实摄影，无文字无水印。" --out-dir output/funtoken
}

$job2 = Start-Job -ScriptBlock {
  Set-Location $using:cwd
  node $using:script --prompt "柔软地毯上玩耍的小狗，写实摄影，无文字无水印。" --out-dir output/funtoken
}

$jobs = @($job1, $job2)
$jobs | Wait-Job | Out-Null
$jobs | ForEach-Object { Receive-Job $_ -Keep }
$jobs | Remove-Job
```

每个 `Start-Job` 独立赋值，并在内部 `Set-Location $using:cwd`。

## Windows 代理说明

token.fun.tv 在本地是**直连可用**的，默认不需要代理参数。但若出现裸 `fetch failed`：

1. 先用 `curl.exe -I https://token.fun.tv` 确认网络可达；
2. 再在 `node` 命令上加 `--use-env-proxy` 重跑（Node 的 `fetch` 默认不读 `HTTP_PROXY`/`HTTPS_PROXY`）；
3. 往 `Start-Job` 里放时，`--use-env-proxy` 必须写在子任务的 `node` 上。

诊断时只打印代理变量名，不要打印变量值和 API key。

## Environment

配置读取顺序：进程环境变量 → 本技能目录的 `local.config.toml` → `~/.codex/config.toml` → `~/.dsh/config.toml` 的 `[skills.funtoken-image2.env]`。
本项目已经把密钥写入 `.agents/skills/funtoken-image2/local.config.toml`；该文件被 Git 忽略，不要读取、展示或提交它。

```toml
[skills.funtoken-image2.env]
FUN_TOKEN_API_KEY = "..."
FUN_TOKEN_API_BASE_URL = "https://token.fun.tv"
FUN_TOKEN_IMAGE_MODEL = "gpt-image-2.5-sunburst"
FUN_TOKEN_IMAGE_TIMEOUT_MS = "600000"
```

也兼容 `FUN_API_KEY` 作为 key 的备用变量名。

密钥不要打印。失败时只报告端点、HTTP 状态和脱敏后的上游错误。
