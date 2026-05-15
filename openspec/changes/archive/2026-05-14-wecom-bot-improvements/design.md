## 上下文

当前平台使用 `@wecom/aibot-node-sdk` 的 `WSClient` 建立 WebSocket 长连接，消息处理链为：`WecomAdapter` → `BotInstance.handleMessage()` → `MessageQueue` → `AgentEngine.invokeWithPrompt()`。

现有问题：
1. `AgentEngine` 使用 LangChain 的非流式 `invoke()`，LLM 完整生成后才返回，期间只能发一条占位消息
2. `SessionStore` 纯内存，`BotInstance` 持有引用，进程重启即清空
3. `WecomAdapter` 只监听 `message` / `connected` / `error` 事件，没有处理 `disconnected_event`，连接被踢后机器人静默失效

企微长连接文档关键约束：
- 流式消息：`aibot_respond_msg` + `stream.id` + `finish=false/true`，同一 `stream.id` 的后续推送会原地更新消息
- 频率限制：每个会话 30条/分钟，1000条/小时
- 连接限制：同一机器人同一时间只能有一个有效长连接，新连接建立时旧连接收到 `disconnected_event` 后被踢掉
- 心跳：建议每 30 秒发送一次 ping

## 目标 / 非目标

**目标：**
- 实现流式消息输出，用户看到 AI 实时"打字"效果
- 群聊消息自动去除 `@机器人名字` 前缀
- 监听 `disconnected_event`，连接断开后自动重连（指数退避）
- 会话历史持久化到 SQLite，进程重启后恢复

**非目标：**
- 不修改 Web 管理控制台
- 不引入新的外部依赖
- 不实现多机器人高可用（主备切换）
- 不修改 MCP 连接管理

## 决策

### 决策 1：流式输出驱动方式

**选择**：LangChain `CallbackHandler` + `invokeWithStream()` 新方法

**理由**：LangChain 的 `ChatOpenAI` 支持 `streaming: true` + `callbacks`，每个 token 生成时触发 `handleLLMNewToken`。在 callback 中调用 `adapter.sendStreamChunk()` 推送 `aibot_respond_msg`（`finish=false`），LLM 完成后发送 `finish=true`。

**替代方案**：直接用 OpenAI SDK 的 stream API —— 放弃，因为会绕过 LangChain 的 agent/tool 调用链，MCP 工具调用会失效。

**stream.id 生成**：每次消息回调生成一个 UUID，绑定到该次回调的 `req_id`，整个流式过程复用同一个 `stream.id`。

**工具调用期间的流式**：LLM 调用 MCP 工具时不产生 token，用户会看到消息停止更新。在工具调用开始时推送一条进度提示（如 `🔍 正在检索代码库...`），工具返回后继续流式输出。

### 决策 2：会话持久化方案

**选择**：新增 `sessions` + `session_messages` 两张 SQLite 表，`SessionStore` 改为异步读写 libSQL

**理由**：项目已使用 `@libsql/client`（libSQL），无需新增依赖。`SessionStore` 接口保持不变（`getOrCreate`、`addMessage`、`delete`、`getAll`），只改内部实现，`BotInstance` 无需修改。

**替代方案**：Redis —— 放弃，引入新依赖，部署复杂度增加。

**TTL 处理**：`expiresAt` 存入数据库，启动时清理过期会话，运行时定期清理（保持现有 60 秒间隔逻辑）。

**消息上限**：保持现有 MAX_MESSAGES=20 限制，`addMessage` 时若超限删除最旧记录。

### 决策 3：断线重连策略

**选择**：在 `WecomAdapter` 内部实现重连，监听 `disconnected_event` 和 `error` 事件，使用指数退避（1s → 2s → 4s → ... → 最大 60s）

**理由**：重连逻辑封装在 adapter 层，`BotInstance` 和 `BotManager` 无需感知。重连时重新调用 `this.client.connect()` 并重新订阅。

**注意**：`disconnected_event` 是企微主动踢掉旧连接时发送的，收到后不应立即重连（说明有新连接已建立），应等待一段时间后再尝试。网络断开导致的 `error` 事件才需要立即重连。

### 决策 4：@前缀清理

**选择**：在 `WecomAdapter.parseContent()` 中，对 `text` 类型消息用正则 `/^@\S+\s*/` 去除前缀

**理由**：企微群聊消息 content 格式为 `@机器人名字 用户问题`，机器人名字不含空格，前缀后跟一个空格。单聊消息不含 @前缀，正则不会误匹配。

## 风险 / 权衡

- **流式输出 + MCP 工具调用**：工具调用期间无 token 产生，用户看到消息"卡住"。缓解：工具调用开始时推送进度消息（`finish=false`）。
- **SQLite 并发写入**：多个 bot 同时写 session，libSQL 的 WAL 模式已启用，并发写入安全。
- **重连风暴**：多个 bot 同时断线重连可能造成瞬时压力。缓解：每个 bot 独立的指数退避，加随机 jitter。
- **流式消息 10 分钟超时**：企微要求 10 分钟内完成所有流式推送并设置 `finish=true`。LLM 调用通常在 60 秒内完成，风险极低。
- **会话数据迁移**：现有内存会话在部署时丢失（本次变更不做迁移，接受一次性会话重置）。

## 迁移计划

1. 部署新版本前，数据库会自动创建 `sessions` 和 `session_messages` 表（`initDb()` 已有建表逻辑）
2. 现有内存会话在部署时自然丢失，用户下次发消息时自动创建新会话
3. 无需回滚脚本，新表不影响现有表结构

## 开放问题

- `@wecom/aibot-node-sdk` 的 `WSClient` 是否暴露了足够的事件来检测心跳超时？需要查看 SDK 源码确认。如果不支持，需要在应用层实现心跳监控定时器。
