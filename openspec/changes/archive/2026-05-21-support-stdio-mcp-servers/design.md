## 上下文

项目的 README 和类型定义已经将 MCP Server 描述为支持 SSE/stdio，但当前实现只有 SSE 可用。`McpServerConfig` 中存在 `transportType: 'sse' | 'stdio'`，管理页面也允许选择 stdio；实际运行时 `createMcpTools` 对非 SSE transport 记录 unsupported warning 后跳过，数据库也没有保存 stdio 所需的 `command`、`args`、`env`。同时，新版 MCP Server 常见的 Streamable HTTP `/mcp` endpoint 不能用 SSE EventSource 连接，当前配置为 SSE 时会出现 400 等连接错误。

这会让管理员以为可以配置 `uvx mcp-atlassian` 等本地 MCP Server，但 Bot 启动后无法加载工具；也会让 `http://host:port/mcp` 这类 Streamable HTTP MCP Server 被错误地当作 SSE 使用。Jira、语雀等访问令牌也不适合直接作为配置明文持久化。

## 目标 / 非目标

**目标：**

- 将 MCP Server 配置正式拆分为 SSE、stdio 与 Streamable HTTP 三种形态。
- 支持保存和展示 stdio 的 `command`、`args`、`env`。
- 支持保存和展示 Streamable HTTP 的 `url` 与可选 `headers`。
- Bot 工具池构建时能够通过 stdio transport 启动 MCP Server，并通过 Streamable HTTP transport 连接 `/mcp` endpoint 加载工具。
- 支持 `${VAR_NAME}` 环境变量引用，运行时从 API 进程环境变量解析敏感值。
- 保持既有 SSE MCP Server 配置和 Wiki MCP 行为兼容。
- 增加 API 边界校验，避免错误配置进入运行时。

**非目标：**

- 不实现完整 Secret Manager、加密密钥管理或凭证轮换。
- 不支持通过 Web 控制台测试连接或浏览远端 MCP tools。
- 不改变 Context MCP 参数模式、forceCall、Skill 工具合并等既有语义。
- 不为 Dify provider 加载本地 MCP 或 Skill tools。

## 决策

### 决策 1：保留单表，新增 stdio 字段

继续使用 `mcp_servers` 表，新增 `command TEXT`、`args_json TEXT`、`env_json TEXT`、`headers_json TEXT`。SSE 和 Streamable HTTP 记录使用 `url`，stdio 记录使用 `command/args_json/env_json`；Streamable HTTP 记录额外使用 `headers_json`。

替代方案是新增 `mcp_stdio_servers` 表或使用单个 `config_json` 字段。单表新增列对当前 Repository、列表页和 Context 引用影响最小；相比 `config_json`，显式列也更容易迁移和排查。

### 决策 2：类型层使用可选字段而非复杂联合类型

`McpServerConfig` 增加可选 `command?: string`、`args?: string[]`、`env?: Record<string, string>`、`headers?: Record<string, string>`。API 校验负责保证 SSE 和 Streamable HTTP 必须有 URL、stdio 必须有 command。

替代方案是在共享类型中使用严格 discriminated union。该方式类型更精确，但当前前后端表单和 Repository 多处以 Partial 更新配置，强联合会带来较多改造；本次优先在 API 边界保证正确性。

### 决策 3：环境变量与 headers 支持 `${VAR_NAME}` 引用

stdio `env` 和 Streamable HTTP `headers` 中的值如果完整匹配 `${VAR_NAME}`，运行时从 `process.env.VAR_NAME` 读取。普通字符串按字面值传递。解析后的 env 与 API 进程环境变量合并传给 stdio transport，headers 传给 Streamable HTTP transport。

替代方案是明文保存 token 或实现 Secret Manager。明文保存最快但不安全；Secret Manager 超出本次范围。`${VAR_NAME}` 能覆盖 Jira token 等常见需求，并保持部署模型简单。

### 决策 4：前端第一版使用 JSON 文本框编辑 args/env/headers

stdio 表单提供 `command` 输入框、`args` JSON 数组文本框、`env` JSON 对象文本框，并展示 `uvx mcp-atlassian` 示例。Streamable HTTP 表单提供 `/mcp` URL 输入框和 `headers` JSON 对象文本框，并展示 `Authorization: Bearer ${YUQUE_MCP_TOKEN}` 示例。保存前在前端做基本 JSON 解析，API 再做最终校验。

替代方案是 key/value 动态表单。动态表单体验更好，但改动更大；JSON 文本框能更快覆盖 MCP 官方配置片段复制粘贴场景。

### 决策 5：单个非 SSE MCP 失败不阻断 Bot 启动

stdio MCP 连接失败、命令不存在、环境变量缺失、Streamable HTTP 返回非 2xx、headers 变量缺失或工具加载超时时，沿用 SSE 失败策略：记录错误，跳过该服务器，继续构建其他工具。

## 风险 / 权衡

- stdio 命令可执行本地程序 → 仅管理员可配置 MCP Server，并在 UI 中提示该命令会由 API 进程执行；实现时不增加普通用户入口。
- Streamable HTTP headers 可能包含 token → 支持 `${VAR_NAME}` 引用，列表页不展示完整 headers。
- `${VAR_NAME}` 未配置会导致连接失败 → 在运行时错误日志中指出缺失变量名，但不打印敏感值。
- 长时间运行或异常退出的 stdio 进程可能占用资源 → 依赖 MCP SDK transport 生命周期；后续如发现泄露，再补充 Bot 停止时的连接清理。
- JSON 文本框不如 key/value 表单友好 → 第一版换取低复杂度；后续可在不改 API 的情况下升级 UI。
- 旧数据库中 `url` 为 NOT NULL → stdio 记录可将 `url` 保存为空字符串以兼容现有 schema，或迁移时放宽约束；实现时优先避免破坏既有数据。

## 迁移计划

1. 在数据库初始化后通过 `addColumnIfMissing` 添加 `command`、`args_json`、`env_json`、`headers_json`。
2. 既有 SSE 记录保持原样，新增字段为空。
3. stdio 新记录保存 `url` 为空字符串或迁移后的可空值，运行时不读取其 URL。
4. Streamable HTTP 新记录使用 `/mcp` URL，可选 headers 为空对象。
5. 如部署后出现 stdio 或 Streamable HTTP 配置问题，可禁用对应 MCP Server；SSE 行为不受影响。

## 待定问题

- `url` 列是否需要从 `NOT NULL` 迁移为可空，还是以空字符串兼容现状？实现时可根据迁移复杂度选择。
- 是否需要在列表页遮罩 `env` 或 `headers` 中看起来像 token/password/key 的值？第一版至少不展示完整 env/headers 值。
