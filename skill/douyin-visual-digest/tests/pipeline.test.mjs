import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  analyzeLocally,
  buildInfographicPrompt,
  countHan,
  fitVisualSummary,
  redact,
  resolveConfig,
} from "../scripts/douyin-visual-digest.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "scripts", "douyin-visual-digest.mjs");
const fixture = path.join(root, "tests", "fixtures", "sample-transcript.txt");
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr4cAAAAASUVORK5CYII=";

function sampleAnalysis() {
  return {
    title: "Agent 四层记忆架构",
    plainLanguage: {
      overview: "这段内容解释 Agent 为什么需要把不同用途的记忆分开管理。",
      keyIdeas: [{
        heading: "为什么要分层",
        explanation: "不同信息的有效期和使用方式不同，混在一起会让上下文越来越乱。",
        example: "系统规则要长期保留，而当前工具返回只需要服务眼前步骤。",
      }],
      takeaway: "让每一层记忆只解决一类问题。",
    },
    visualSummary: {
      title: "Agent 四层记忆架构",
      coreReason: "按信息时效和用途分层，让 Agent 既守规则又能积累经验。",
      sections: [
        { heading: "核心记忆", body: "保存角色、任务和工具规范，防止原则漂移。" },
        { heading: "瞬时记忆", body: "保留当前对话和工具结果，防止步骤断链。" },
        { heading: "短期记忆", body: "把长对话压缩为摘要，避免上下文爆炸。" },
        { heading: "长期记忆", body: "跨会话保存关键经验，避免经验归零。" },
      ],
      conclusion: "核心守底线，瞬时保衔接，短期控上下文，长期沉经验。",
      visualDirection: "中心 Agent 连接四个记忆区域，用规则手册、对话流、摘要文档和向量数据库表现。",
    },
  };
}

test("local analysis builds one visual summary", async () => {
  const transcript = await readFile(fixture, "utf8");
  const digest = analyzeLocally(transcript);
  assert.equal(digest.version, 2);
  assert.ok(digest.plainLanguage.overview.length > 20);
  assert.ok(digest.visualSummary.sections.length >= 2);
  assert.ok(digest.visualSummary.hanCount <= 550);
  assert.match(digest.visualSummary.prompt, /exact-copy block/i);
  assert.equal("visualCards" in digest, false);
});

test("visual copy is clamped to the hard 550-Han limit", () => {
  const repeated = "这是一段需要继续压缩的中文知识说明。".repeat(35);
  const summary = fitVisualSummary({
    title: "超长内容测试",
    coreReason: repeated,
    sections: Array.from({ length: 6 }, (_, index) => ({ heading: `模块 ${index + 1}`, body: repeated })),
    conclusion: repeated,
    visualDirection: "专业知识信息图。",
  });
  assert.ok(summary.hanCount <= 550);
  assert.ok(countHan(buildInfographicPrompt(summary)) >= summary.hanCount);
});

test("configuration uses the one-image defaults", () => {
  const config = resolveConfig({
    IMAGE_API_BASE_URL: "https://example.test/v1",
    IMAGE_API_KEY: "test-key",
  });
  assert.equal(config.imageModel, "gpt-image-2");
  assert.equal(config.imageSize, "1024x1024");
  assert.equal(config.imageTimeout, 360000);
});

test("redaction removes common secret forms", () => {
  const value = redact("Bearer bearer-placeholder sk-test-placeholder token=abcdefghijklmnopqrstuvwxyz1234567890");
  assert.doesNotMatch(value, /sk-/);
  assert.doesNotMatch(value, /abcdefghijklmnopqrstuvwxyz1234567890/);
});

test("pipeline generates exactly one infographic after the explanation", async (t) => {
  const bodies = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      bodies.push(JSON.parse(raw));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ b64_json: png }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const output = await mkdtemp(path.join(tmpdir(), "douyin-one-image-"));
  const analysisFile = path.join(output, "analysis.json");
  await writeFile(analysisFile, JSON.stringify(sampleAnalysis()), "utf8");
  const address = server.address();
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "--transcript", fixture,
    "--analysis-file", analysisFile,
    "--out-dir", output,
  ], {
    env: {
      ...process.env,
      IMAGE_API_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      IMAGE_API_KEY: "test-only-key",
      IMAGE_MODEL: "mock-image-model",
      TEXT_API_BASE_URL: "",
      TEXT_API_KEY: "",
      TEXT_MODEL: "",
    },
    encoding: "utf8",
  });

  assert.match(stdout, /IMAGES_GENERATED=1/);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].n, 1);
  assert.match(bodies[0].prompt, /Agent 四层记忆架构/);
  assert.doesNotMatch(bodies[0].prompt, /no text/i);

  const digest = JSON.parse(await readFile(path.join(output, "digest.json"), "utf8"));
  assert.equal(digest.visualSummary.status, "generated");
  assert.equal("visualCards" in digest, false);
  const markdown = await readFile(path.join(output, "plain-language.md"), "utf8");
  assert.ok(markdown.indexOf("## 最后记住") < markdown.indexOf("!["));
  assert.ok((await stat(path.join(output, "images", "knowledge-infographic.png"))).size > 20);
  await assert.rejects(stat(path.join(output, "report.html")));
  await assert.rejects(stat(path.join(output, "report.md")));
});

test("text API returns the version 2 structure", async (t) => {
  const requests = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      requests.push(JSON.parse(raw));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(sampleAnalysis()) } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const output = await mkdtemp(path.join(tmpdir(), "douyin-text-v2-"));
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "--transcript", fixture,
    "--out-dir", output,
    "--image-mode", "none",
  ], {
    env: {
      ...process.env,
      TEXT_API_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      TEXT_API_KEY: "text-test-key",
      TEXT_MODEL: "mock-text-model",
      IMAGE_API_KEY: "",
      LCONAI_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    encoding: "utf8",
  });
  assert.match(stdout, /ANALYSIS_MODE=api/);
  assert.equal(requests.length, 1);
  const digest = JSON.parse(await readFile(path.join(output, "digest.json"), "utf8"));
  assert.equal(digest.version, 2);
  assert.ok(digest.visualSummary.hanCount <= 550);
});

test("provided analysis is used without a text API", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "douyin-provided-v2-"));
  const analysisFile = path.join(output, "analysis.json");
  await writeFile(analysisFile, JSON.stringify(sampleAnalysis()), "utf8");
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "--transcript", fixture,
    "--analysis-file", analysisFile,
    "--out-dir", output,
    "--image-mode", "none",
  ], {
    env: {
      ...process.env,
      TEXT_API_BASE_URL: "",
      TEXT_API_KEY: "",
      TEXT_MODEL: "",
      IMAGE_API_KEY: "",
      LCONAI_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    encoding: "utf8",
  });
  assert.match(stdout, /ANALYSIS_MODE=provided/);
  const digest = JSON.parse(await readFile(path.join(output, "digest.json"), "utf8"));
  assert.equal(digest.title, "Agent 四层记忆架构");
  assert.equal(digest.visualSummary.status, "skipped");
});

test("transcript-only mode stops before analysis and image configuration", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "douyin-transcript-only-"));
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "--transcript", fixture,
    "--out-dir", output,
    "--transcript-only",
  ], {
    env: { ...process.env, IMAGE_API_KEY: "", LCONAI_API_KEY: "", OPENAI_API_KEY: "" },
    encoding: "utf8",
  });
  assert.match(stdout, /PIPELINE_STAGE=transcript-only/);
  assert.match(stdout, /SOURCE_MODE=provided-transcript/);
  assert.ok((await stat(path.join(output, "transcript.txt"))).size > 100);
  await assert.rejects(stat(path.join(output, "digest.json")));
});

test("dry-run writes clean artifacts without API credentials", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "douyin-dry-v2-"));
  const { stdout } = await execFileAsync(process.execPath, [
    cli,
    "--transcript", fixture,
    "--out-dir", output,
    "--dry-run",
  ], {
    env: { ...process.env, IMAGE_API_KEY: "", LCONAI_API_KEY: "", OPENAI_API_KEY: "" },
    encoding: "utf8",
  });
  assert.match(stdout, /IMAGE_MODE=dry-run/);
  assert.match(stdout, /IMAGES_GENERATED=0/);
  const digest = JSON.parse(await readFile(path.join(output, "digest.json"), "utf8"));
  assert.equal(digest.visualSummary.status, "planned");
  assert.ok((await stat(path.join(output, "plain-language.md"))).size > 100);
  assert.ok((await stat(path.join(output, "image-prompt.md"))).size > 100);
});
