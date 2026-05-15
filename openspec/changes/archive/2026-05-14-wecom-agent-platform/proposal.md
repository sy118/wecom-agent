## 为什么

当前 wecom-agent 是单机器人、无状态的脚本，每条消息独立处理，无法支持多轮排查对话，也无法为不同业务群配置不同的上下文和权限范围。随着使用场景扩展（库存群、订单群、财务群等），需要一个可视化配置的多机器人平台来统一管理。

## 变更内容

- **新增** Monorepo 结构（pnpm workspaces）：`apps/api`、`apps/web`、`packages/core`、`packages/types`
- **新增** SQLite 数据库（Drizzle ORM）：持久化机器人、上下文、绑定关系配置
- **新增** BotManager + BotInstance：多机器人生命周期管理，每个机器人独立运行时
- **新增** per-chatKey 串行消息队列（参考 Kite MessageQueue 设计）：解决并发消息处理问题
- **新增** 会话状态管理：内存 Map + 30 分钟 TTL，保留最近 20 条消息，支持多轮对话
- **新增** 上下文路由：chatKey → contextId 绑定，不同群/用户使用独立系统提示词和项目范围
- **新增** REST API 管理服务（Express 5）：机器人、上下文、绑定、会话的 CRUD
- **新增** 管理控制台（React 18 + Vite + Ant Design）：内网部署，JWT 单管理员认证
- **新增** SSE 实时状态推送：管理台实时显示机器人运行状态
- **修改** WecomAdapter：从单例函数改为可实例化类，实现 IMAdapter 接口，支持"思考中"消息替换模式
- **修改** AgentEngine：从读取全局 config 改为接收 per-bot 参数（llmConfig、mcpServers、systemPrompt）
- **保持** AI 能力不变：LangChain + MiniMax + GitNexus MCP，AI 只给出 SQL 建议，不直接查生产数据库

## 功能 (Capabilities)

### 新增功能

- `bot-management`: 多机器人的创建、配置、启动/停止和状态监控
- `context-routing`: 上下文配置管理及 chatKey → context 绑定路由
- `session-management`: 多轮对话会话状态，内存存储，TTL 自动过期
- `message-queue`: per-chatKey 串行消息队列，保证同一会话消息顺序处理
- `admin-console`: 内网管理控制台，JWT 认证，React + Vite + Ant Design

### 修改功能

（无现有规范文件，当前为全新平台化改造）

## 影响

- **代码**：现有 `src/` 下所有文件需重构，提取到 `packages/core`，适配多实例参数化
- **依赖**：新增 `better-sqlite3`、`drizzle-orm`、`jsonwebtoken`；前端新增 React、Vite、Ant Design
- **部署**：从单容器改为 Docker Compose 双服务（api + web/nginx）
- **配置**：从纯环境变量改为 SQLite 数据库驱动，保留 `ADMIN_PASSWORD` 等启动级环境变量
