# wiki-compiler

从对话历史中提炼可沉淀知识，默认创建 Wiki 知识草稿，由管理员审核后再合并到正式 Wiki 页面。

## 触发条件

在对话结束后、定时任务执行时，或管理员显式要求整理知识时调用此 Skill。

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| conversation | array | 是 | 对话历史，格式：`[{ "role": "user|assistant", "content": "..." }]` |
| namespace | string | 是 | 目标 Wiki namespace |
| wiki_api_url | string | 否 | Web API 地址，默认 `http://localhost:3000/api` |
| wiki_api_token | string | 否 | 调用 Web API 所需 Bearer token |

## 输出格式

```json
{
  "draft_pages": ["auto/refund-policy.md"],
  "summary": "提炼 1 条知识草稿，等待管理员审核"
}
```

## 使用建议

推荐配合 Scheduled Task 使用：定时整理当天会话，生成知识草稿。管理员在 Web Console 的 Wiki namespace 详情页审核草稿，确认后再写入正式 Markdown 文件并提交 Git commit。

生产环境不建议让脚本直接调用 `wiki_write` 或 `wiki_append` 写入正式 Wiki；如果确实需要直接写入，应由管理员明确修改脚本行为并承担知识质量风险。
