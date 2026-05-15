## 1. 后端类型与数据库

- [x] 1.1 在 `packages/types/src/index.ts` 新增 `McpConfig` 接口（mcpServerId、enabled、params.allowedProjects），更新 `ContextConfig` 用 `mcpConfigs: McpConfig[]` 替换 `allowedProjects: string[]`
- [x] 1.2 在 `apps/api/src/db/client.ts` 的 `initDb()` 中添加迁移逻辑：ADD COLUMN mcp_configs（若不存在），将旧 allowed_projects 数据迁移到 mcp_configs JSON 格式（查找 bot 的 gitnexus MCP 服务器 ID 作为 mcpServerId）

## 2. 后端 Repository 与 API

- [x] 2.1 更新 `apps/api/src/db/context-repository.ts`：`rowToConfig` 读取 `mcp_configs` 字段并反序列化，`create/update` 写入 `mcp_configs`，移除 `allowed_projects` 的读写
- [x] 2.2 更新 `apps/api/src/routes/contexts.ts`：移除 `allowedProjects` 非空校验，改为校验 `mcpConfigs` 中的 mcpServerId 属于该 Bot（调用 McpServerRepository.findByBotId 验证）

## 3. 核心运行时改造

- [x] 3.1 改造 `packages/core/src/agent-engine.ts`：`initialize()` 只初始化 LLM，不加载工具；新增 `invokeWithTools(messages, content, systemPrompt, tools)` 方法，每次调用时动态创建 Agent；保留 `invokeWithPrompt` 作为无工具的兼容方法
- [x] 3.2 改造 `apps/api/src/bot-manager/bot-instance.ts`：新增 `toolPool: Map<string, StructuredTool[]>`；`start()` 时调用 `createMcpTools` 按 mcpServerId 分组填充工具池；`handleMessage` 中按 context.mcpConfigs 过滤工具子集，调用 `engine.invokeWithTools`；`injectAllowedProjects` 改为从 mcpConfigs 中读取 gitnexus 的 params.allowedProjects

## 4. 前端 MCP 服务器管理页

- [x] 4.1 新建 `apps/web/src/pages/McpServersPage.tsx`：展示 MCP 服务器列表（名称/URL/传输类型/启用状态），支持新建（表单：名称、URL、传输类型）、编辑、删除操作，顶部有返回按钮
- [x] 4.2 在 `apps/web/src/pages/BotsPage.tsx` 操作列加「MCP服务器」按钮，点击跳转到 `/bots/:id/mcp-servers`
- [x] 4.3 在 `apps/web/src/App.tsx` 加 `/bots/:botId/mcp-servers` 路由，指向 McpServersPage

## 5. 前端上下文表单改造

- [x] 5.1 改造 `apps/web/src/pages/ContextsPage.tsx`：表单加载时同时请求该 Bot 的 MCP 服务器列表（`mcpServersApi.list(botId)`）；用 MCP 能力配置区块替换 allowedProjects 多选框；每个 MCP 服务器显示为开关+折叠参数区；gitnexus 展开后显示 allowedProjects 多选（AVAILABLE_PROJECTS 列表）；无 MCP 服务器时显示提示文字
- [x] 5.2 更新 `apps/web/src/api/index.ts` 的 `contextsApi`：请求体改用 `mcpConfigs` 字段；`mcpServersApi` 已有，确认 list 方法可用
