## 上下文

当前 wecom-agent 是单文件脚本，所有配置硬编码在环境变量中，单机器人、无状态、无并发保护。随着业务扩展需要支持多机器人、多群上下文隔离和多轮对话，需要平台化改造。

参考项目：Kite-main（企业微信 Claude Code 桥接器），借鉴其 MessageQueue、IMAdapter 接口、chatKey 路由、错误降级等设计模式。

**约束**：
- AI 能力保持不变（LangChain + MiniMax + GitNexus MCP），不引入新 LLM
- AI 只给出 SQL 建议，不直接查生产数据库
- 内网部署，无需公网 IP

## 目标 / 非目标

**目标：**
- 支持多机器人独立配置和运行时管理
- 支持 chatKey 级别的上下文隔离（不同群/用户使用不同系统提示词和项目范围）
- 支持多轮对话（内存会话，30 分钟 TTL，最近 20 条消息）
- 解决并发消息处理问题（per-chatKey 串行队列）
- 提供内网可视化管理控制台（React + Vite + Ant Design）
- Docker Compose 一键部署

**非目标：**
- 不做生产数据库直查（AI 只给 SQL 建议）
- 不做多用户账号体系（单管理员密码即可）
- 不做会话持久化（重启后会话重置可接受）
- 不做消息摘要/压缩（保留最近 20 条，超出丢弃最早的）
- 不支持 Telegram/飞书等其他 IM（仅企业微信）

## 决策

### D1：Monorepo 结构（pnpm workspaces）

选择 pnpm workspaces 而非单包，原因：
- `packages/core` 需要被 `apps/api` 引用，共享类型和业务逻辑
- `apps/web` 独立构建，nginx 静态托管
- 与 Kite 的 monorepo 结构一致，便于参考

```
wecom-agent/
├── apps/
│   ├── api/          # Express 5 + Bot 运行时
│   └── web/          # React 18 + Vite + Ant Design
├── packages/
│   ├── core/         # 共享业务逻辑
│   └── types/        # 共享 TypeScript 类型
└── pnpm-workspace.yaml
```

### D2：SQLite + Drizzle ORM（WAL 模式）

选择 SQLite 而非 JSON 文件或 PostgreSQL，原因：
- 比 JSON 文件支持更好的并发读写（WAL 模式）
- 比 PostgreSQL 轻量，无需额外部署
- Drizzle ORM 提供 TypeScript 类型安全，迁移简单
- 未来迁移到 PostgreSQL 只需换 driver

**Schema 核心表**：
```sql
bots(id, name, wecom_bot_id, wecom_bot_secret, wecom_ws_url,
     llm_api_key, llm_base_url, llm_model, status, created_at, updated_at)

contexts(id, bot_id, name, system_prompt, allowed_projects,
         session_ttl_min, is_default, created_at, updated_at)

bindings(id, bot_id, context_id, chat_key, chat_name, chat_type, created_at)
-- UNIQUE(bot_id, chat_key)

mcp_servers(id, bot_id, name, url, transport_type, enabled)
```

### D3：BotManager + BotInstance 架构

所有机器人在同一 Node.js 进程内运行（in-process），而非独立子进程，原因：
- 规模小（预计 < 10 个机器人），in-process 足够
- 避免 IPC 复杂性
- 单进程崩溃影响所有机器人，但内网场景可接受

```
BotManager
  ├── instances: Map<botId, BotInstance>
  ├── start(botId): 从 DB 加载配置，创建 BotInstance
  ├── stop(botId): 关闭 WebSocket，清理队列和会话
  └── getStatus(botId): running | stopped | error

BotInstance
  ├── wecomAdapter: WecomAdapter（实现 IMAdapter 接口）
  ├── agentEngine: AgentEngine（参数化，接收 llmConfig + mcpServers + systemPrompt）
  ├── messageQueues: Map<chatKey, MessageQueue>（per-chatKey 串行队列）
  └── sessionStore: SessionStore（内存 Map + TTL）
```

### D4：消息处理流程（借鉴 Kite）

```
消息到达
  → chatKey = body.chatid ? `wecom:group:${chatid}` : `wecom:user:${userid}`
  → 消息去重（processedMsgs Set）
  → 查 bindings 表：chatKey → contextId（无绑定则用 defaultContext）
  → 查/建 Session（内存，TTL 30min，最近 20 条消息）
  → messageQueues[chatKey].enqueue(task)
  → task 执行：
      1. 发送"🤔 正在分析..."占位消息，保存 messageId
      2. agentEngine.invoke(session.messages, context)
      3. editMessage(messageId, response) || fallback sendMessage(response)
      4. 更新 session.messages + lastActiveAt
```

### D5：IMAdapter 接口（直接借鉴 Kite）

```typescript
interface IMAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  sendMessage(chatId: string, text: string): Promise<void | string>  // 返回 messageId
  editMessage(chatId: string, messageId: string, text: string): Promise<void>  // WeCom 不支持则 throw
}
```

WecomAdapter 的 `editMessage` 直接 throw，调用方 try/catch 降级到 sendMessage。

### D6：会话上下文窗口管理

保留最近 20 条消息（HumanMessage + AIMessage 交替），超出时从头部丢弃。
不做摘要，Phase 1 接受上下文截断。TTL 30 分钟，setInterval 每分钟清理过期会话。

### D7：管理控制台认证

单管理员密码 JWT，原因：
- 内网部署，安全边界在网络层
- 无需多用户账号体系
- 实现简单，`ADMIN_PASSWORD` 环境变量配置

JWT 有效期 24 小时，无刷新 token（内网场景可接受）。

### D8：实时状态推送（SSE）

管理台通过 SSE 订阅机器人状态变更，而非 WebSocket，原因：
- 单向推送（服务端 → 客户端），SSE 足够
- 比 WebSocket 实现简单
- 浏览器原生支持，无需额外库

## 风险 / 权衡

| 风险 | 缓解措施 |
|---|---|
| 单进程崩溃影响所有机器人 | 使用 PM2 或 Docker restart:always 自动重启 |
| 重启丢失所有会话 | 用户重新发消息即可，Phase 1 可接受 |
| SQLite 写锁在高并发下降级 | WAL 模式 + 配置变更频率低，实际影响极小 |
| MCP 连接数随机器人数线性增长 | 预计 < 10 个机器人，GitNexus 侧可承受 |
| 消息队列积压无上限 | 超过 10 条积压时回复"正在处理中，请稍候" |
| JWT 密钥硬编码风险 | 强制要求 ADMIN_PASSWORD 环境变量，启动时校验非空 |

## 迁移计划

1. 保留现有 `src/` 代码不删除，新建 monorepo 结构并行开发
2. 将 `src/wecom-adapter.ts`、`src/graph.ts`、`src/mcp-client.ts` 重构提取到 `packages/core`
3. 新增 `apps/api` 和 `apps/web`
4. 切换 Docker Compose 配置，停旧容器启新容器
5. 通过管理台录入原有机器人配置，验证功能一致后删除旧 `src/`

**回滚**：旧 Docker Compose 配置保留，可随时切回单机器人模式。

## Open Questions

- MCP 连接是否需要连接池（多机器人共享同一 GitNexus 连接）？Phase 1 先每机器人独立连接，观察实际负载再决定。
- 管理台是否需要操作审计日志？Phase 1 暂不做，Phase 2 按需添加。
