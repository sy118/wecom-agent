## 1. 数据库 Schema 迁移

- [x] 1.1 在 `apps/api/src/db/schema.ts` 的 `bots` 表新增字段：`provider`（默认 `openai-compatible`）、`streamingMode`（默认 `none`）、`difyBaseUrl`、`difyApiKey`、`difyAppId`、`visionEnabled`（默认 `false`）
- [x] 1.2 在 `apps/api/src/db/schema.ts` 新增 `scheduled_tasks` 表：`id`、`botId`、`name`、`cronExpr`、`promptTemplate`、`targetChatKey`、`targetChatId`（企业微信原始 chatId）、`targetChatName`、`contextId`（可选，为空用 defaultContext）、`enabled`、`lastRunAt`、`nextRunAt`、`createdAt`、`updatedAt`
- [x] 1.3 在 `apps/api/src/db/client.ts` 执行 Drizzle 迁移，确保存量数据兼容（新字段有默认值）

## 2. 多 LLM Provider — AgentEngine 重构

- [x] 2.1 安装 `@langchain/anthropic` 依赖到 `packages/core/package.json`
- [x] 2.2 修改 `packages/core/src/agent-engine.ts`：根据 `provider` 字段实例化对应 Chat 类（`openai-compatible` → `ChatOpenAI`，`anthropic` → `ChatAnthropic`）
- [x] 2.3 修改 `AgentEngineConfig` 类型，新增 `provider` 字段，更新 `packages/types` 中的 `BotConfig` 类型

## 3. Dify Provider — DifyClient 实现

- [x] 3.1 在 `packages/core/src/` 新建 `dify-client.ts`：实现 `DifyClient` 类，封装 `POST /v1/chat-messages`（blocking 模式），30s 超时，返回 `{ answer, conversationId }`
- [x] 3.2 修改 `apps/api/src/bot-manager/bot-instance.ts`：在 `handleMessage` 中根据 `provider` 分支，`dify` 路径调用 `DifyClient.chat()`，跳过 AgentEngine 初始化
- [x] 3.3 修改 `packages/core/src/session-store.ts` 的 Session 类型：新增可选字段 `difyConversationId?: string`；Dify 路径下 `messages` 保持空数组，`difyConversationId` 存储 Dify 会话 ID；TTL 清理逻辑无需感知 provider
- [x] 3.4 修改 `BotInstance.start()`：`provider=dify` 时跳过 MCP 工具加载和 AgentEngine 初始化，验证 `difyBaseUrl` 和 `difyApiKey` 非空

## 4. 流式回复 — WecomAdapter editMessage 实现

- [x] 4.1 调查 `@wecom/aibot-node-sdk` WSClient 是否暴露消息更新方法（查源码或文档），记录结论
- [x] 4.2 修改 `packages/core/src/wecom-adapter.ts`：实现 `editMessage(chatId, msgId, text)`，调用 WSClient 对应方法；若不支持则 throw 明确错误
- [x] 4.3 修改 `apps/api/src/bot-manager/bot-instance.ts`：实现 `progressive` 模式逻辑——改 thinking 消息的 sendMessage 调用方式以获取返回的 `msgId`（去掉 `.catch(() => {})` 吞返回值），LLM 完成后用 `msgId` 调 editMessage，失败则 fallback sendMessage
- [x] 4.4 修改 `apps/api/src/bot-manager/bot-instance.ts`：实现 `typewriter` 模式逻辑（LLM streaming 开启 → 每 800ms editMessage 更新 → LLM 完成后最后一次 editMessage 写入完整内容，不再 sendMessage 新消息）

## 5. 定时任务系统 — 后端

- [x] 5.1 安装 `node-cron` 和 `cron-parser` 依赖到 `apps/api/package.json`（`cron-parser` 用于计算 `next_run_at`）
- [x] 5.2 在 `apps/api/src/db/` 新建 `scheduled-task-repository.ts`：实现 `findAll(botId)`、`findById`、`create`、`update`、`delete`
- [x] 5.3 在 `apps/api/src/` 新建 `scheduler/task-scheduler.ts`：构造函数接收 `BotManager` 引用（单向依赖，BotManager 不持有 TaskScheduler），封装 `node-cron` 注册/取消逻辑，`registerTask(task)`、`unregisterTask(taskId)`、`loadFromDb()` 方法；任务触发时解析 `contextId`（为空取 defaultContext），用 `targetChatId` 调 sendMessage
- [x] 5.4 修改 `apps/api/src/index.ts`：按顺序初始化——先 BotManager，再 `new TaskScheduler(botManager)`，再 `taskScheduler.loadFromDb()`，最后启动 Express
- [x] 5.5 在 `apps/api/src/routes/` 新建 `scheduled-tasks.ts`：实现 GET/POST/PUT/DELETE `/api/bots/:botId/scheduled-tasks` 路由，增删改时同步更新 scheduler
- [x] 5.6 在 `apps/api/src/index.ts` 注册 `scheduled-tasks` 路由

## 6. 前端 — Bot 配置表单更新

- [x] 6.1 修改 `apps/web/src/pages/BotsPage.tsx`：Bot 创建/编辑 Modal 新增 `provider` 下拉（openai-compatible / anthropic / dify）和 `streamingMode` 下拉（none / progressive / typewriter）
- [x] 6.2 修改 `apps/web/src/pages/BotsPage.tsx`：根据 `provider` 值条件显示字段（dify 时显示 difyBaseUrl/difyApiKey/difyAppId，隐藏 llmBaseUrl/llmModel）
- [x] 6.3 修改 `apps/web/src/api/` 相关 client：更新 Bot 类型定义，包含新增字段

## 7. 前端 — allowedProjects 动态化

- [x] 7.1 修改 `apps/web/src/pages/ContextsPage.tsx`：将 `allowedProjects` 的 `Select` 组件改为 `mode="tags"`，移除硬编码的 15 个选项，支持用户自由输入

## 8. 前端 — 定时任务页面

- [x] 8.1 在 `apps/web/src/pages/` 新建 `ScheduledTasksPage.tsx`：展示任务列表（名称、cron 表达式、目标群、启用状态、上次执行时间）
- [x] 8.2 实现定时任务创建/编辑 Modal：包含名称、promptTemplate 文本域、targetChatKey + targetChatId 输入（群 ID 和内部 key 同时填写）、contextId 下拉（可选，为空用 defaultContext）、enabled 开关
- [x] 8.3 在 Modal 中集成 `react-js-cron` 组件作为可视化 Cron 编辑器，实时预览下次执行时间，输出标准 cron 字符串；安装 `react-js-cron` 到 `apps/web/package.json`
- [x] 8.4 在 `apps/web/src/api/` 新增 scheduled-tasks API client 方法
- [x] 8.5 在 `apps/web/src/` 路由配置中注册 ScheduledTasksPage，在侧边栏新增"定时任务"入口

## 9. 集成验证

- [ ] 9.1 验证存量 Bot 数据在新 schema 下正常读取（provider 默认值、streamingMode 默认值、visionEnabled 默认值）
- [ ] 9.2 验证 progressive 模式：发消息 → 看到思考中 → 思考中被替换为回复（或 fallback 为新消息）
- [ ] 9.3 验证 Dify provider：配置 Dify Bot → 发消息 → 收到 Dify 工作流回复 → 多轮对话 conversation_id 正确传递
- [ ] 9.4 验证定时任务：创建任务 → 等待 cron 触发 → 目标群收到推送 → last_run_at 更新
- [ ] 9.5 验证 allowedProjects 自由输入：输入新项目名 → 保存 → 重新打开显示正确
- [ ] 9.6 验证多模态（visionEnabled=true）：发图片 → LLM 收到图片 URL → 回复图片内容描述
- [ ] 9.7 验证多模态降级（visionEnabled=false）：发图片 → LLM 收到 [图片] 文本 → 行为与 v1 一致

## 10. 多模态 — 核心实现

- [x] 10.1 修改 `packages/types/src/index.ts`：`SessionMessage.content` 类型改为 `string | IncomingContent[]`
- [x] 10.2 修改 `packages/core/src/agent-engine.ts`：`invokeWithPrompt` 的 `newContent` 参数改为 `string | IncomingContent[]`；构建 HumanMessage 时，数组类型转为 LangChain 多模态格式 `{ type: 'image_url', image_url: { url } }`；Session 历史重建同理
- [x] 10.3 修改 `apps/api/src/bot-manager/bot-instance.ts`：根据 `visionEnabled` 决定是否透传 `IncomingContent[]`；`visionEnabled=false` 时将数组降级为 `[图片]` 文本；捕获 LLM 400/422 错误，fallback 为 `[图片: <url>]` 纯文本重试
- [x] 10.4 修改 `packages/core/src/dify-client.ts`：`chat()` 方法支持 `content: string | IncomingContent[]` 入参；图片 URL 转为 `files` 数组 `{ type: 'image', transfer_method: 'remote_url', url }` 传给 Dify API
- [x] 10.5 修改 `apps/web/src/pages/BotsPage.tsx`：Bot 编辑 Modal 新增 `visionEnabled` 开关，标注"需要视觉模型支持"
