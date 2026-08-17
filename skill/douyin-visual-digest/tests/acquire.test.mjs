import assert from "node:assert/strict";
import test from "node:test";

import { formatChapterText, selectMediaUrls } from "../scripts/acquire-douyin.mjs";

test("chapter fallback is explicitly labeled as non-verbatim", () => {
  const text = formatChapterText({
    desc: "测试视频",
    chapter_abstract: "这是摘要。",
    chapter_list: [{ timestamp: 65000, desc: "核心方法", detail: "先确认需求，再设计方案。" }],
  });
  assert.match(text, /不是逐字转写/);
  assert.match(text, /\[01:05\] 核心方法/);
  assert.match(text, /先确认需求/);
});

test("media selection prefers H264 and removes duplicates", () => {
  const urls = selectMediaUrls({
    video: {
      play_addr_h264: { url_list: ["https://media.test/a.mp4"] },
      play_addr: { url_list: ["https://media.test/a.mp4", "https://media.test/b.mp4"] },
      bit_rate: [{ is_h265: 1, play_addr: { url_list: ["https://media.test/h265.mp4"] } }],
    },
  });
  assert.deepEqual(urls, ["https://media.test/a.mp4", "https://media.test/b.mp4"]);
});
