#!/usr/bin/env node

/**
 * FUN Token Image2 —— token.fun.tv 生图/改图脚本
 *
 * 与 ai-pixel-image2 的差异（均为本地实测结论）：
 *   1. edits 端点用重复的 `image` 字段，不是 `image[]`
 *   2. generations 若传 `image` 会报 Unknown parameter，参考图只能走 edits
 *   3. 阿里 / 火山系列返回 http 外链而非 b64，需要额外下载
 *   4. 火山 SeedDream 走 /v1/volc/images/generations，且 5.0-lite 要求 >= 3686400 像素
 *   5. gpt-image 系列不严格遵循 size，实际尺寸以响应 size 为准
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE = "https://token.fun.tv";
const DEFAULT_MODEL = "gpt-image-2.5-sunburst";
const SEEDREAM_MIN_PIXELS = 3686400;
const SKILL_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL_CONFIG = path.join(SKILL_ROOT, "local.config.toml");

const MODEL_ALIASES = {
  flare: "gpt-image-2.5-flare",
  sunburst: "gpt-image-2.5-sunburst",
  image2: "gpt-image-2",
  image25: "gpt-image-2.5-flare",
  bd: "gpt-image-2-bd",
  ms: "gpt-image-2-ms",
  seedream: "doubao-seedream-4-5-251128",
  qwen: "qwen-image-2.0",
};

function parseCli(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--json":
        args.json = argv[++i];
        break;
      case "--prompt":
        args.prompt = argv[++i];
        break;
      case "--model":
        args.model = argv[++i];
        break;
      case "--quality":
        args.quality = argv[++i];
        break;
      case "--aspect-ratio":
        args.aspectRatio = argv[++i];
        break;
      case "--resolution":
        args.resolution = argv[++i];
        break;
      case "--seed":
        args.seed = argv[++i];
        break;
      case "--out-dir":
        args.outDir = argv[++i];
        break;
      case "--reference":
        args.referenceImagePaths = [...(args.referenceImagePaths || []), argv[++i]];
        break;
      case "--check-config":
        args.checkConfig = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    '  node generate-image.mjs --prompt "..." [--model sunburst|flare|<full-model>]',
    '  node generate-image.mjs --prompt "..." --reference C:\\path\\ref.png',
    "  node generate-image.mjs --json args.json",
    "",
    "Flags:",
    "  --prompt <text>          必填，图片描述",
    "  --model <name>           sunburst(默认) | flare | image2 | seedream | qwen | 完整模型名",
    "  --quality <level>        low | medium | high（透传，服务端可能忽略）",
    "  --aspect-ratio <ratio>   1:1 | 3:2 | 2:3 | 16:9 | 9:16 ...（映射为 size）",
    "  --resolution <r>         1k | 2k | 4k | 显式尺寸如 2048x2048（优先于 aspect-ratio）",
    "  --seed <int>             随机种子（部分模型支持）",
    "  --out-dir <dir>          默认 output/funtoken",
    "  --reference <path>       参考图，可重复；给了就走 /v1/images/edits",
    "  --check-config           只检查密钥和端点配置，不请求接口",
    "",
    "JSON fields: prompt, model, quality, aspectRatio, resolution, seed,",
    "             referenceImagePaths, referenceImages, outDir, outputFormat",
  ].join("\n");
}

/* ---------------- 配置 ---------------- */

function readTomlSection(configPath, sectionName) {
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch {
    return {};
  }
  const env = {};
  let inSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      inSection = line === `[${sectionName}]`;
      continue;
    }
    if (!inSection || !line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"(.*)"\s*$/);
    if (match) env[match[1]] = match[2].replace(/\\"/g, '"');
  }
  return env;
}

function loadSkillConfig() {
  const candidates = [
    { path: LOCAL_CONFIG, source: "project" },
    { path: path.join(os.homedir(), ".codex", "config.toml"), source: "codex" },
    { path: path.join(os.homedir(), ".dsh", "config.toml"), source: "dsh" },
  ];
  const env = {};
  let source = "none", configPath = "";
  for (const candidate of candidates) {
    if (!existsSync(candidate.path)) continue;
    const section = readTomlSection(candidate.path, "skills.funtoken-image2.env");
    const keys = Object.keys(section);
    if (keys.length === 0) continue;
    if (source === "none") { source = candidate.source; configPath = candidate.path; }
    for (const key of keys) {
      if (!(key in env)) env[key] = section[key];
    }
  }
  return { env, source, path: configPath };
}

function getEnv(name, fallback = {}) {
  return process.env[name] || fallback[name] || "";
}

/* ---------------- 参数归一 ---------------- */

function resolveModel(value) {
  const raw = String(value || DEFAULT_MODEL).trim();
  return MODEL_ALIASES[raw.toLowerCase()] || raw;
}

function mimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function extensionForFormat(format) {
  const normalized = String(format || "png").toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") return "jpg";
  if (["webp", "png", "gif"].includes(normalized)) return normalized;
  return "png";
}

function parseSize(size) {
  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(String(size || "").trim());
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function mapResolution(resolution) {
  const normalized = String(resolution || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "1k" || normalized === "1024") return "1024x1024";
  if (normalized === "2k" || normalized === "2048") return "2048x2048";
  if (normalized === "4k" || normalized === "4096") return "4096x4096";
  if (parseSize(normalized)) return normalized;
  throw new Error(`Unsupported resolution: ${resolution}. Use 1k / 2k / 4k / 2048x2048.`);
}

function mapAspectRatio(ratio) {
  switch (String(ratio || "").trim()) {
    case "1:1":
      return "1024x1024";
    case "3:2":
    case "4:3":
    case "16:9":
    case "21:9":
      return "1536x1024";
    case "2:3":
    case "3:4":
    case "9:16":
    case "9:21":
      return "1024x1536";
    default:
      return "";
  }
}

function resolveSize({ resolution, aspectRatio, model }) {
  let size = mapResolution(resolution) || mapAspectRatio(aspectRatio) || "1024x1024";
  let note = "";

  // 火山 SeedDream 有像素下限，不足时自动抬到 2048x2048
  if (/seedream/i.test(model)) {
    const parsed = parseSize(size);
    const pixels = parsed ? parsed.width * parsed.height : 0;
    if (pixels < SEEDREAM_MIN_PIXELS) {
      note = `size ${size} 低于 SeedDream 下限 ${SEEDREAM_MIN_PIXELS} px，已改用 2048x2048`;
      size = "2048x2048";
    }
  }
  return { size, note };
}

function pickEndpoint(base, { hasReference, model }) {
  const trimmed = String(base || DEFAULT_BASE).replace(/\/+$/, "");
  if (hasReference) return `${trimmed}/v1/images/edits`;
  if (/^doubao-seedream/i.test(model)) return `${trimmed}/v1/volc/images/generations`;
  return `${trimmed}/v1/images/generations`;
}

/* ---------------- 取图 ---------------- */

function inlineBase64Of(item) {
  if (typeof item?.b64_json === "string" && item.b64_json.length > 0) {
    return item.b64_json;
  }
  const url = item?.url;
  if (typeof url === "string" && url.startsWith("data:")) {
    const comma = url.indexOf(",");
    return comma >= 0 ? url.slice(comma + 1) : null;
  }
  return null;
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载结果图失败: HTTP ${response.status} ${response.statusText}`);
  }
  const contentType = response.headers.get("content-type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    format: extensionForFormat(contentType.replace(/^image\//i, "").split(";")[0].trim()),
  };
}

async function resolveOutputImage(payload, item) {
  const inline = inlineBase64Of(item);
  if (inline) {
    return {
      bytes: Buffer.from(inline, "base64"),
      format: extensionForFormat(payload?.output_format),
      source: "inline_base64",
    };
  }
  if (typeof item?.url === "string" && /^https?:\/\//i.test(item.url)) {
    const downloaded = await downloadImage(item.url);
    return { ...downloaded, source: "downloaded_url" };
  }
  throw new Error(
    JSON.stringify(
      {
        error: "响应中没有可用的图片数据",
        itemKeys: item ? Object.keys(item) : [],
        payloadKeys: payload ? Object.keys(payload) : [],
        preview: JSON.stringify(payload ?? {}).slice(0, 800),
      },
      null,
      2
    )
  );
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const cliArgs = parseCli(process.argv.slice(2));
  if (cliArgs.help) {
    console.log(usage());
    return;
  }

  const fileArgs = cliArgs.json
    ? JSON.parse(readFileSync(path.resolve(cliArgs.json), "utf8").replace(/^\uFEFF/, ""))
    : {};
  const args = {
    ...fileArgs,
    ...Object.fromEntries(Object.entries(cliArgs).filter(([key]) => key !== "json")),
  };


  const skillConfig = loadSkillConfig();
  const skillEnv = skillConfig.env;
  const apiKey = getEnv("FUN_TOKEN_API_KEY", skillEnv) || getEnv("FUN_API_KEY", skillEnv);
  if (!apiKey) {
    throw new Error(
      "缺少 FUN_TOKEN_API_KEY。请在环境变量中设置，或写入技能目录的 local.config.toml（也可用 ~/.dsh/config.toml）的 [skills.funtoken-image2.env]。\n" +
        '  PowerShell: $env:FUN_TOKEN_API_KEY="sk-xxx"'
    );
  }

  const baseUrl = getEnv("FUN_TOKEN_API_BASE_URL", skillEnv) || DEFAULT_BASE;
  const model = resolveModel(args.model || getEnv("FUN_TOKEN_IMAGE_MODEL", skillEnv));
  const timeoutMs = Number.parseInt(getEnv("FUN_TOKEN_IMAGE_TIMEOUT_MS", skillEnv) || "600000", 10);
  const outputDir = path.resolve(args.outDir || "output/funtoken");

  if (cliArgs.checkConfig) {
    console.log(
      JSON.stringify(
        {
          configSource: skillConfig.source,
          hasApiKey: Boolean(apiKey),
          baseUrl,
          model,
          timeoutMs,
          localConfigPath: LOCAL_CONFIG,
        },
        null,
        2
      )
    );
    return;
  }
  if (!args.prompt) {
    throw new Error(`缺少必填参数 prompt。\n\n${usage()}`);
  }

  const referencePaths = Array.isArray(args.referenceImagePaths) ? args.referenceImagePaths : [];
  for (const refPath of referencePaths) {
    if (!existsSync(refPath)) throw new Error(`参考图不存在: ${refPath}`);
  }
  const remoteReferences = Array.isArray(args.referenceImages) ? args.referenceImages : [];
  const hasReference = referencePaths.length > 0 || remoteReferences.length > 0;

  const { size, note } = resolveSize({
    resolution: args.resolution,
    aspectRatio: args.aspectRatio,
    model,
  });
  const endpointUrl = pickEndpoint(baseUrl, { hasReference, model });

  // ---- 构造请求 ----
  let body;
  const headers = { Authorization: `Bearer ${apiKey}` };

  if (hasReference) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", args.prompt);
    form.append("n", "1");

    for (const refPath of referencePaths) {
      const resolved = path.resolve(refPath);
      const bytes = readFileSync(resolved);
      // 注意：token.fun.tv 的 edits 接受重复的 `image` 字段；ai-pixel 才用 `image[]`
      form.append("image", new Blob([bytes], { type: mimeTypeForPath(resolved) }), path.basename(resolved));
    }
    for (const [index, remote] of remoteReferences.entries()) {
      const response = await fetch(remote);
      if (!response.ok) {
        throw new Error(`下载参考图失败: HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") || "image/png";
      const bytes = Buffer.from(await response.arrayBuffer());
      form.append(
        "image",
        new Blob([bytes], { type: contentType }),
        `reference-${index + 1}.${extensionForFormat(contentType.split("/")[1])}`
      );
    }

    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    const payload = {
      model,
      prompt: args.prompt,
      n: 1,
      size,
    };
    if (args.quality) payload.quality = args.quality;
    if (args.seed !== undefined) payload.seed = Number(args.seed);
    body = JSON.stringify(payload);
  }

  // ---- 发送 ----
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(endpointUrl, { method: "POST", headers, body, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs}ms）。${endpointUrl}`);
    }
    throw new Error(
      `请求失败: ${error.message}\n如果本机走代理，用 node --use-env-proxy 重跑；端点: ${endpointUrl}`
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    /* 保留原文用于诊断 */
  }

  if (!response.ok) {
    const detail = payload?.error?.message || rawText.slice(0, 800);
    throw new Error(`HTTP ${response.status}  ${endpointUrl}\n${detail}`);
  }
  if (!payload) {
    throw new Error(`响应不是 JSON: ${rawText.slice(0, 500)}`);
  }

  const item = payload?.data?.[0];
  if (!item) {
    throw new Error(`响应里没有 data[0]: ${JSON.stringify(payload).slice(0, 800)}`);
  }

  const output = await resolveOutputImage(payload, item);

  mkdirSync(outputDir, { recursive: true });
  const extension = extensionForFormat(args.outputFormat || output.format);
  const filePath = path.join(outputDir, `funtoken-${randomUUID()}.${extension}`);
  writeFileSync(filePath, output.bytes);

  console.log(
    JSON.stringify(
      {
        filePath,
        mimeType: `image/${extension === "jpg" ? "jpeg" : extension}`,
        model: item.model || payload.model || model,
        generationId: item.generation_id || "",
        revisePrompt: item.revised_prompt || "",
        actualSize: payload.size || "",
        quality: payload.quality || "",
        usage: payload.usage || null,
        elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
        request: {
          model,
          // edits 端点不传 size，输出尺寸跟随参考图，这里如实标注而不是给假值
          requestedSize: hasReference ? "(edits 不传 size，跟随参考图)" : size,
          endpoint: endpointUrl,
          referenceImageCount: referencePaths.length + remoteReferences.length,
          quality: args.quality || "",
          aspectRatio: args.aspectRatio || "",
          resolution: args.resolution || "",
          outDir: outputDir,
          imageSource: output.source,
          note,
        },
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
