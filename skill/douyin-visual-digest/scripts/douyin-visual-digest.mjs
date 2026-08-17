#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const result = {
    input: "",
    transcript: "",
    mediaFile: "",
    analysisFile: "",
    outDir: "",
    envFile: "",
    imageMode: "api",
    modelName: "base",
    title: "",
    dryRun: false,
    localAnalysis: false,
    testImageApi: false,
    testTextApi: false,
    transcriptOnly: false,
  };
  const fields = new Map([
    ["--input", "input"],
    ["--transcript", "transcript"],
    ["--media-file", "mediaFile"],
    ["--analysis-file", "analysisFile"],
    ["--out-dir", "outDir"],
    ["--env-file", "envFile"],
    ["--image-mode", "imageMode"],
    ["--model-name", "modelName"],
    ["--title", "title"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--local-analysis") result.localAnalysis = true;
    else if (arg === "--test-image-api") result.testImageApi = true;
    else if (arg === "--test-text-api") result.testTextApi = true;
    else if (arg === "--transcript-only") result.transcriptOnly = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (fields.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 缺少参数值。`);
      result[fields.get(arg)] = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  if (!["api", "none"].includes(result.imageMode)) {
    throw new Error("--image-mode 只支持 api 或 none。");
  }
  return result;
}

function printHelp() {
  console.log(`抖音通俗图解

用法：
  node scripts/douyin-visual-digest.mjs --input <抖音链接或分享文本>
  node scripts/douyin-visual-digest.mjs --media-file <本地视频或音频>
  node scripts/douyin-visual-digest.mjs --transcript <转写文件> --analysis-file <结构化解释 JSON>
  node scripts/douyin-visual-digest.mjs --test-image-api
  node scripts/douyin-visual-digest.mjs --test-text-api

选项：
  --out-dir <目录>          指定本次输出目录
  --env-file <文件>        指定 .env 文件
  --analysis-file <文件>   使用 Codex 或文本模型提供的解释 JSON
  --media-file <文件>      直接转写本地视频或音频
  --image-mode <模式>      api 或 none；默认 api，只生成一张知识图
  --model-name <模型>      tiny 或 base；默认 base
  --title <标题>           覆盖自动标题
  --dry-run                不调用文本或生图 API
  --local-analysis         强制使用本地内容分析
  --test-image-api         只生成一张中文知识图测试
  --test-text-api          只测试文本解释 API
  --transcript-only        只完成链接解析、下载和转写
`);
}

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function loadEnvironment(envFile) {
  const target = envFile ? path.resolve(envFile) : path.join(rootDir, ".env");
  if (!existsSync(target)) return { ...process.env };
  return { ...parseEnv(await readFile(target, "utf8")), ...process.env };
}

function firstValue(env, names, fallback = "") {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return fallback;
}

export function resolveConfig(env = process.env) {
  const commonBaseUrl = firstValue(env, ["AI_API_BASE_URL"]);
  const commonApiKey = firstValue(env, ["AI_API_KEY"]);
  const bundledTranscriber = path.join(rootDir, "scripts", "transcribe-douyin-local.ps1");
  return {
    imageBaseUrl: firstValue(env, ["IMAGE_API_BASE_URL", "LCONAI_BASE_URL", "OPENAI_BASE_URL"], commonBaseUrl || "https://api.openai.com/v1"),
    imageApiKey: firstValue(env, ["IMAGE_API_KEY", "LCONAI_API_KEY", "OPENAI_API_KEY"], commonApiKey),
    imageModel: firstValue(env, ["IMAGE_MODEL"], "gpt-image-2"),
    imageSize: firstValue(env, ["IMAGE_SIZE"], "1024x1024"),
    imageQuality: firstValue(env, ["IMAGE_QUALITY"]),
    imageResponseFormat: firstValue(env, ["IMAGE_RESPONSE_FORMAT"], "b64_json"),
    imageTimeout: Number.parseInt(firstValue(env, ["IMAGE_REQUEST_TIMEOUT_MS"], "360000"), 10),
    textBaseUrl: firstValue(env, ["TEXT_API_BASE_URL"], commonBaseUrl),
    textApiKey: firstValue(env, ["TEXT_API_KEY"], commonApiKey),
    textModel: firstValue(env, ["TEXT_MODEL"]),
    textTimeout: Number.parseInt(firstValue(env, ["TEXT_REQUEST_TIMEOUT_MS"], "120000"), 10),
    transcriberScript: firstValue(env, ["DOUYIN_TRANSCRIBER_SCRIPT"], existsSync(bundledTranscriber)
      ? bundledTranscriber
      : path.join(homedir(), ".codex", "skills", "douyin-transcriber", "scripts", "transcribe-douyin.ps1")),
    douyinToolRoot: firstValue(env, ["DOUYIN_TOOL_ROOT"]),
  };
}

function endpoint(baseUrl, route) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  return clean.endsWith(route) ? clean : `${clean}${route}`;
}

export function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._~-]+/gi, "[redacted-key]")
    .replace(/([?&](?:api_?key|key|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{36,}\b/g, "[redacted-secret]");
}

async function readJsonResponse(response) {
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw: raw.slice(0, 500) };
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.raw || `HTTP ${response.status}`;
    const error = new Error(redact(message));
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function fetchWithTimeout(url, options, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`请求超过 ${timeout}ms，已取消。`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function inferImageExtension(contentType, data) {
  if (/jpeg/i.test(contentType)) return "jpg";
  if (/webp/i.test(contentType)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  if (data?.[0] === 0xff && data?.[1] === 0xd8) return "jpg";
  if (data?.slice(0, 4).toString("ascii") === "RIFF") return "webp";
  return "png";
}

function parseBase64Image(value) {
  const text = String(value || "");
  const dataUrl = text.match(/^data:(image\/[^;]+);base64,(.+)$/s);
  if (dataUrl) {
    const buffer = Buffer.from(dataUrl[2], "base64");
    return { buffer, extension: inferImageExtension(dataUrl[1], buffer) };
  }
  const buffer = Buffer.from(text, "base64");
  return { buffer, extension: inferImageExtension("", buffer) };
}

async function saveImagePayload(payload, targetBase, timeout) {
  const item = payload?.data?.[0];
  const base64 = item?.b64_json || item?.base64 || payload?.b64_json;
  if (base64) {
    const image = parseBase64Image(base64);
    const target = `${targetBase}.${image.extension}`;
    await writeFile(target, image.buffer);
    return target;
  }
  const remoteUrl = item?.url || payload?.url;
  if (remoteUrl) {
    const response = await fetchWithTimeout(remoteUrl, {}, timeout);
    if (!response.ok) throw new Error(`下载生成图片失败：HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const target = `${targetBase}.${inferImageExtension(response.headers.get("content-type") || "", buffer)}`;
    await writeFile(target, buffer);
    return target;
  }
  throw new Error("生图接口没有返回 data[0].b64_json 或 data[0].url。");
}

export async function generateImage({ prompt, targetBase, config, fetchImpl = fetch }) {
  const url = endpoint(config.imageBaseUrl, "/images/generations");
  const baseBody = { model: config.imageModel, prompt, n: 1, size: config.imageSize };
  if (config.imageQuality) baseBody.quality = config.imageQuality;

  async function request(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.imageTimeout);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.imageApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return readJsonResponse(response);
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`请求超过 ${config.imageTimeout}ms，已取消。`);
      const detail = [error?.cause?.code, error?.cause?.message].filter(Boolean).join(": ");
      throw new Error(detail ? `${error.message} (${detail})` : error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  let payload;
  try {
    payload = await request(config.imageResponseFormat
      ? { ...baseBody, response_format: config.imageResponseFormat }
      : baseBody);
  } catch (error) {
    const unsupported = /response[_ ]?format|b64_json|unknown (?:field|parameter)|unsupported (?:field|parameter)/i.test(error.message);
    if (!config.imageResponseFormat || !unsupported) throw error;
    payload = await request(baseBody);
  }
  return saveImagePayload(payload, targetBase, config.imageTimeout);
}

function cleanText(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanTranscript(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  return cleanText(lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    return !/^(?:read_audio_data:|whisper_(?:init|model|state|print|full|backend|load|lang|sampler|ctx)|system_info:|main: processing|ggml_)/i.test(trimmed);
  }).join("\n"));
}

function splitSentences(text) {
  const compact = cleanText(text).replace(/\n+/g, "");
  return (compact.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function truncate(value, max) {
  const text = cleanText(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || "").replace(/[，。！？!?；;、\s]/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countHan(value) {
  return (String(value || "").match(/[\u3400-\u4DBF\u4E00-\u9FFF]/gu) || []).length;
}

function truncateByHan(value, maxHan, maxChars = maxHan * 3 + 40) {
  const text = cleanText(value);
  if (countHan(text) <= maxHan && text.length <= maxChars) return text;
  let result = "";
  let han = 0;
  for (const character of text) {
    const isHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/u.test(character);
    if ((isHan && han >= maxHan) || result.length >= maxChars) break;
    result += character;
    if (isHan) han += 1;
  }
  return result.replace(/[，、；：:,.\s]+$/u, "").trim();
}

function visibleSummaryText(summary) {
  return [
    summary.title,
    summary.coreReason,
    ...summary.sections.flatMap((section) => [section.heading, section.body]),
    summary.conclusion,
  ].filter(Boolean).join("\n");
}

export function fitVisualSummary(value, fallback = {}) {
  const source = value && typeof value === "object" ? value : fallback;
  const fallbackSections = Array.isArray(fallback.sections) ? fallback.sections : [];
  const providedSections = Array.isArray(source.sections) ? source.sections : [];
  const sections = providedSections.map((item, index) => ({
    heading: truncateByHan(item?.heading || fallbackSections[index]?.heading || `要点 ${index + 1}`, 24, 60),
    body: truncateByHan(item?.body || item?.text || fallbackSections[index]?.body || "", 120, 260),
  })).filter((item) => item.body).slice(0, 6);
  const result = {
    title: truncateByHan(source.title || fallback.title || "视频内容图解", 36, 70),
    coreReason: truncateByHan(source.coreReason || source.overview || fallback.coreReason || "", 100, 220),
    sections: sections.length ? sections : fallbackSections.slice(0, 6),
    conclusion: truncateByHan(source.conclusion || source.takeaway || fallback.conclusion || "", 80, 180),
    visualDirection: truncate(source.visualDirection || fallback.visualDirection || "专业中文编辑信息图，使用与主题直接相关的场景、物件、流程和关系线辅助理解。", 800),
    image: "",
    status: "planned",
    error: "",
  };

  let guard = 0;
  while (countHan(visibleSummaryText(result)) > 550 && guard < 800) {
    guard += 1;
    const candidates = [
      ...result.sections.map((section) => ({ target: section, key: "body", size: countHan(section.body), min: 28 })),
      { target: result, key: "coreReason", size: countHan(result.coreReason), min: 30 },
      { target: result, key: "conclusion", size: countHan(result.conclusion), min: 20 },
    ].filter((item) => item.size > item.min).sort((a, b) => b.size - a.size);
    if (!candidates.length) break;
    const candidate = candidates[0];
    candidate.target[candidate.key] = truncateByHan(candidate.target[candidate.key], candidate.size - 1);
  }
  result.hanCount = countHan(visibleSummaryText(result));
  return result;
}

export function buildInfographicPrompt(summary) {
  const sections = summary.sections.map((section) => `${section.heading}：${section.body}`).join("\n");
  const exactCopy = `${summary.title}\n核心说明：${summary.coreReason}\n${sections}\n结论：${summary.conclusion}`;
  return truncate(`Create exactly one polished Chinese knowledge infographic. It must explain the full topic without relying on the video or surrounding article. It should feel like a professional editorial illustration, not a PPT, a cover image, or a dense wall of text.

Choose the clearest layout from the content itself. Use distinct visual regions, meaningful icons or objects, and arrows, layers, timelines, or connection lines only when they improve understanding. Keep generous spacing, strong hierarchy, and readable simplified-Chinese typography. Visual direction: ${summary.visualDirection}

Render every line inside the exact-copy block faithfully. Do not omit, rewrite, invent, or add Chinese copy. Do not render Markdown symbols, English labels, placeholder text, a logo, watermark, QR code, or mock interface text. Prioritize accurate Chinese text and information clarity over decorative detail.

[EXACT COPY START]
${exactCopy}
[EXACT COPY END]`, 8000);
}

function buildLocalPlainLanguage(summary, corePoints, actionItems) {
  return {
    overview: `这段视频主要想说明：${truncate(summary, 260)}`,
    keyIdeas: corePoints.slice(0, 5).map((item, index) => ({
      heading: `观点 ${index + 1}`,
      explanation: `简单说，这里的重点是：${truncate(item, 180)}`,
      example: `可以放到自己的工作或学习场景里检查：当前做法是否真正体现了“${truncate(item, 70)}”？`,
    })),
    takeaway: truncate(actionItems[0] || corePoints[0] || summary, 180),
  };
}

function buildLocalVisualSummary(title, summary, corePoints, takeaway) {
  const candidate = {
    title,
    coreReason: summary,
    sections: corePoints.slice(0, 4).map((item, index) => ({ heading: `关键点 ${index + 1}`, body: item })),
    conclusion: takeaway,
    visualDirection: "专业中文编辑信息图，按内容关系组织画面，使用真实物件、结构图和关系线帮助理解。",
  };
  return fitVisualSummary(candidate, candidate);
}

export function analyzeLocally(transcript, titleOverride = "") {
  const sentences = unique(splitSentences(transcript));
  if (!sentences.length) throw new Error("转写内容过短，无法生成图文解读。");
  const ranked = [...sentences].sort((a, b) => b.length - a.length);
  const corePoints = unique([...sentences.slice(0, 2), ...ranked.slice(0, 4)]).slice(0, 5);
  const title = truncate(titleOverride || sentences[0].replace(/[。！？!?；;]+$/, ""), 42);
  const summary = truncate(sentences.slice(0, 2).join(""), 150);
  const actions = unique(sentences.filter((item) => /应该|需要|可以|建议|先|再|最后|不要|避免|必须/.test(item))).slice(0, 4);
  if (!actions.length) actions.push(corePoints[0] || summary);
  const plainLanguage = buildLocalPlainLanguage(summary, corePoints, actions);
  const visualSummary = buildLocalVisualSummary(title, summary, corePoints, plainLanguage.takeaway);
  visualSummary.prompt = buildInfographicPrompt(visualSummary);
  return { version: 2, title, plainLanguage, visualSummary };
}

function extractModelText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item?.text || "").join("");
  return "";
}

function parseModelJson(text) {
  const clean = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("文本模型没有返回有效 JSON。");
  }
}

export function normalizeDigest(candidate, fallback, titleOverride = "") {
  const plain = candidate?.plainLanguage && typeof candidate.plainLanguage === "object" ? candidate.plainLanguage : {};
  const keyIdeas = Array.isArray(plain.keyIdeas)
    ? plain.keyIdeas.map((item, index) => ({
      heading: truncate(item?.heading || `观点 ${index + 1}`, 60),
      explanation: truncate(item?.explanation || item?.body || "", 420),
      example: truncate(item?.example || "", 320),
    })).filter((item) => item.explanation).slice(0, 8)
    : fallback.plainLanguage.keyIdeas;
  const visualSummary = fitVisualSummary(candidate?.visualSummary, fallback.visualSummary);
  visualSummary.prompt = buildInfographicPrompt(visualSummary);
  return {
    version: 2,
    title: truncate(titleOverride || candidate?.title || fallback.title, 42),
    plainLanguage: {
      overview: truncate(plain.overview || fallback.plainLanguage.overview, 600),
      keyIdeas: keyIdeas.length ? keyIdeas : fallback.plainLanguage.keyIdeas,
      takeaway: truncate(plain.takeaway || fallback.plainLanguage.takeaway, 300),
    },
    visualSummary,
  };
}

async function analyzeWithApi(transcript, fallback, config, titleOverride) {
  const prompt = `请将下面的中文视频转写整理为严格 JSON，不要虚构原视频没有的信息。

字段必须为：
1. title：准确、简洁的中文标题。
2. plainLanguage：包含 overview、keyIdeas、takeaway。
   - overview：说明视频解决什么问题、核心结论是什么。
   - keyIdeas：数组，每项包含 heading、explanation、example。专业词首次出现时顺手解释；example 必须具体。
   - takeaway：读者最后只需要记住的一句话。
3. visualSummary：用于生成一张正文知识图，包含 title、coreReason、sections、conclusion、visualDirection。
   - sections：2 到 6 项，每项包含 heading 和 body。
   - 图片正文目标 480 到 500 个汉字，绝对不能超过 550 个汉字。
   - 保留核心概念、逻辑关系、步骤和必要例子；不要放逐字稿，不生成封面，不拆成多张图。
   - visualDirection：只描述画面结构、视觉隐喻和关系表达，不重复正文。

通俗解释不能只是重复原句。转写：\n${transcript.slice(0, 50000)}`;
  const response = await fetchWithTimeout(endpoint(config.textBaseUrl, "/chat/completions"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.textApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.textModel,
      messages: [
        { role: "system", content: "你是中文内容编辑。只输出 JSON，不要输出 Markdown。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  }, config.textTimeout);
  return normalizeDigest(parseModelJson(extractModelText(await readJsonResponse(response))), fallback, titleOverride);
}

function extractDouyinUrl(input) {
  const match = String(input || "").match(/https?:\/\/(?:www\.)?(?:v\.)?douyin\.com\/[^\s]+/i);
  return match ? match[0].replace(/[，。！？!?)）\]}]+$/, "") : "";
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(redact(stderr || stdout || `${command} 退出码 ${code}`)));
    });
  });
}

async function transcribeDouyin(input, runDir, modelName, config) {
  if (!existsSync(config.transcriberScript)) throw new Error(`找不到抖音转写入口：${config.transcriberScript}`);
  const before = new Set(await readdir(runDir));
  const args = [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", config.transcriberScript,
    "-OutDir", runDir,
    "-ModelName", modelName,
  ];
  if (input?.mediaFile) args.push("-MediaPath", input.mediaFile);
  else args.push("-InputText", input?.text || "");
  const result = await runCommand("powershell.exe", args);
  const candidates = (await readdir(runDir))
    .filter((name) => !before.has(name) && /^douyin-transcript-.+\.txt$/i.test(name))
    .sort();
  if (!candidates.length) throw new Error("转写脚本执行完成，但没有找到新转写文件。");
  const target = path.join(runDir, "transcript.txt");
  await rename(path.join(runDir, candidates.at(-1)), target);
  const markers = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) markers[match[1]] = match[2].trim();
  }
  return {
    transcriptPath: target,
    source: {
      mode: markers.SOURCE_MODE || (input?.mediaFile ? "provided-media" : "audio-asr"),
      detail: markers.SOURCE_DETAIL || "",
      url: markers.SOURCE_URL || extractDouyinUrl(input?.text),
      title: markers.SOURCE_TITLE || "",
      warning: markers.SOURCE_WARNING || "",
    },
  };
}

function stamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/([\\`*_{}[\]()<>#+.!|-])/g, "\\$1");
}

async function renderOutputs({ digest, runDir }) {
  const infographic = digest.visualSummary.status === "generated"
    ? `\n\n![${markdownEscape(digest.visualSummary.title)}](${digest.visualSummary.image.replaceAll("\\", "/")})`
    : "";
  const ideas = digest.plainLanguage.keyIdeas.map((item) => `### ${markdownEscape(item.heading)}\n\n${markdownEscape(item.explanation)}${item.example ? `\n\n**举个例子：** ${markdownEscape(item.example)}` : ""}`).join("\n\n");
  const markdown = `# ${markdownEscape(digest.title)}：通俗解释稿\n\n## 这段视频到底在讲什么\n\n${markdownEscape(digest.plainLanguage.overview)}\n\n## 逐个讲明白\n\n${ideas}\n\n## 最后记住\n\n${markdownEscape(digest.plainLanguage.takeaway)}${infographic}\n`;
  const plainLanguagePath = path.join(runDir, "plain-language.md");
  const promptPath = path.join(runDir, "image-prompt.md");
  await Promise.all([
    writeFile(plainLanguagePath, markdown, "utf8"),
    writeFile(promptPath, `${digest.visualSummary.prompt}\n`, "utf8"),
  ]);
  return {
    plainLanguagePath,
    promptPath,
    infographicPath: digest.visualSummary.status === "generated" ? path.join(runDir, digest.visualSummary.image) : "",
  };
}

async function testTextApi(config) {
  if (!config.textBaseUrl || !config.textApiKey || !config.textModel) {
    throw new Error("缺少 TEXT_API_BASE_URL、TEXT_API_KEY 或 TEXT_MODEL。");
  }
  const transcript = "一个好的视频解读不能只压缩原文，还要解释概念、举例，并告诉读者最后应该记住什么。";
  const digest = await analyzeWithApi(transcript, analyzeLocally(transcript, "文本 API 测试"), config, "文本 API 测试");
  console.log("TEXT_API_STATUS=connected");
  console.log(`TEXT_MODEL=${config.textModel}`);
  console.log(`TEXT_EXPLANATION_PREVIEW=${truncate(digest.plainLanguage.overview, 100)}`);
  return digest;
}

async function testImageApi(config, outDir) {
  if (!config.imageApiKey) throw new Error("缺少 IMAGE_API_KEY（或兼容的 LCONAI_API_KEY）。");
  const runDir = path.resolve(outDir || path.join(rootDir, "outputs", `image-api-test-${stamp()}`));
  const imageDir = path.join(runDir, "images");
  await mkdir(imageDir, { recursive: true });
  const summary = fitVisualSummary({
    title: "抖音内容图解",
    coreReason: "把视频整理成能快速看懂的文字和知识图。",
    sections: [
      { heading: "先理解", body: "提取原意并用大白话解释。" },
      { heading: "再呈现", body: "压缩重点并生成一张中文信息图。" },
    ],
    conclusion: "文字负责讲清楚，图片负责帮助记忆。",
    visualDirection: "简洁专业的中文编辑信息图，用文档、视频和知识卡片表现信息转化。",
  });
  const target = await generateImage({
    prompt: buildInfographicPrompt(summary),
    targetBase: path.join(imageDir, "api-test"),
    config,
  });
  console.log("IMAGE_API_STATUS=connected");
  console.log(`IMAGE_MODEL=${config.imageModel}`);
  console.log(`IMAGE_FILE=${target}`);
  return target;
}

export async function runPipeline(options, env = process.env) {
  const config = resolveConfig(env);
  if (options.testImageApi) return testImageApi(config, options.outDir);
  if (options.testTextApi) return testTextApi(config);
  if (!options.input && !options.transcript && !options.mediaFile) {
    throw new Error("请提供 --input 抖音链接/分享文本、--media-file 本地媒体，或 --transcript 转写文件。");
  }

  const runDir = path.resolve(options.outDir || path.join(rootDir, "outputs", `douyin-digest-${stamp()}`));
  const imageDir = path.join(runDir, "images");
  await mkdir(imageDir, { recursive: true });

  let transcriptPath;
  let source = { mode: "provided-transcript", detail: "", url: "", title: "", warning: "" };
  if (options.transcript) {
    const sourcePath = path.resolve(options.transcript);
    if (!existsSync(sourcePath)) throw new Error(`转写文件不存在：${sourcePath}`);
    transcriptPath = path.join(runDir, "transcript.txt");
    await writeFile(transcriptPath, `${cleanTranscript(await readFile(sourcePath, "utf8"))}\n`, "utf8");
  } else {
    const transcribed = await transcribeDouyin({ text: options.input, mediaFile: options.mediaFile }, runDir, options.modelName, config);
    transcriptPath = transcribed.transcriptPath;
    source = transcribed.source;
  }
  const transcript = cleanTranscript(await readFile(transcriptPath, "utf8"));
  await writeFile(transcriptPath, `${transcript}\n`, "utf8");
  if (options.transcriptOnly) {
    console.log(`OUTPUT_DIR=${runDir}`);
    console.log(`TRANSCRIPT=${transcriptPath}`);
    console.log(`SOURCE_MODE=${source.mode}`);
    console.log(`SOURCE_DETAIL=${source.detail}`);
    if (source.warning) console.log(`SOURCE_WARNING=${source.warning}`);
    console.log("PIPELINE_STAGE=transcript-only");
    return { runDir, transcriptPath, source };
  }

  const fallback = analyzeLocally(transcript, options.title);
  let digest = fallback;
  let analysisMode = "local";
  if (options.analysisFile) {
    const analysisPath = path.resolve(options.analysisFile);
    if (!existsSync(analysisPath)) throw new Error(`结构化解释文件不存在：${analysisPath}`);
    digest = normalizeDigest(JSON.parse(await readFile(analysisPath, "utf8")), fallback, options.title);
    analysisMode = "provided";
  }
  const canUseTextApi = analysisMode === "local" && !options.dryRun && !options.localAnalysis
    && config.textBaseUrl && config.textApiKey && config.textModel;
  if (canUseTextApi) {
    try {
      digest = await analyzeWithApi(transcript, fallback, config, options.title);
      analysisMode = "api";
    } catch (error) {
      console.warn(`TEXT_API_WARNING=${redact(error.message)}；已使用本地分析。`);
    }
  }

  const actualImageMode = options.dryRun ? "dry-run" : options.imageMode;
  const useImageApi = !options.dryRun && options.imageMode === "api";
  if (useImageApi && !config.imageApiKey) {
    throw new Error("默认流程需要生图 API。请先运行 scripts/configure.ps1 -SkipText，或显式使用 --image-mode none。");
  }
  if (useImageApi) {
    try {
      const target = await generateImage({
        prompt: digest.visualSummary.prompt,
        targetBase: path.join(imageDir, "knowledge-infographic"),
        config,
      });
      digest.visualSummary.image = path.relative(runDir, target).replaceAll("\\", "/");
      digest.visualSummary.status = "generated";
    } catch (error) {
      digest.visualSummary.status = "failed";
      digest.visualSummary.error = redact(error.message);
      throw new Error(`知识图生成失败：${digest.visualSummary.error}`);
    }
  } else if (options.imageMode === "none") {
    digest.visualSummary.status = "skipped";
  }

  digest.meta = {
    analysisMode,
    imageMode: actualImageMode,
    sourceMode: source.mode,
    sourceDetail: source.detail,
    sourceUrl: source.url || extractDouyinUrl(options.input),
    sourceTitle: source.title,
    sourceWarning: source.warning,
    generatedAt: new Date().toISOString(),
    imageModel: useImageApi ? config.imageModel : "",
    imageTextHan: digest.visualSummary.hanCount,
  };
  const outputs = await renderOutputs({ digest, runDir });
  const digestPath = path.join(runDir, "digest.json");
  await writeFile(digestPath, `${JSON.stringify(digest, null, 2)}\n`, "utf8");

  console.log(`OUTPUT_DIR=${runDir}`);
  console.log(`TRANSCRIPT=${transcriptPath}`);
  console.log(`DIGEST_JSON=${digestPath}`);
  console.log(`PLAIN_LANGUAGE=${outputs.plainLanguagePath}`);
  console.log(`INFOGRAPHIC=${outputs.infographicPath}`);
  console.log(`IMAGE_PROMPT=${outputs.promptPath}`);
  console.log(`ANALYSIS_MODE=${analysisMode}`);
  console.log(`SOURCE_MODE=${source.mode}`);
  console.log(`SOURCE_DETAIL=${source.detail}`);
  if (source.warning) console.log(`SOURCE_WARNING=${source.warning}`);
  console.log(`IMAGE_MODE=${actualImageMode}`);
  console.log(`IMAGE_TEXT_HAN=${digest.visualSummary.hanCount}`);
  console.log(`IMAGES_GENERATED=${digest.visualSummary.status === "generated" ? 1 : 0}`);
  return { runDir, transcriptPath, digestPath, digest, ...outputs };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    await runPipeline(options, await loadEnvironment(options.envFile));
  } catch (error) {
    console.error(`ERROR=${redact(error?.message || error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
