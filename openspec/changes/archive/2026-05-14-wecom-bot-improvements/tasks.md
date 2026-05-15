## 1. 数据库 Schema 扩展

- [x] 1.1 在 `apps/api/src/db/schema.ts` 中新增 `sessions` 表（字段：id, bot_id, chat_key, context_id, last_active_at, expires_at）
- [x] 1.2 在 `apps/api/src/db/schema.ts` 中新增 `session_messages` 表（字段：id, session_id, role, content, timestamp）
- [x] 1.3 在 `apps/api/src/db/client.ts` 的 `initDb()` 中添加两张新表的 CREATE TABLE IF NOT EXISTS 语句

## 2. 会话持久化（SessionStore 改造）

- [x] 2.1 将 `apps/api/src/session-store.ts` 新建 SQLite 版 `SessionStore`，接口保持不变（`getOrCreate`、`addMessage`、`delete`、`getAll`）
- [x] 2.2 实现 `getOrCreate`：先查 SQLite，命中且未过期则加载消息历史；否则创建新记录
- [x] 2.3 实现 `addMessage`：写入 `session_messages` 表，超过 MAX_MESSAGES(20) 时删除最旧记录
- [x] 2.4 实现 `delete`：级联删除 `sessions` 和 `session_messages` 记录
- [x] 2.5 实现 `getAll`：从 SQLite 查询所有未过期会话（用于管理 API）
- [x] 2.6 实现定时清理：每 60 秒删除 `expires_at < now()` 的过期会话
- [x] 2.7 在 `apps/api/src/bot-manager/bot-instance.ts` 中将 `SessionStore` 初始化改为传入 db client

## 3. 消息内容预处理（@前缀清理）

- [x] 3.1 在 `packages/core/src/wecom-adapter.ts` 的 `parseContent()` 中，对 `text` 类型消息用正则 `/^@\S+\s*/` 去除 @前缀
- [x] 3.2 在 `IncomingMessage` 类型中新增 `chatType: 'single' | 'group'` 字段，供下游判断
- [x] 3.3 在 `parseFrame()` 中从 `body.chattype` 解析并填充 `chatType` 字段

## 4. 流式消息输出

- [x] 4.1 在 `packages/core/src/wecom-adapter.ts` 中新增 `sendStreamChunk(chatId, streamId, content, finish)` 方法，调用 `aibot_respond_msg` 命令
- [x] 4.2 在 `packages/core/src/agent-engine.ts` 中新增 `invokeWithStream(sessionMessages, content, systemPrompt, callbacks)` 方法，使用 LangChain `streaming: true` + `CallbackHandlerMethods`
- [x] 4.3 在 `invokeWithStream` 的 `handleLLMNewToken` callback 中，调用外部传入的 `onToken(token)` 回调
- [x] 4.4 在 `invokeWithStream` 的 `handleToolStart` callback 中，调用外部传入的 `onToolStart(toolName)` 回调
- [x] 4.5 在 `apps/api/src/bot-manager/bot-instance.ts` 中，将 `queue.enqueue` 内的处理逻辑改为调用 `invokeWithStream`
- [x] 4.6 移除 `bot-instance.ts` 中的 `THINKING_MESSAGE` 占位消息发送逻辑（streaming 模式下）

## 5. 断线重连机制

- [x] 5.1 在 `packages/core/src/wecom-adapter.ts` 中新增 `stopped` 和 `reconnectAttempts` 状态字段
- [x] 5.2 新增 `scheduleReconnect(delayMs)` 私有方法：等待 delayMs 后调用 `this.client.connect()`
- [x] 5.3 在 `start()` 的 `message` 事件处理中，检测 `disconnected_event`：收到后等待随机 jitter（500ms-2000ms）再调用 `scheduleReconnect`
- [x] 5.4 在 `start()` 中监听 `error` 事件：计算指数退避时间（`Math.min(1000 * 2^attempts, 60000)` + jitter），调用 `scheduleReconnect(delay)`
- [x] 5.5 在 `stop()` 中设置 `this.stopped = true`，`scheduleReconnect` 检查此标志，若为 true 则不重连
- [x] 5.6 重连成功（`connected` 事件触发）后重置 `reconnectAttempts = 0`

## 6. 验证与测试

- [x] 6.1 启动服务，验证机器人能正常连接并接收消息
- [x] 6.2 发送消息，验证流式输出效果（用户看到消息实时更新）
- [x] 6.3 在群聊中 @机器人发消息，验证 @前缀被正确去除
- [x] 6.4 重启服务，验证会话历史从 SQLite 恢复
- [x] 6.5 模拟断线（停止网络），验证自动重连后机器人恢复正常
