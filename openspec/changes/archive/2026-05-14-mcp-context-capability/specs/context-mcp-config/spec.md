## 新增需求

### 需求:Context 存储 mcp_configs 字段
contexts 表必须新增 `mcp_configs` TEXT 字段（JSON 数组），替代原有的 `allowed_projects` 字段，存储该上下文对每个 MCP 服务器的启用状态和专属参数。

#### 场景:创建上下文时写入 mcp_configs
- **当** 管理员通过 API 创建上下文，提交包含 `mcpConfigs` 数组的请求体
- **那么** 系统必须将 mcpConfigs 序列化为 JSON 存入 `mcp_configs` 列

#### 场景:读取上下文时反序列化 mcp_configs
- **当** API 返回上下文数据
- **那么** `mcp_configs` 必须被反序列化为 `McpConfig[]` 数组返回给客户端

#### 场景:旧数据迁移
- **当** 数据库初始化时检测到 contexts 表存在 `allowed_projects` 列但不存在 `mcp_configs` 列
- **那么** 系统必须执行迁移：为每条 context 记录，将 `allowed_projects` 的值转换为对应 gitnexus MCP 的 `params.allowedProjects`，写入 `mcp_configs`

### 需求:gitnexus allowedProjects 作为 MCP 参数
gitnexus 的可查项目范围必须通过 mcp_configs 中对应条目的 `params.allowedProjects` 配置，不再作为 Context 顶层字段。

#### 场景:invoke 时注入 allowedProjects 到 systemPrompt
- **当** Context 的 mcp_configs 中 gitnexus 条目的 `params.allowedProjects` 非空
- **那么** 系统必须将该列表注入到 systemPrompt 的项目范围限制章节，覆盖默认值

#### 场景:allowedProjects 为空时不限制项目
- **当** gitnexus 的 `params.allowedProjects` 为空数组
- **那么** 系统不注入项目范围限制，AI 可查询所有项目

### 需求:mcp_configs 验证
创建或更新上下文时，系统必须验证 mcp_configs 中引用的 mcpServerId 属于该 Bot 已注册的 MCP 服务器。

#### 场景:引用不存在的 mcpServerId
- **当** mcp_configs 中包含该 Bot 不存在的 mcpServerId
- **那么** 系统必须返回 400 错误，说明无效的 mcpServerId
