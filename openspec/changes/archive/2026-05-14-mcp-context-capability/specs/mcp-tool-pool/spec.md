## 新增需求

### 需求:Bot 启动时构建工具池
Bot 启动时必须连接所有已启用的 MCP 服务器，将加载的工具按 mcpServerId 分组存入工具池，供后续 invoke 按需过滤。

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

### 需求:AgentEngine 支持动态工具列表
AgentEngine 必须支持每次 invoke 时接收不同的工具列表，不在初始化时绑定工具。

#### 场景:invokeWithTools 接收工具子集
- **当** 调用 `AgentEngine.invokeWithTools(messages, content, systemPrompt, tools)`
- **那么** Agent 必须仅使用传入的 tools 列表，不使用其他工具

#### 场景:initialize 只初始化 LLM
- **当** BotInstance 调用 `engine.initialize()`
- **那么** 系统只初始化 LLM 模型实例，不加载任何 MCP 工具
