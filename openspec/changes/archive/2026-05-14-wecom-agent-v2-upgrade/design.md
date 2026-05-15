## 上下文

wecom-agent v1 已完成平台化（多 Bot、多 Context、MCP 工具、SQLite 持久化），核心运行时基于 LangChain `createAgent` 黑盒调用。当前痛点：LLM 接入单一、回复体验差（全量等待）、allowedProjects 硬编码、无主动推送能力。团队已有 Dify 工作流资产，业务侧有定时播报需求。

约束：
- 内网部署，无公网 IP
- 不引入新的重型依赖（不上 Redis、不上 PostgreSQL）
- 现有 Bot 配置向后兼容（新字段有默认值）
- 企业微信 WSClient editMessage 能力待验证

## 目标 / 非目标

**目标：**
- Bot 级别流式回复（progressive / typewriter），配置化开关
- Dify 作为独立 provider 与 LangChain 路径并存
- allowedProjects 改为 UI 动态配置
- 定时任务系统（Cron + LLM 生成 + 推送）
- 多 LLM provider 枚举（openai-compatible / anthropic / dify）

**非目标：**
- 不做 Ollama 本地模型支持
- 不做会话持久化（重启丢失可接受）
- 不做 Dify 工作流可视化编辑（只做接入）
- 不做定时任务执行历史持久化（Phase 1 只记录 last_run_at）

## 决策

### D1：流式回复 — progressive 优先，typewriter 可选

企业微信 WSClient 是否支持 editMessage 尚未验证。设计上分两层：

```
streamingMode = "none"
  → 现有行为不变（sendMessage 两条：thinking + reply）

streamingMode = "progressive"
  → sendMessage(thinking) 拿到 msgId
  → LLM 完成后 editMessage(msgId, reply)
  → editMessage 失败则 fallback sendMessage(reply)
  → 需要 WecomAdapter.editMessage 实现（调用 WSClient.updateMsg 或等价方法）

streamingMode = "typewriter"
  → 同 progressive，但 LLM 开启 streaming: true
  → 每收到 token 累积，每 800ms 调一次 editMessage 更新消息内容
  → LLM 完成后最后一次 editMessage 写入完整内容（不再 sendMessage 新消息）
  → 节流：避免 editMessage 频率过高触发限流
  → 依赖 progressive 先验证 editMessage 可用
```

选择 progressive 作为 Phase 1 实现，typewriter 作为 Phase 2（依赖 editMessage 验证结果）。

### D2：Dify 接入 — HTTP 转发层，绕过 LangChain

Dify 是工作流编排平台，不是 LLM。接入后 LangChain Agent 逻辑多余，MCP 工具也失效。因此 Dify 路径完全绕过 AgentEngine：

```
provider = "openai-compatible"（默认）
  → 现有 AgentEngine 路径，MCP 工具有效

provider = "dify"
  → DifyClient.chat(query, conversationId, inputs)
  → POST https://<dify_base_url>/v1/chat-messages
  → 复用 SessionStore 存储 difyConversationId（新增可选字段）
  → Session 结构：messages 保持空数组，difyConversationId 存储 Dify 会话 ID
  → 不走 LangChain，不加载 MCP 工具
```

DifyClient 是一个轻量 HTTP 客户端，不引入新依赖（用 Node.js 内置 fetch）。

Bot 配置新增字段：
```
provider: "openai-compatible" | "anthropic" | "dify"  默认 "openai-compatible"
streamingMode: "none" | "progressive" | "typewriter"   默认 "none"
difyBaseUrl: string   仅 provider=dify 时有效
difyApiKey: string    仅 provider=dify 时有效
difyAppId: string     仅 provider=dify 时有效（可选，用于区分多个 Dify 应用）
```

### D3：多 LLM provider — LangChain 统一接口

`openai-compatible` 和 `anthropic` 都走 LangChain，只是实例化不同的 Chat 类：

```typescript
// openai-compatible（现有）
new ChatOpenAI({ apiKey, configuration: { baseURL }, modelName })

// anthropic
new ChatAnthropic({ apiKey, modelName })
// baseUrl 可选（用于代理）
```

`dify` 不走 LangChain，在 AgentEngine.initialize() 中跳过模型初始化。

### D4：定时任务 — node-cron + BotManager 调度

不引入独立调度服务，在 API 进程内用 `node-cron` 管理：

```
scheduled_tasks 表：
  id, bot_id, name, cron_expr, prompt_template,
  target_chat_key,   -- 内部路由键（wecom:group:xxx / wecom:user:xxx），用于查 Session
  target_chat_id,    -- 企业微信原始 chatId，用于调 sendMessage（新增，修复冲突2）
  target_chat_name, context_id（可选，为空时用 Bot defaultContext，修复冲突5）,
  enabled, last_run_at, next_run_at, created_at, updated_at

启动时：从 DB 加载所有 enabled 任务，注册 cron job
任务触发：
  1. 解析 context_id → 若为空则取 Bot defaultContext
  2. 用 prompt_template + systemPrompt 调用对应 Bot 的 AgentEngine（或 DifyClient）
  3. 将结果 sendMessage 到 target_chat_id（原始企业微信 ID）
  4. 更新 last_run_at；用 cron-parser 计算并更新 next_run_at
配置变更：增删改任务时，重新注册对应 cron job
```

`node-cron` 是轻量依赖（无需 Redis），适合内网单进程场景。`cron-parser` 用于计算 `next_run_at`。

### D5.1：TaskScheduler 与 BotManager 依赖关系

`TaskScheduler` 需要调用 Bot 的 AgentEngine/DifyClient，因此必须持有 `BotManager` 引用。初始化顺序：

```
index.ts 启动顺序：
  1. 初始化 DB
  2. 初始化 BotManager（不自动启动 Bot）
  3. 初始化 TaskScheduler(botManager)
  4. taskScheduler.loadFromDb()  ← 恢复 enabled 任务
  5. 启动 Express 服务
```

`BotManager` 不持有 `TaskScheduler` 引用，避免循环依赖。

### D6：多模态 — IncomingContent[] 透传，visionEnabled 开关控制

WeCom SDK 已经把图片 URL 提取出来放在 `IncomingContent[]` 里，但现在在传给 AgentEngine 之前被丢弃了。修复路径是最小改动：

```
改动点：

1. packages/types：SessionMessage.content 改为 string | IncomingContent[]

2. packages/core/agent-engine.ts：
   invokeWithPrompt(content: string | IncomingContent[], ...)
   - string → new HumanMessage(text)（现有行为）
   - IncomingContent[] → new HumanMessage({ content: [
       { type: 'text', text },           // 文字部分
       { type: 'image_url', image_url: { url } }  // 图片部分
     ]})
   Session 历史重建同理：content 为数组时构建多模态 HumanMessage

3. apps/api/bot-instance.ts：
   - visionEnabled=true：直接透传 IncomingContent[] 给 AgentEngine
   - visionEnabled=false（默认）：IncomingContent[] 降级为 "[图片]" 文本，行为与 v1 一致

4. packages/core/dify-client.ts：
   - 图片 URL 放入请求体 files 字段：
     { type: 'image', transfer_method: 'remote_url', url }
```

**visionEnabled 开关的必要性**：不是所有模型都支持视觉，强制透传图片 URL 给纯文本模型会导致 API 报错。开关默认 false，用户显式开启后才透传，避免存量 Bot 受影响。

**LLM 不支持视觉时的降级**：捕获 400/422 错误，fallback 为 `[图片: <url>]` 纯文本重试一次，保证用户至少能看到图片链接。

**语音不变**：WeCom ASR 转写已经是文本，无需改动。

### D7：allowedProjects 动态化 — 纯前端改动

后端 `contexts.allowedProjects` 已是 JSON 数组字段，无需改 schema。只需：
- 前端 ContextsPage 把硬编码的 15 个选项改为 `Select` 组件的 `mode="tags"`（自由输入 + 回车确认）
- 现有数据完全兼容

## 风险 / 权衡

| 风险 | 缓解措施 |
|---|---|
| editMessage 在企业微信 WSClient 中不可用 | progressive 模式加 try/catch fallback，降级为 sendMessage |
| typewriter 模式 editMessage 频率过高触发限流 | 节流 800ms，失败静默跳过，最终发完整回复 |
| Dify API 超时影响消息队列 | DifyClient 设置 30s 超时，超时走错误降级 |
| node-cron 任务在进程重启后重新注册 | index.ts 启动时 taskScheduler.loadFromDb()，无状态丢失风险 |
| TaskScheduler 与 BotManager 循环依赖 | TaskScheduler 单向依赖 BotManager，BotManager 不持有 TaskScheduler 引用 |
| 视觉模型不支持图片 URL 格式报错 | visionEnabled 默认 false；开启后捕获 400/422 fallback 纯文本重试 |
| 图片 URL 在 WeCom 侧有时效性（可能过期） | Phase 1 不做缓存，URL 直接透传；若 LLM 报图片无法访问则降级文本 |

## 迁移计划

1. DB migration：`bots` 表新增 `provider`、`streamingMode`、`difyBaseUrl`、`difyApiKey`、`difyAppId`、`visionEnabled` 字段（均有默认值，存量数据不受影响）
2. DB migration：新增 `scheduled_tasks` 表
3. 部署新版本后，存量 Bot 默认 `provider=openai-compatible`、`streamingMode=none`，行为与 v1 完全一致
4. 回滚：回退镜像版本即可，新字段有默认值不影响旧代码读取

## Open Questions

- WSClient 是否暴露 `updateMsg` 或等价方法？需要查 `@wecom/aibot-node-sdk` 源码或文档确认，这决定 progressive/typewriter 是否可行。
- Dify 是否需要支持 streaming 模式（`response_mode: "streaming"`）？Phase 1 先用 blocking 模式，Phase 2 按需。
- 定时任务的 prompt_template 是否需要支持变量插值（如 `{date}`、`{bot_name}`）？Phase 1 先做纯静态模板。
