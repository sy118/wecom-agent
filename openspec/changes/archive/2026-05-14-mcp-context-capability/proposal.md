## 为什么

当前平台中，MCP 服务器配置在 Bot 级别，所有上下文共享同一套工具，无法按业务场景精细控制 AI 的能力边界。同时 `allowedProjects`（可查项目）作为 Context 的独立字段存在，与 MCP 配置割裂，导致配置语义不清晰——它本质上是 gitnexus 工具的参数，却被放在了上下文顶层。此外，MCP 服务器管理目前只有 API，前端没有管理界面。

## 变更内容

- **新增** `mcp_configs` 字段到 contexts 表（JSON 数组，存储每个 MCP 的启用状态和专属参数）
- **移除** contexts 表的 `allowed_projects` 字段（迁移到 gitnexus 的 `params.allowedProjects`）
- **新增** Bot 级别工具池（`Map<mcpServerId, Tool[]>`），Bot 启动时加载全量工具
- **改造** `AgentEngine.invokeWithPrompt` 接收 `tools` 参数，支持 per-invoke 工具子集
- **改造** `BotInstance` 消息处理：invoke 时按 Context 的 `mcp_configs` 过滤工具
- **新增** 前端 `McpServersPage`：MCP 服务器管理页面
- **改造** 前端 `ContextsPage`：上下文表单用 MCP 能力配置区块替换 allowedProjects 多选框
- **改造** 前端 `BotsPage`：操作列加 MCP 服务器管理入口
- **改造** 前端 `App.tsx`：加 McpServersPage 路由

## 功能 (Capabilities)

### 新增功能

- `mcp-tool-pool`: Bot 级别 MCP 工具池，启动时加载全量工具，支持 per-invoke 过滤
- `context-mcp-config`: Context 级别 MCP 能力配置，含 gitnexus allowedProjects 参数
- `mcp-servers-ui`: 前端 MCP 服务器管理界面

### 修改功能

（无现有规范文件，当前为平台功能迭代）

## 影响

- **数据库**：contexts 表 schema 变更，需迁移旧数据（allowed_projects → mcp_configs）
- **后端**：`AgentEngine`、`BotInstance`、`ContextRepository` 接口变更
- **前端**：新增路由和页面，ContextsPage 表单结构变化
- **兼容性**：旧的 `allowedProjects` API 字段废弃，客户端需更新
