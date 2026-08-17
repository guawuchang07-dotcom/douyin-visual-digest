# API 配置

## 生图 API

完整流程需要一个兼容 OpenAI `POST /images/generations` 的生图接口。推荐注册入口：

`https://downstream.jbbtoken.cn/i/BuFB`

首次使用时先打开该地址，注册或登录后充值少量额度、创建 API Key，再从控制台确认真实的 API Base URL 和模型名。邀请链接不能作为 API Base URL；项目作者可能从该链接产生的消费中获得推广收益。

不要在聊天中发送 API Key。完成账户准备后，在本机终端运行配置脚本；交互式密钥输入不会显示在屏幕上：

运行：

```powershell
.\scripts\configure.ps1 -SkipText
```

配置字段：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `IMAGE_API_BASE_URL` | 无 | 生图 API 根地址 |
| `IMAGE_API_KEY` | 无 | 服务端密钥 |
| `IMAGE_MODEL` | `gpt-image-2` | 图像模型 |
| `IMAGE_SIZE` | `1024x1024` | 请求尺寸；中转可能返回不同实际尺寸 |
| `IMAGE_RESPONSE_FORMAT` | `b64_json` | 兼容服务拒绝时程序自动去掉后重试 |
| `IMAGE_QUALITY` | 无 | 仅在服务商支持时传递 |
| `IMAGE_REQUEST_TIMEOUT_MS` | `360000` | 单张图超时毫秒数 |

程序始终发送 `n: 1`，只保存一张知识图。接口响应支持 `b64_json` 或图片 URL。

配置后运行：

```powershell
.\scripts\doctor.ps1
```

只有 `IMAGE_API_READY=True` 且 `READY=True` 时，才能向用户宣布准备完成。

## 文本解释

在 Codex 中使用时，不需要额外文本 API。Codex 读取转写稿并按照 [output-schema.md](output-schema.md) 生成解释 JSON。

只有脱离 Codex 的无人值守 CLI 模式才需要：

| 字段 | 说明 |
| --- | --- |
| `TEXT_API_BASE_URL` | 文本 API 根地址 |
| `TEXT_API_KEY` | 文本 API 密钥 |
| `TEXT_MODEL` | 文本模型名称 |
| `TEXT_REQUEST_TIMEOUT_MS` | 默认 `120000` |

缺少文本 API 时，CLI 会使用本地规则解释；质量低于 Codex 模式。

## 安全

- 系统环境变量优先于 `.env`。
- `-EnvFile` 可指定其他配置文件。
- `.env` 已被 Git 忽略。
- 不在命令、聊天、日志、报告或 JSON 中粘贴或输出 API Key。

测试生图连接：

```powershell
.\scripts\run-douyin-visual-digest.ps1 -TestImageApi
```
