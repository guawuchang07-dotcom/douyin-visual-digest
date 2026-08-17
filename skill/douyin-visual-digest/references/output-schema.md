# 输出结构

`digest.json` 使用下面的稳定结构：

```json
{
  "version": 2,
  "title": "视频主题",
  "plainLanguage": {
    "overview": "这段视频解决什么问题，核心结论是什么",
    "keyIdeas": [
      {
        "heading": "观点标题",
        "explanation": "不用行业黑话的解释",
        "example": "具体工作、学习或生活例子"
      }
    ],
    "takeaway": "读者最后只需要记住的一句话"
  },
  "visualSummary": {
    "title": "图片标题",
    "coreReason": "一段核心说明",
    "sections": [
      {
        "heading": "模块或步骤",
        "body": "它做什么、为什么这样做、解决什么问题"
      }
    ],
    "conclusion": "收束结论",
    "visualDirection": "画面结构、视觉隐喻和关系表达建议"
  }
}
```

## 通俗解释

- `overview` 解释问题背景和核心结论，不重复标题。
- `explanation` 面向没有专业背景的读者，专业词首次出现时顺手解释。
- `example` 必须具体，不能只写“例如在工作中使用”。
- 不增加原视频没有支持的事实、数字或结论。

## 视觉压缩

- `visualSummary` 只服务一张正文知识图。
- `title + coreReason + sections + conclusion` 的中文正文目标为 `480-500` 个汉字，绝对不能超过 `550` 个汉字。
- `sections` 使用 `2-6` 项。每项同时保留“做什么、原因、解决什么”中的必要信息。
- 删除重复口语、过渡句和逐字稿细节，但不能删除核心概念、逻辑关系、关键步骤、必要例子和结论。
- `visualDirection` 不计入图片正文字数，只描述适合主题的版式、物件、场景、流程或层级关系。
- 不提供图片数量或多图分镜字段。

原始转写始终单独保存在 `transcript.txt`，解释稿和视觉摘要不能替代逐字稿。
