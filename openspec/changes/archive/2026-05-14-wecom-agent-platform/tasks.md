## 1. Monorepo 基础结构

- [x] 1.1 初始化 pnpm workspaces，创建根 package.json 和 pnpm-workspace.yaml
- [x] 1.2 创建 packages/types 包，定义共享类型（BotConfig、ContextConfig、Binding、Session、IMAdapter 接口、IncomingMessage）
- [x] 1.3 创建 packages/core 包，配置 tsconfig 和 package.json
- [x] 1.4 创建 apps/api 包，配置 tsconfig、package.json，安装 Express 5、better-sqlite3、drizzle-orm、jsonwebtoken
- [x] 1.5 创建 apps/web 包，使用 Vite 初始化 React 18 + TypeScript 项目，安装 Ant Design

## 2. 数据库层（packages/core 或 apps/api）

- [x] 2.1 定义 Drizzle ORM schema（bots、contexts、bindings、mcp_servers 四张表）
- [x] 2.2 实现 SQLite 客户端初始化（WAL 模式开启，数据库文件路径可配置）
- [x] 2.3 编写数据库初始化迁移脚本（首次启动自动建表）
- [x] 2.4 实现 BotRepository（CRUD + 状态更新）
- [x] 2.5 实现 ContextRepository（CRUD + 默认上下文互斥逻辑）
- [x] 2.6 实现 BindingRepository（CRUD + UNIQUE(bot_id, chat_key) 冲突处理）
- [x] 2.7 实现 McpServerRepository（CRUD）

## 3. 核心运行时（packages/core）

- [x] 3.1 将现有 mcp-client.ts 重构为参数化 McpClientFactory（接收 mcpServers[] 参数，不读全局 config）
- [x] 3.2 将现有 graph.ts 重构为参数化 AgentEngine 类（接收 llmConfig、mcpServers、systemPrompt，支持 invoke(messages)）
- [x] 3.3 实现 MessageQueue 类（参考 Kite，per-chatKey 串行队列，单任务失败不中断，size/isRunning getter）
- [x] 3.4 实现 SessionStore 类（内存 Map，TTL 管理，最近 20 条消息截断，setInterval 每分钟清理过期会话）
- [x] 3.5 将现有 wecom-adapter.ts 重构为 WecomAdapter 类（实现 IMAdapter 接口，sendMessage 返回 messageId，editMessage throw）
- [x] 3.6 实现 chatKey 解析工具函数（群消息 → `wecom:group:${chatid}`，私聊 → `wecom:user:${userid}`）

## 4. BotManager（apps/api）

- [x] 4.1 实现 BotInstance 类（持有 WecomAdapter + AgentEngine + Map<chatKey, MessageQueue> + SessionStore）
- [x] 4.2 实现 BotInstance 消息处理逻辑（去重 → chatKey → 查绑定/默认上下文 → 查/建 Session → 入队列 → 发占位消息 → invoke → edit/fallback）
- [x] 4.3 实现队列积压保护（队列 size > 10 时直接回复"繁忙"，不入队）
- [x] 4.4 实现 BotManager 类（Map<botId, BotInstance>，start/stop/getStatus/getAll 方法）
- [x] 4.5 实现 BotManager.start()：从 DB 加载 bot + contexts + bindings + mcp_servers，创建 BotInstance，连接 WebSocket，更新 DB status
- [x] 4.6 实现 BotManager.stop()：关闭 WebSocket，清空队列和会话，更新 DB status
- [x] 4.7 实现 SSE 状态推送（BotManager 状态变更时向所有 SSE 客户端广播）

## 5. REST API（apps/api）

- [x] 5.1 实现 JWT 认证中间件（验证 Authorization: Bearer token，401 拒绝未授权请求）
- [x] 5.2 实现 POST /api/auth/login（校验 ADMIN_PASSWORD，返回 24 小时 JWT）
- [x] 5.3 实现机器人 CRUD 路由（GET/POST /api/bots，GET/PUT/DELETE /api/bots/:id）
- [x] 5.4 实现机器人启停路由（POST /api/bots/:id/start，POST /api/bots/:id/stop）
- [x] 5.5 实现 GET /api/bots/events（SSE 端点，推送机器人状态变更）
- [x] 5.6 实现上下文 CRUD 路由（GET/POST /api/bots/:botId/contexts，GET/PUT/DELETE /api/bots/:botId/contexts/:id）
- [x] 5.7 实现绑定 CRUD 路由（GET/POST /api/bots/:botId/bindings，DELETE /api/bots/:botId/bindings/:id）
- [x] 5.8 实现 MCP 服务器 CRUD 路由（GET/POST /api/bots/:botId/mcp-servers，PUT/DELETE /api/bots/:botId/mcp-servers/:id）
- [x] 5.9 实现会话监控路由（GET /api/sessions，GET /api/sessions/:chatKey，DELETE /api/sessions/:chatKey）
- [x] 5.10 实现 API 启动逻辑（启动时从 DB 加载所有 status=running 的机器人并自动启动）

## 6. 管理控制台前端（apps/web）

- [x] 6.1 配置 React Router，创建路由结构（/login、/bots、/bots/:id/contexts、/bots/:id/bindings、/sessions）
- [x] 6.2 实现登录页（密码输入 + 登录按钮，成功后存储 JWT 到 localStorage，跳转到 /bots）
- [x] 6.3 实现 API 客户端封装（axios 实例，自动携带 JWT，401 时跳转登录页）
- [x] 6.4 实现机器人列表页（表格展示 name/status/操作，启动/停止按钮，SSE 实时状态更新）
- [x] 6.5 实现机器人创建/编辑表单（企业微信凭证 + LLM 配置字段）
- [x] 6.6 实现上下文列表页（表格展示 name/allowed_projects/TTL/是否默认，CRUD 操作）
- [x] 6.7 实现上下文创建/编辑表单（系统提示词多行编辑器 + 项目多选 + TTL 输入 + 默认开关）
- [x] 6.8 实现绑定管理页（表格展示 chatKey/显示名称/绑定上下文，新建绑定表单，删除操作）
- [x] 6.9 实现会话监控页（活跃会话列表，点击展开对话历史，手动清除按钮）
- [x] 6.10 实现全局布局（侧边导航：机器人管理/会话监控，顶部显示登录状态）

## 7. 部署配置

- [x] 7.1 编写 apps/api 的 Dockerfile（多阶段构建，Node.js 20 alpine）
- [x] 7.2 编写 apps/web 的 Dockerfile（Vite build + nginx 静态托管）
- [x] 7.3 编写 docker-compose.yml（api 服务 + web 服务，api 挂载 SQLite 数据卷，环境变量注入 ADMIN_PASSWORD、JWT_SECRET）
- [x] 7.4 编写 .env.example（ADMIN_PASSWORD、JWT_SECRET、DB_PATH、API_PORT、WEB_PORT）
- [x] 7.5 更新根目录 README，说明 monorepo 结构、本地开发启动方式、Docker 部署步骤
