## 1. 数据模型与校验

- [x] 1.1 扩展 `McpServerConfig` 类型，增加 stdio 所需的 `command`、`args`、`env` 字段，并增加 Streamable HTTP 所需的 `headers` 字段与 transport 类型
- [x] 1.2 为 `mcp_servers` 增加 `command`、`args_json`、`env_json`、`headers_json` 的初始化与迁移逻辑
- [x] 1.3 更新 MCP Server Repository，支持 stdio 和 Streamable HTTP 字段的 JSON 序列化、反序列化、创建和更新
- [x] 1.4 在 MCP Server API 路由增加请求校验，确保 SSE/Streamable HTTP 必须有 URL、stdio 必须有 command，且 args/env/headers 类型正确

## 2. 运行时 transport 支持

- [x] 2.1 在 MCP client 中接入 `StdioClientTransport` 和 `StreamableHTTPClientTransport`，根据 `transportType` 创建 SSE、stdio 或 Streamable HTTP transport
- [x] 2.2 实现 `${VAR_NAME}` 解析，支持 stdio env 和 Streamable HTTP headers 从 API 进程环境变量读取，并避免日志输出敏感值
- [x] 2.3 保持单个 MCP Server 连接失败不阻断 Bot 启动或工具池刷新
- [x] 2.4 验证既有 SSE MCP Server 仍可正常加载工具，并验证 `/mcp` URL 不再被 SSE transport 连接

## 3. 管理控制台

- [x] 3.1 更新 MCP Server 页面类型与表格，列表对 SSE/Streamable HTTP 展示 URL，对 stdio 展示 command 摘要，并避免展示完整 headers/env
- [x] 3.2 更新 MCP Server 表单，根据传输类型切换 URL、command/args/env 或 headers 字段
- [x] 3.3 为 stdio 表单增加 `uvx mcp-atlassian` 与 `${JIRA_PERSONAL_TOKEN}` 配置提示，为 Streamable HTTP 表单增加 `/mcp` 与 `${YUQUE_MCP_TOKEN}` 配置提示
- [x] 3.4 在前端保存前解析 args/env/headers JSON，并将校验错误反馈给管理员

## 4. 测试与验证

- [x] 4.1 增加或更新 API/Repository 测试，覆盖 SSE 兼容、stdio/Streamable HTTP 创建更新、非法配置拒绝
- [x] 4.2 增加或更新 MCP client 测试，覆盖 stdio transport 创建、Streamable HTTP transport 创建、变量引用解析、缺失变量失败不阻断
- [x] 4.3 通过 Web 构建和手动检查验证管理页面传输类型切换与 JSON 校验（当前项目未配置前端页面测试脚本）
- [x] 4.4 运行相关测试与类型检查，确认 OpenSpec 变更可实现且无回归
