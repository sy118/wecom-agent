## 为什么

当前企微机器人接入代码存在三个核心问题：用户等待 AI 回复时体验差（黑盒等待 10-60 秒）、进程重启后对话历史全部丢失、WebSocket 连接断开后无自动重连导致机器人静默失效。这些问题直接影响企业内部用户的日常使用体验和系统可靠性。

## 变更内容

- **新增**：流式消息输出 —— 利用企微长连接的 `stream.id` 机制，AI 回复内容实时推送给用户，替代当前的"🤔 正在分析"占位消息
- **新增**：自动重连机制 —— 监听 `disconnected_event` 事件，连接断开后自动重连，支持指数退避
- **修改**：消息内容预处理 —— 群聊消息自动去除 `@机器人名字` 前缀，LLM 只接收用户的实际问题
- **修改**：会话持久化 —— 将 `SessionStore` 从纯内存改为 SQLite 持久化，进程重启后保留对话历史

## 功能 (Capabilities)

### 新增功能

- `streaming-response`: 通过 `aibot_respond_msg` + `stream.id` + `finish=true/false` 实现流式消息推送，LangChain streaming callback 驱动
- `ws-reconnect`: WebSocket 断线检测与自动重连，处理 `disconnected_event` 和网络异常，支持指数退避重试

### 修改功能

- `session-management`: 会话存储从纯内存改为 SQLite 持久化，进程重启后恢复对话历史；同时新增消息内容预处理（去除 @前缀）

## 影响

- `packages/core/src/wecom-adapter.ts` — 新增流式发送方法、断线重连逻辑、@前缀清理
- `packages/core/src/agent-engine.ts` — 新增流式调用方法，使用 LangChain streaming callback
- `packages/core/src/session-store.ts` — 改为 SQLite 持久化存储
- `apps/api/src/bot-manager/bot-instance.ts` — 调用流式 API 替代两步发送
- `apps/api/src/db/schema.ts` — 新增 `sessions` 和 `session_messages` 表
- 依赖：无新增外部依赖（`@libsql/client` 已存在，LangChain streaming 已支持）
