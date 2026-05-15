## 上下文

平台已实现多机器人多上下文架构。当前 `AgentEngine` 在 Bot 启动时初始化一次，工具列表固定。`BotInstance` 持有单个 `AgentEngine` 实例，所有上下文共享同一套 MCP 工具。`allowedProjects` 通过 systemPrompt 注入来约束 gitnexus 的查询范围，但这是软约束（提示词层面），不是工具层面的硬隔离。

IDE 已将 `SessionStore` 升级为持久化到 SQLite，`BotManager` 已传入 `db` 实例。

## 目标 / 非目标

**目标：**
- Bot 启动时加载全量 MCP 工具存入工具池（Map<mcpServerId, Tool[]>）
- Context 配置 `mcp_configs`：哪些 MCP 启用 + 各 MCP 的专属参数
- invoke 时按 Context 的 mcp_configs 过滤工具子集传给 Agent
- gitnexus 的 allowedProjects 从 Context 顶层字段迁移为 mcp_configs 的 params
- 前端 MCP 服务器管理页 + 上下文表单 MCP 能力配置区块

**非目标：**
- 不做工具级别的硬隔离（做法 2），保持单 AgentEngine 实例
- 不做 MCP 连接池（每个 Bot 独立连接）
- 不支持 MCP 热重载（需重启 Bot 生效）

## 决策

### D1：mcp_configs 数据格式

存储为 JSON 字符串在 contexts 表的 `mcp_configs` 列：

```typescript
interface McpConfig {
  mcpServerId: string
  enabled: boolean
  params: {
    allowedProjects?: string[]  // gitnexus 专属
    [key: string]: unknown      // 未来其他 MCP 的参数
  }
}
```

选择 JSON 字段而非新表，原因：配置结构简单，避免多表 JOIN，未来扩展参数只需修改 JSON 结构。

### D2：工具池设计

```
BotInstance
  ├── toolPool: Map<mcpServerId, StructuredTool[]>  ← Bot 启动时填充
  └── AgentEngine（不再持有工具，只持有 LLM）

invoke 时：
  1. 读 context.mcpConfigs，过滤 enabled=true 的 mcpServerId
  2. 从 toolPool 取出对应工具列表
  3. 如果是 gitnexus，用 allowedProjects 过滤工具名称（或注入 systemPrompt）
  4. 将工具子集传给 AgentEngine.invokeWithTools()
```

### D3：AgentEngine 改造

`AgentEngine` 不再在 `initialize()` 时绑定工具，改为：
- `initialize()` 只初始化 LLM 模型
- `invokeWithTools(messages, content, systemPrompt, tools)` 接收工具列表，每次调用时动态创建 Agent

这样 AgentEngine 变成无状态的 LLM 包装器，工具管理完全在 BotInstance 层。

### D4：allowedProjects 迁移策略

数据库迁移：
1. 读取现有 contexts 的 `allowed_projects`
2. 查找该 bot 的 gitnexus MCP 服务器 ID
3. 写入 `mcp_configs = [{"mcpServerId":"<gitnexus-id>","enabled":true,"params":{"allowedProjects":[...]}}]`
4. 若找不到 gitnexus，写入空数组 `[]`

`initDb()` 中执行迁移，幂等（检查 mcp_configs 列是否已存在）。

### D5：前端 MCP 能力配置 UI

上下文表单中，MCP 能力配置区块动态加载该 Bot 的 MCP 服务器列表：
- 每个 MCP 服务器显示为一个可折叠的开关卡片
- gitnexus 展开后显示 allowedProjects 多选
- 其他 MCP 展开后显示通用参数（预留扩展）

## 风险 / 权衡

| 风险 | 缓解措施 |
|---|---|
| 每次 invoke 动态创建 Agent 有性能开销 | LangChain createAgent 是轻量操作，工具列表小，可接受 |
| mcp_configs 迁移失败导致上下文无工具 | 迁移失败时保留 allowed_projects 原值，记录警告日志 |
| 前端加载 MCP 列表时 Bot 未启动 | 从 DB 读取 MCP 服务器配置（不依赖运行时状态） |

## 迁移计划

1. `initDb()` 执行 schema 迁移（ADD COLUMN mcp_configs，数据迁移）
2. ContextRepository 同时支持读写新字段
3. BotInstance 改造工具池逻辑
4. 前端新增 McpServersPage，改造 ContextsPage
