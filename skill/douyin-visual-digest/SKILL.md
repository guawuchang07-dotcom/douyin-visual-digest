---
name: douyin-visual-digest
description: 将抖音分享链接或已有转写稿转换为完整转写、通俗易懂的中文解读和一张带中文正文的知识信息图。首次使用时先引导用户准备生图额度和本地工具。Use when the user sends a Douyin link and asks to提取文案、看懂视频、用大白话解释、生成图文解读，或需要首次安装配置这套流程。
---

# 抖音通俗图解

## 首次启用

首次使用、`.env` 不存在或环境尚未就绪时，必须按下面三阶段执行。阶段之间停下来等待用户确认，不要一次性充值、配置和下载。

### 阶段 1：准备生图账户

先告诉用户：完整流程需要少量生图额度。引导其打开：

`https://downstream.jbbtoken.cn/i/BuFB`

让用户依次完成注册或登录、充值少量额度、创建 API Key，并在控制台确认真实的 API Base URL 和模型名。邀请链接不能作为 API Base URL；该链接可能为项目作者带来推广收益。

不要让用户把 API Key 粘贴到聊天中。让用户完成后回复“生图账户已准备好”，然后停止并等待。

收到确认后，引导用户在本机终端运行：

```powershell
& "<Skill目录>\scripts\configure.ps1" -SkipText
```

配置脚本会隐藏密钥输入，并写入被 Git 忽略的 `.env`。用户确认配置完成后再进入阶段 2。

### 阶段 2：检查本地工具

运行：

```powershell
& "<Skill目录>\scripts\doctor.ps1"
```

读取 `MISSING_TOOLS`、`TOOLS_READY`、`IMAGE_API_READY` 和 `READY`：

- `IMAGE_API_READY=False`：返回阶段 1，不要处理视频。
- `MISSING_TOOLS` 非空：逐项告诉用户缺少什么，并询问“是否现在下载并安装这些工具？”然后停止等待。
- 未经用户明确同意，不要运行 `setup.ps1`、`winget` 或下载模型。
- 用户同意后运行 `scripts/setup.ps1 -ModelName base`。脚本会安装 `playwright-core`、FFmpeg、Whisper 和模型；浏览器只使用 Skill 专用配置目录，不读取个人浏览器 Cookie。
- 安装结束后重新运行 `doctor.ps1`，不能根据下载命令成功就直接宣称准备完成。

### 阶段 3：确认就绪

只有 `READY=True` 时才回复：

> 准备完毕。以后直接把抖音分享链接发给我即可，我会生成通俗解释稿和一张中文知识信息图。

然后等待用户发送链接。后续使用若 `READY=True`，跳过首次启用流程，直接执行标准流程。

## 默认结果

用户只需发送一次抖音分享链接。最终回复必须**严格按下面顺序一次性交付**，不允许省略、颠倒或只给路径：

1. **直接贴出完整通俗解释稿正文**（不是摘要、不是链接、不是"已生成见文件"）。Markdown 排版固定为：
   - 一级标题：`<视频主题>：通俗解释稿`
   - `## 这段视频到底在讲什么`：一段 overview
   - `## 逐个讲明白`：每个关键点一个 `### 小标题`，正文为 explanation，末尾加 `**举个例子：**` + 具体例子
   - `## 最后记住`：一句 takeaway
2. **紧跟其后展示知识信息图**：优先调用平台的文件/图片展示能力；若聊天环境无法内嵌图片，必须先把图片复制到用户当前工作区根目录（命名 `knowledge-infographic.png`），再给出该绝对路径与打开方式。图片没展示成功就不算完成交付。
3. **最后简短附上**原始转写与输出目录的绝对路径，方便核对。

不要默认贴逐字稿；用户明确要求时再提供。解释稿不能冒充逐字稿。

## 快速复查

运行：

```powershell
& "$PSScriptRoot\scripts\doctor.ps1"
```

- `READY=True`：可以直接处理链接。
- `READY=False`：返回“首次启用”，按阶段完成配置与工具安装。
- 不要让用户在聊天中粘贴 API Key，也不要在日志、提示词或回复中显示密钥。

## 标准流程

### 1. 获取转写

```powershell
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -InputText "<抖音分享文本或链接>" -TranscriptOnly
```

读取终端中的 `TRANSCRIPT`。

同时读取 `SOURCE_MODE`：

- `audio-asr`：已通过专用浏览器取得媒体并完成 Whisper 转写，可作为完整机器转写使用。
- `page-chapters`：媒体获取或转写失败，当前内容来自抖音页面章节摘要；必须明确标注“非逐字转写”，不能把它说成完整原稿。
- `provided-media`：用户提供了本地视频或音频，已完成 Whisper 转写。
- `provided-transcript`：用户直接提供了已有转写稿。

获取顺序由脚本自动处理：专用无痕浏览器会话 -> 本地 Whisper -> 旧 `dyt.exe` 兼容后备 -> 页面章节摘要。不要默认读取个人 Edge/Chrome Cookie，也不要要求用户关闭浏览器或导出 Cookie。

### 2. 生成解释 JSON

读取 [references/output-schema.md](references/output-schema.md)，用当前 Codex 模型生成 UTF-8 JSON。核心字段只有：

- `title`
- `plainLanguage.overview`
- `plainLanguage.keyIdeas[].heading/explanation/example`
- `plainLanguage.takeaway`
- `visualSummary.title/coreReason/sections[].heading/body/conclusion/visualDirection`

通俗解释必须说明视频解决的问题、专业词含义、核心逻辑和具体例子，不得虚构原视频没有支持的事实。

### 3. 生成单张知识图

```powershell
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -Transcript "<TRANSCRIPT 路径>" -AnalysisFile "<解释 JSON 路径>"
```

默认 `ImageMode=api`，程序只请求一张图片。

## 固定生图规则

- 只生成一张正文知识图，不生成封面，不拆成多图，不生成无字概念图。
- 图片正文先经过视觉压缩：目标 `480-500` 个汉字，硬上限 `550` 个汉字。
- 超过 `550` 字时继续压缩，不自动拆图。
- 保留核心概念、逻辑关系、步骤、必要例子和结论；删除重复铺垫、口语停顿和不影响理解的细节。
- 让生图模型根据内容自行选择版式和视觉隐喻，但图片中的中文只来自 `visualSummary`。
- 画面应像专业编辑信息图，不像 PPT；文字与图形共同解释内容。

生成后目视检查：标题、数字、层级名、关键术语和结论必须正确。最多接受一两处不影响理解的非关键轻微乱码；关键内容错误或大段不可读时，压缩或修正提示词后重试一次。

## 交付

读取终端输出：

- `PLAIN_LANGUAGE`：通俗解释稿
- `INFOGRAPHIC`：单张知识图
- `TRANSCRIPT`：原始转写
- `DIGEST_JSON`：结构化数据

回复中先读取并贴出 `PLAIN_LANGUAGE` 正文，再用 `INFOGRAPHIC` 的绝对路径显示图片。明确说明实际 `IMAGE_TEXT_HAN` 和 `IMAGES_GENERATED=1`。

## 图片展示策略（多环境适配）

知识图是必交付物，必须让用户真正看到，不同环境方式不同：

- **支持文件卡片/附件的客户端**（如 WorkBuddy 的 present_files、支持图片内嵌的界面）：调用展示工具，同时仍给出图片绝对路径。
- **终端型聊天不渲染图片的客户端**（如纯 CLI）：把 `knowledge-infographic.png` 复制到用户当前工作区根目录，回复给出绝对路径并说明打开方式（如双击/`Start-Process`）。
- **兜底**：无论哪种环境，回复中都必须包含图片绝对路径。不要把图片路径藏在 Markdown 图片语法里假装已展示——用户看不到就算未交付。

## 交付自查清单（每次回复前逐项核对）

- [ ] 通俗解释稿完整正文已直接贴出（含 overview / 各关键点+例子 / takeaway）
- [ ] 知识图已展示：要么平台内嵌成功，要么已复制到工作区根目录并给出可打开路径
- [ ] `TRANSCRIPT` 与 `OUTPUT_DIR` 绝对路径已附上
- [ ] 已注明 `IMAGE_TEXT_HAN` 与 `IMAGES_GENERATED=1`
- [ ] 未在回复中粘贴 API Key 或密钥

## 其他入口

已有转写稿：

```powershell
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -Transcript "<转写文件>" -AnalysisFile "<解释 JSON>"
```

本地视频或音频：

```powershell
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -MediaFile "<本地媒体文件>" -TranscriptOnly
```

只测试接口：

```powershell
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -TestImageApi
& "$PSScriptRoot\scripts\run-douyin-visual-digest.ps1" -TestTextApi
```

脱离 Codex 的无人值守模式可配置文本 API，见 [references/api-configuration.md](references/api-configuration.md)。

## 安全

- 不输出或提交 `.env`、`.runtime/`、`outputs/`。
- 不在回复、日志、JSON、提示词或文档中暴露 API Key。
- 原始转写始终单独保存，便于核对解释是否偏离原视频。
