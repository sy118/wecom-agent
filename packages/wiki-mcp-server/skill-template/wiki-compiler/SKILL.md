---
name: wiki-compiler
description: 从对话历史中提炼可沉淀知识，并创建待管理员审核的 Wiki 草稿。适用于会话结束、定时整理或管理员要求沉淀知识时。
license: MIT
compatibility: 需要可访问 wiki-mcp-server Web API。
metadata:
  author: jiuji
  version: "1.0.0"
---

从对话历史中提炼稳定、可复用、适合沉淀的知识，并默认写入 Wiki 草稿区，等待管理员审核后再合并到正式 Wiki 页面。

## 触发条件

在以下场景使用本 Skill：

- 对话结束后，需要从当天或本轮会话中整理可复用知识
- 定时任务批量整理历史会话
- 管理员显式要求“整理知识”“沉淀 Wiki”“生成 Wiki 草稿”
- 需要把问答、排障经验、业务规则或操作规范转成待审核 Wiki 草稿

不要在以下场景使用本 Skill：

- 只需要回答用户当前问题，不需要沉淀知识
- 信息明显是临时状态、一次性任务进度或未验证猜测
- 内容包含密钥、令牌、个人敏感信息或不应进入知识库的数据
- 管理员未明确授权直接写入正式 Wiki 页面

## 输入参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `conversation` | array | 是 | - | 对话历史，格式：`[{ "role": "user|assistant", "content": "..." }]` |
| `namespace` | string | 否 | `general` | 目标 Wiki namespace |
| `wiki_api_url` | string | 否 | `http://localhost:3000/api` | wiki-mcp-server Web API 地址 |
| `wiki_api_token` | string | 否 | - | 调用 Web API 所需 Bearer token |

## 行为规范

1. 只提炼已经在对话中明确出现、具备复用价值的知识。
2. 默认创建草稿，不直接修改正式 Wiki 页面。
3. 草稿路径使用 `auto/<timestamp>-<slug>.md`。
4. 草稿内容保留原始问答上下文，方便管理员审核。
5. 如果没有可沉淀知识，返回空草稿列表。
6. 如果某条草稿创建失败，继续处理后续草稿，并将失败原因写入 stderr。

## 输出格式

成功创建草稿时输出：

```json
{
  "draft_pages": ["auto/1710000000000-refund-policy.md"],
  "summary": "提炼 1 条知识草稿到 namespace \"general\"，等待管理员审核"
}
```

无可沉淀知识时输出：

```json
{
  "draft_pages": [],
  "summary": "无新知识草稿"
}
```

执行失败时输出：

```json
{
  "draft_pages": [],
  "summary": "错误: <reason>"
}
```

## 使用建议

推荐配合 Scheduled Task 使用：定时整理当天会话，生成知识草稿。管理员在 Web Console 的 Wiki namespace 详情页审核草稿，确认后再写入正式 Markdown 文件并提交 Git commit。

生产环境不建议让脚本直接调用 `wiki_write` 或 `wiki_append` 写入正式 Wiki；如果确实需要直接写入，应由管理员明确修改脚本行为并承担知识质量风险。
