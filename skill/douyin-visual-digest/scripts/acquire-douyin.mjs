#!/usr/bin/env node

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const scriptFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFile);
const rootDir = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const result = { input: "", outDir: "", profileDir: "", timeoutMs: 60000, noDownload: false };
  const fields = new Map([
    ["--input", "input"],
    ["--out-dir", "outDir"],
    ["--profile-dir", "profileDir"],
    ["--timeout-ms", "timeoutMs"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-download") result.noDownload = true;
    else if (arg === "--help" || arg === "-h") result.help = true;
    else if (fields.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${arg} 缺少参数值。`);
      result[fields.get(arg)] = fields.get(arg) === "timeoutMs" ? Number.parseInt(value, 10) : value;
      index += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`抖音浏览器获取器

用法：
  node scripts/acquire-douyin.mjs --input <抖音链接或分享文本> --out-dir <目录>

选项：
  --profile-dir <目录>  使用专用浏览器配置目录，不读取个人浏览器 Cookie
  --timeout-ms <毫秒>  等待抖音详情接口的总时长，默认 60000
  --no-download        只获取标题和章节，不下载媒体
`);
}

export function extractDouyinUrl(input) {
  const match = String(input || "").match(/https?:\/\/(?:www\.)?(?:v\.)?douyin\.com\/[^\s]+/i);
  return match ? match[0].replace(/[，。！？!?)）\]}]+$/, "") : "";
}

function findBrowser(env = process.env) {
  const candidates = [
    env.DOUYIN_BROWSER_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function timestamp(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function formatChapterText(aweme) {
  const chapters = Array.isArray(aweme?.chapter_list) ? aweme.chapter_list : [];
  const lines = [
    "【来源说明】以下内容来自抖音页面的章节要点，不是逐字转写。",
    `标题：${String(aweme?.desc || aweme?.caption || "未命名视频").trim()}`,
  ];
  if (aweme?.chapter_abstract) lines.push(`内容摘要：${String(aweme.chapter_abstract).trim()}`);
  if (chapters.length) {
    lines.push("", "章节要点：");
    for (const chapter of chapters) {
      const heading = String(chapter?.desc || "未命名章节").trim();
      const detail = String(chapter?.detail || "").trim();
      lines.push(`[${timestamp(chapter?.timestamp)}] ${heading}${detail ? `：${detail}` : ""}`);
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

function collectUrlList(value) {
  return Array.isArray(value?.url_list) ? value.url_list.filter((item) => /^https?:\/\//i.test(item)) : [];
}

export function selectMediaUrls(aweme) {
  const video = aweme?.video || {};
  const candidates = [
    ...collectUrlList(video.play_addr_h264),
    ...collectUrlList(video.play_addr),
    ...collectUrlList(video.download_addr),
  ];
  for (const rate of Array.isArray(video.bit_rate) ? video.bit_rate : []) {
    if (!rate?.is_h265 && !rate?.is_bytevc1) candidates.push(...collectUrlList(rate.play_addr));
  }
  return [...new Set(candidates)];
}

async function waitForDetail(getDetail, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const detail = getDetail();
    if (detail?.aweme_id) return detail;
    await delay(250);
  }
  return null;
}

function cookieHeader(cookies) {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function downloadMedia(urls, target, headers, timeoutMs) {
  const failures = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers,
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
      return target;
    } catch (error) {
      failures.push(error?.name === "AbortError" ? "请求超时" : String(error?.message || error));
      await rm(target, { force: true });
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`媒体下载失败：${failures.join("；") || "没有可用地址"}`);
}

export async function acquireDouyin(options, env = process.env) {
  const sourceUrl = extractDouyinUrl(options.input);
  if (!sourceUrl) throw new Error("输入内容中没有找到抖音链接。");
  const browserPath = findBrowser(env);
  if (!browserPath) throw new Error("找不到 Microsoft Edge 或 Google Chrome。");

  const outDir = path.resolve(options.outDir || path.join(rootDir, "outputs", "acquire"));
  const profileDir = path.resolve(options.profileDir || path.join(rootDir, ".runtime", "browser-profile"));
  await mkdir(outDir, { recursive: true });
  await mkdir(profileDir, { recursive: true });

  let context;
  let detail = null;
  let responseError = "";
  try {
    const browserOptions = {
      executablePath: browserPath,
      headless: true,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
      args: ["--disable-blink-features=AutomationControlled", "--disable-background-networking"],
    };
    try {
      context = await chromium.launchPersistentContext(profileDir, browserOptions);
    } catch (error) {
      const fallbackProfile = path.join(outDir, "browser-profile");
      await mkdir(fallbackProfile, { recursive: true });
      context = await chromium.launchPersistentContext(fallbackProfile, browserOptions);
    }
    const page = context.pages()[0] || await context.newPage();
    page.on("response", async (response) => {
      if (!response.url().includes("/aweme/v1/web/aweme/detail/") || response.status() !== 200) return;
      try {
        const payload = await response.json();
        if (payload?.aweme_detail?.aweme_id) detail = payload.aweme_detail;
      } catch (error) {
        responseError = String(error?.message || error);
      }
    });

    const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(15000, options.timeoutMs) : 60000;
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 45000) });
    detail = await waitForDetail(() => detail, Math.floor(timeoutMs * 0.65));
    if (!detail) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 45000) });
      detail = await waitForDetail(() => detail, Math.max(15000, Math.floor(timeoutMs * 0.35)));
    }
    if (!detail) throw new Error(`浏览器已打开抖音页面，但没有拿到视频详情${responseError ? `：${responseError}` : ""}`);

    const resolvedUrl = page.url();
    const chaptersPath = path.join(outDir, "chapters.txt");
    const chapterText = formatChapterText(detail);
    await writeFile(chaptersPath, chapterText, "utf8");

    let mediaPath = "";
    let mediaError = "";
    const mediaUrls = selectMediaUrls(detail);
    if (!options.noDownload && mediaUrls.length) {
      const cookies = await context.cookies();
      const headers = {
        "user-agent": await page.evaluate(() => navigator.userAgent),
        referer: resolvedUrl,
        cookie: cookieHeader(cookies),
      };
      try {
        mediaPath = path.join(outDir, "source-video.mp4");
        await downloadMedia(mediaUrls, mediaPath, headers, Math.max(120000, timeoutMs * 2));
      } catch (error) {
        mediaError = String(error?.message || error);
        mediaPath = "";
      }
    }

    const metadata = {
      sourceMode: mediaPath ? "browser-media" : "page-chapters",
      sourceUrl,
      resolvedUrl,
      awemeId: String(detail.aweme_id || ""),
      title: String(detail.desc || detail.caption || "").trim(),
      durationMs: Number(detail?.video?.duration || 0),
      chapterAbstract: String(detail.chapter_abstract || "").trim(),
      chapters: Array.isArray(detail.chapter_list) ? detail.chapter_list : [],
      chaptersPath,
      mediaPath,
      mediaError,
      browser: path.basename(browserPath),
    };
    const metadataPath = path.join(outDir, "acquisition.json");
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    return { ...metadata, metadataPath };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) return printHelp();
    if (!options.input) throw new Error("请提供 --input 抖音链接或分享文本。");
    const result = await acquireDouyin(options);
    console.log("ACQUIRE_STATUS=ready");
    console.log(`SOURCE_MODE=${result.sourceMode}`);
    console.log(`SOURCE_URL=${result.resolvedUrl || result.sourceUrl}`);
    console.log(`SOURCE_TITLE=${result.title}`);
    console.log(`MEDIA_FILE=${result.mediaPath}`);
    console.log(`CHAPTERS_FILE=${result.chaptersPath}`);
    console.log(`METADATA_FILE=${result.metadataPath}`);
  } catch (error) {
    console.error(`ERROR=${error?.message || error}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
