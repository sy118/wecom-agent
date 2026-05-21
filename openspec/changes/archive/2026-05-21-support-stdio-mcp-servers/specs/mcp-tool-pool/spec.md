## 新增需求

### 需求:Bot 工具池支持 stdio MCP Server
Bot 启动或刷新 MCP 工具池时，必须同时支持从 enabled=true 的 SSE、stdio 和 Streamable HTTP MCP Server 加载工具。

#### 场景:工具池包含 stdio MCP 工具
- **当** Bot 启动时存在 enabled=true 的 stdio MCP Server
- **并且** 该 Server 成功返回工具列表
- **那么** BotInstance 必须将这些工具按该 mcpServerId 分组存入工具池

#### 场景:stdio MCP Server 失败不阻断工具池
- **当** 某个 stdio MCP Server 无法启动或无法加载工具
- **那么** 系统必须记录错误日志，跳过该服务器
- **并且** 继续加载其他 SSE、stdio 或 Streamable HTTP MCP Server

#### 场景:工具池包含 Streamable HTTP MCP 工具
- **当** Bot 启动时存在 enabled=true 的 Streamable HTTP MCP Server
- **并且** 该 Server 成功返回工具列表
- **那么** BotInstance 必须将这些工具按该 mcpServerId 分组存入工具池

#### 场景:Streamable HTTP MCP Server 失败不阻断工具池
- **当** 某个 Streamable HTTP MCP Server 无法连接或无法加载工具
- **那么** 系统必须记录错误日志，跳过该服务器
- **并且** 继续加载其他 SSE、stdio 或 Streamable HTTP MCP Server

## 修改需求

### 需求:Bot 启动时构建工具池
Bot 启动时必须连接所有已启用的 MCP 服务器，包括 SSE、stdio 和 Streamable HTTP 传输类型，将加载的工具按 mcpServerId 分组存入工具池，供后续 invoke 按需过滤。

#### 场景:正常启动加载工具池
- **当** Bot 启动（BotManager.start 调用）
- **那么** BotInstance 必须为每个 enabled=true 的 MCP 服务器建立连接，将工具列表存入 `toolPool: Map<mcpServerId, Tool[]>`

#### 场景:MCP 连接失败不阻断启动
- **当** 某个 MCP 服务器连接失败
- **那么** 系统必须记录错误日志，跳过该服务器，继续启动；该 mcpServerId 在 toolPool 中不存在条目

#### 场景:invoke 时按 Context 过滤工具
- **当** BotInstance 处理某个 chatKey 的消息，该 chatKey 对应 Context 的 mcp_configs 为 `[{"mcpServerId":"xxx","enabled":true}]`
- **那么** 系统必须从 toolPool 中取出 mcpServerId=xxx 的工具列表，传给 AgentEngine 调用

#### 场景:Context 未启用任何 MCP
- **当** Context 的 mcp_configs 为空数组或所有条目 enabled=false
- **那么** Agent 以空工具列表调用，仅依赖 LLM 自身能力回答

## 移除需求
