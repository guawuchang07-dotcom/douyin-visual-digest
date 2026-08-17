# Douyin Visual Digest

把一条抖音分享链接转换成：

1. 视频语音转写；
2. 通俗易懂的中文解释稿；
3. 一张带中文正文的知识信息图。

项目以 Codex Skill 的形式工作。首次使用时，Skill 会先引导用户准备生图额度，再检测 Node.js、FFmpeg、Whisper、模型和抖音解析工具。发现缺失项后会先询问是否下载，全部检查通过后才提示发送抖音链接。

## 安装

### 让 Codex 安装

把下面这句话发给 Codex：

```text
请从这个 GitHub 地址安装 Skill：
https://github.com/guawuchang07-dotcom/douyin-visual-digest/tree/main/skill/douyin-visual-digest
```

### 本地安装

```powershell
git clone https://github.com/guawuchang07-dotcom/douyin-visual-digest.git
cd douyin-visual-digest
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后，在新的 Codex 对话中发送：

```text
使用 $douyin-visual-digest，帮我完成首次配置。
```

## 首次启用

完整流程需要一个兼容 OpenAI 图片生成接口的生图账户。

1. 打开 [生图服务入口](https://downstream.jbbtoken.cn/i/BuFB)。
2. 注册或登录，充值少量额度并创建 API Key。
3. 按 Skill 引导，在本机终端配置 API Base URL、模型名和 API Key。
4. 不要在聊天、Issue 或截图中公开 API Key。
5. 等待 Skill 检测本地工具，并在询问后决定是否下载安装。

只有检测结果为 `READY=True` 时，Skill 才会提示准备完成。

## 使用

准备完成后，直接发送抖音分享文本或链接，例如：

```text
https://v.douyin.com/xxxxxxxx/
```

默认输出顺序：

1. 通俗解释稿；
2. 一张中文知识信息图；
3. 原始转写和本地输出路径。

逐字稿默认不会直接贴出，明确要求时才提供。

## 工作流程

```text
抖音链接
  -> 下载音轨
  -> 本地 Whisper 转写
  -> Codex 整理通俗解释
  -> 压缩为 480-500 个汉字的视觉摘要
  -> 生成一张中文知识信息图
```

## 环境

- Windows x64
- Node.js 18 或更高版本
- FFmpeg
- whisper.cpp
- Whisper `base` 模型
- 兼容 OpenAI `POST /images/generations` 的生图接口

`vendor/dyt.exe` 来自 [vangie/douyin-transcriber](https://github.com/vangie/douyin-transcriber)，许可证见 Skill 内的第三方声明。

## 安全

- 仓库不包含任何真实 API Key。
- `.env`、`.runtime`、`outputs` 和日志均被 Git 忽略。
- 每位使用者需要配置自己的生图账户。
- 生图服务入口可能为项目作者带来推广收益。

## 已知限制

抖音网页结构可能随时变化。页面发生变化时，音轨下载器可能暂时无法解析新链接，需要更新解析逻辑。解释稿不能冒充逐字转写；降级使用页面章节摘要时必须明确说明来源。

## 开发验证

```powershell
cd .\skill\douyin-visual-digest
npm run check
npm test
```

## License

[MIT](LICENSE)
