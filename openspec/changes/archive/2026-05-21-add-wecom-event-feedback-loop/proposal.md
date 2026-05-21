## 为什么

企业微信智能机器人新增的事件回调能力让平台可以捕获进入会话、模板卡片交互和用户反馈。当前项目已经具备 Bot 会话、Wiki 检索日志、无命中治理和知识草稿审核能力，但用户反馈还无法和某次机器人回复、当时检索到的 Wiki 文档、后续知识修复动作串起来。

这次变更的机会是把 `feedback_event` 从简单日志升级为“机器人回答质量闭环”：负反馈驱动 Wiki 修正、检索策略调优和回归评测，正反馈沉淀高置信标准问答，让知识库随真实使用持续演进。

## 变更内容

- 新增企微事件接入通道，识别并排重 `enter_chat`、`template_card_event`、`feedback_event` 等事件，事件不得误入普通 Agent 对话队列。
- 新增机器人回复追踪能力，为每次可反馈的回复建立 `feedback_id` / response run 记录，并关联用户问题、机器人答案、Context、Session、Wiki 检索日志和企业微信事件元数据。
- 新增 Wiki 反馈运营能力，将用户反馈聚合到 Wiki 工作台，支持分流为“转知识草稿、标记检索问题、标记模型/工具问题、忽略”。
- 新增标注答案路径，对高频、强确定性、人工审核过的问题答案提供确定性命中机制，作为 Wiki/RAG 之前的高置信快捷路径。
- 扩展现有 Wiki 草稿来源类型，支持从用户反馈生成待审核草稿，并保留可追溯来源。
- 扩展现有 Wiki 检索观测，让反馈复盘可以看到当次回答实际使用的 query、命中文档、耗时和错误。
- 扩展会话/消息存储，让用户反馈可以定位到具体的一轮问答，而不是只能定位到 chatKey。

## 功能 (Capabilities)

### 新增功能

- `wecom-event-ingestion`: 企微事件接入、事件排重、事件路由、快速响应和事件审计。
- `bot-response-tracing`: 机器人回复追踪，关联反馈 ID、用户问题、机器人答案、Context、Session、检索日志和平台消息元数据。
- `wiki-feedback-ops`: Wiki 反馈运营工作台，支持反馈分流、转草稿、状态跟踪和运营指标。
- `annotation-answer-path`: 人工审核的标注答案路径，用于高频确定性问题的稳定回复。

### 修改功能

- `wiki-knowledge-review`: 知识草稿必须支持 `feedback-event` 来源，并在审核时展示反馈上下文。
- `wiki-retrieval-policy`: 检索日志必须能被回复追踪引用，用于反馈复盘和检索问题归因。
- `session-management`: 会话消息必须支持与回复追踪记录关联，便于从反馈反查原始问答。

## 影响

- `packages/core/src/wecom-adapter.ts`: 事件解析和消息/事件路由边界。
- `apps/api/src/bot-manager/bot-instance.ts`: 回复追踪创建、反馈 ID 注入、检索日志关联和事件处理入口。
- `apps/api/src/db/client.ts`: 新增事件、回复追踪、反馈处理、标注答案等持久化表，并扩展草稿/检索日志关联字段。
- `apps/api/src/routes/wiki.ts`: 扩展 Wiki 草稿、反馈运营和指标 API。
- `apps/api/src/routes/*`: 可能新增事件/反馈/标注答案管理 API。
- `apps/web/src/pages/WikiPage.tsx`: 新增反馈工作台、反馈详情、转草稿和反馈指标。
- `packages/types/src/index.ts`: 新增事件、回复追踪、反馈、标注答案相关共享类型。
- 企业微信配置：需要机器人接收消息 URL 支持加密回调事件；模板卡片与反馈信息需要在回复中携带可追踪 ID。
