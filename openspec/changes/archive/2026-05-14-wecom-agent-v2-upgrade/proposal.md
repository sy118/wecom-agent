## 为什么

wecom-agent 当前版本已完成平台化基础建设，但 LLM 接入单一（仅 OpenAI 兼容接口）、回复体验差（等待全量生成后才发送）、allowedProjects 硬编码无法自定义、缺乏主动推送能力。随着团队已有 Dify 工作流资产、业务对定时播报有需求，需要在现有架构上做一次有针对性的能力升级。

## 变更内容

- **新增** Bot 级别流式回复配置（`streamingMode`）：支持 `none`（现有行为）、`progressive`（edit 替换思考中消息）、`typewriter`（每 800ms 更新一次）三种模式
- **新增** Dify provider 支持：Bot 配置新增 `provider` 字段，`dify` 模式下通过 HTTP 调用 Dify `/v1/chat-messages` API，复用现有 SessionStore 存储 `conversation_id`
- **修改** allowedProjects 从前端硬编码 15 个项目名改为动态配置，用户可在 UI 自由增删
- **新增** 定时任务系统：新增 `scheduled_tasks` 表，支持 Cron 表达式触发，LLM 生成内容后推送到指定 chatKey，前端提供可视化 Cron 编辑器
- **新增** 多 LLM provider 配置：在现有 `baseUrl + model` 基础上新增 `provider` 枚举（`openai-compatible`、`anthropic`、`dify`），LangChain 根据 provider 选择对应 Chat 模型类
- **新增** 多模态消息支持：图片和图文混合消息透传给 LLM（视觉模型），语音消息继续使用 WeCom ASR 转写文本，Session 历史支持存储结构化内容

## 功能 (Capabilities)

### 新增功能

- `streaming-reply`: Bot 级别流式回复，支持 progressive 和 typewriter 两种模式，通过 WecomAdapter editMessage 实现消息更新
- `dify-provider`: Dify 工作流接入，作为独立 provider 与 LangChain 路径并存，HTTP 转发消息并管理 Dify conversation_id
- `scheduled-tasks`: 定时任务系统，Cron 触发 + LLM 生成 + 企业微信推送，含前端可视化编辑器
- `multimodal`: 图片和图文混合消息透传给视觉 LLM，Session 历史支持结构化内容存储

### 修改功能

- `bot-config`: Bot 配置新增 `provider`、`streamingMode` 字段；allowedProjects 从前端硬编码改为数据库动态存储（Context 表已有 `allowedProjects` JSON 字段，改为 UI 可自由编辑）

## 影响

- `packages/core/src/agent-engine.ts`：新增 provider 分支，Dify 路径绕过 LangChain；invokeWithPrompt 支持 IncomingContent[] 入参
- `packages/core/src/wecom-adapter.ts`：实现 `editMessage`（调用 WSClient update 方法）
- `packages/core/src/session-store.ts`：SessionMessage.content 改为 `string | IncomingContent[]`
- `packages/types/src/index.ts`：IncomingContent 类型已有，SessionMessage 类型扩展
- `apps/api/src/db/schema.ts`：新增 `scheduled_tasks` 表；`bots` 表新增 `provider`、`streamingMode` 字段
- `apps/api/src/bot-manager/bot-instance.ts`：流式回复逻辑、定时任务触发逻辑、多模态内容透传
- `apps/api/src/routes/`：新增 `/api/bots/:id/scheduled-tasks` 路由
- `apps/web/src/pages/`：BotsPage 新增 provider/streamingMode 字段；ContextsPage allowedProjects 改为动态输入；新增 ScheduledTasksPage
