## 目的

定义 Bot 级别 MCP 工具池的构建和 per-invoke 工具过滤规范，以及 AgentEngine 动态工具列表支持。

## 需求

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

### 需求:Agent 工具池必须合并 MCP 与 Skill 通用脚本工具

BotInstance 在处理非 Dify provider 消息时，必须同时解析当前 Context 启用的 MCP tools 和 Skill 通用脚本工具，并将合并后的工具列表传给 AgentEngine。

#### 场景:Context 同时启用 MCP 和包含脚本的 Skill

- **当** Context 的 `mcpConfigs` 和 `skillConfigs` 均存在 `enabled=true` 的配置项
- **并且** 至少一个启用 Skill 包含 `scripts/` 资源
- **那么** 系统必须将对应 MCP tools 和 `run_skill_script` 工具合并后传给 AgentEngine

#### 场景:Context 只启用 Skill

- **当** Context 未启用 MCP 但启用了包含脚本的 Skill
- **那么** 系统必须传入 `run_skill_script`
- **并且** 不得因 MCP tools 为空而跳过 Skill 工具

#### 场景:Context Skill 无脚本资源

- **当** Context 启用的 Skill 均不包含脚本资源
- **那么** 系统不得注入 `run_skill_script`
- **并且** 仍然可以注入 Skill 元数据和触发的 `SKILL.md` 指令

### 需求:MCP forceCall 与 Skill forceUse 并存

系统必须保持 MCP 的 `forceCall` 机制；Skill 必须使用 `forceUse` 表示强制加载 `SKILL.md`，并禁止将 Skill bundle 脚本自动强制执行。

#### 场景:同时存在 forceCall MCP 和 forceUse Skill

- **当** Context 同时启用了 `forceCall=true` 的 MCP 和 `forceUse=true` 的 Skill
- **那么** 系统必须在 LLM 调用前执行 MCP forceCall
- **并且** 必须将 Skill 的 `SKILL.md` 指令注入 system prompt

### 需求:Dify provider 不加载本地工具池

当 Bot provider 为 `dify` 时，系统必须保持当前 Dify 调用路径，禁止加载 MCP 或 Skill tools 给 AgentEngine。

#### 场景:Dify Bot 配置了 Skill

- **当** Dify Bot 的 Context 中存在 `skillConfigs`
- **那么** 系统必须忽略这些配置的运行时工具加载
- **并且** 管理控制台必须提示工具由 Dify 内部处理
