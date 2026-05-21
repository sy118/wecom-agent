## 为什么

当前 MCP Server 管理页面虽然提供 `stdio` 传输类型选项，但运行时只真正支持 SSE；管理员无法在项目内配置 `uvx mcp-atlassian` 这类本地 stdio MCP Server，也无法配置 `http://host:port/mcp` 这类 Streamable HTTP MCP Server。需要补齐现代 MCP transport，让企业微信 Agent 能调用 Jira、语雀等不同形态的 MCP 工具，同时避免将个人访问令牌明文写入数据库。

## 变更内容

- 为全局 MCP Server 配置增加 stdio 形态，支持 `command`、`args` 和 `env`。
- 为全局 MCP Server 配置增加 Streamable HTTP 形态，支持 `/mcp` URL 和可选 `headers`。
- SSE MCP Server 继续使用 `/sse` URL 配置，既有 Wiki MCP 等 SSE 配置保持兼容。
- 后端运行时根据 `transportType` 分别创建 SSE、stdio 或 Streamable HTTP transport，并加载 MCP tools。
- stdio 环境变量和 Streamable HTTP headers 支持 `${VAR_NAME}` 引用，由 API 进程环境变量解析，避免 token 明文持久化。
- 管理控制台 MCP Server 表单根据传输类型展示对应字段，并提供 stdio 与 Streamable HTTP 配置示例和校验提示。
- API 层增加 MCP Server 配置校验，拒绝缺少必填字段或字段类型错误的配置。

## 功能 (Capabilities)

### 新增功能
- `stdio-mcp-server-config`: 定义 stdio MCP Server 的配置、校验、环境变量解析和运行时加载行为。
- `streamable-http-mcp-server-config`: 定义 Streamable HTTP MCP Server 的配置、headers 解析和运行时加载行为。

### 修改功能
- `mcp-servers-ui`: MCP Server 管理页面需按传输类型展示并保存 SSE、stdio、Streamable HTTP 的不同字段。
- `mcp-tool-pool`: Bot 工具池构建需支持从 stdio 和 Streamable HTTP MCP Server 加载工具。

## 影响

- 类型定义：`packages/types/src/index.ts`
- MCP 运行时：`packages/core/src/mcp-client.ts`
- API 路由与校验：`apps/api/src/routes/mcp-servers.ts`
- 数据库初始化/迁移：`apps/api/src/db/client.ts`
- MCP Server Repository：`apps/api/src/db/mcp-server-repository.ts`
- 管理控制台页面：`apps/web/src/pages/McpServersPage.tsx`
- 依赖：继续使用已有 `@modelcontextprotocol/sdk`，需要引入其 stdio 和 Streamable HTTP client transport。
