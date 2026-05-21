## 目的

定义 Bot 级别 MCP 工具池的构建、Context 级参数配置、强制调用和 per-invoke 工具过滤规范，以及 AgentEngine 动态工具列表支持。

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

### 需求:Context MCP 参数模式
MCP Server 配置必须支持可选的 `paramSchema` 字段，Context 配置页面必须根据参数模式动态渲染参数表单，并以通用 `params` 键值结构保存。

#### 场景:创建 MCP Server 时可填写 paramSchema
- **当** 管理员在 MCP Server 管理页面创建或编辑 Server 时
- **那么** 页面必须提供 `paramSchema` 配置区域，允许添加多个参数声明条目

#### 场景:paramSchema 为空时不影响 MCP Server 正常使用
- **当** MCP Server 的 `paramSchema` 为空或 null
- **那么** 系统必须正常加载该 Server，Context 配置页面不渲染任何参数表单

#### 场景:根据参数类型渲染控件
- **当** `paramSchema` 中参数类型为 `string[]`、`string`、`number` 或 `boolean`
- **那么** Context 配置页面必须分别渲染标签选择器、文本输入框、数字输入框或开关控件

#### 场景:未知 type 降级为文本输入
- **当** `paramSchema` 中某参数的 type 不在已知类型列表中
- **那么** 必须降级渲染为普通 Input 文本输入框

#### 场景:保存 Context 时 params 以通用结构存储
- **当** 管理员保存 Context 配置时
- **那么** 系统必须将各 MCP Server 的参数以 `{ [key]: value }` 格式存入 `McpConfig.params`

#### 场景:params.allowedProjects 存在时注入 system prompt
- **当** `McpConfig.params.allowedProjects` 为非空数组
- **那么** 系统必须将项目列表注入 system prompt 的“项目范围限制”章节

### 需求:MCP 强制调用
McpConfig 必须支持可选的 `forceCall` 布尔字段。当 `forceCall` 为 `true` 时，该 MCP 工具在每条用户消息处理前必须被强制调用，并将结果注入系统提示。

#### 场景:Context 配置页面显示强制调用开关
- **当** 管理员在 Context 配置页面启用某个 MCP Server 时
- **那么** 必须显示“强制调用”开关，默认为关闭

#### 场景:强制调用成功时结果注入 system prompt
- **当** 存在 `forceCall=true` 的 MCP 配置，且工具调用成功
- **那么** 系统必须将工具返回内容追加到 system prompt 的“强制检索结果”区域

#### 场景:强制调用无结果时不得发送空消息
- **当** forceCall MCP 调用失败、超时或返回空内容
- **那么** 系统不得向企业微信发送空字符串
- **并且** 必须继续执行 LLM 或返回明确的降级提示

#### 场景:强制调用失败时不阻断消息处理
- **当** forceCall MCP 工具调用抛出异常或超时
- **那么** 系统必须记录错误日志，跳过该工具的结果注入，继续正常 LLM 调用

#### 场景:多个强制调用 MCP 串行执行
- **当** Context 中有多个 McpConfig 的 `forceCall` 均为 true
- **那么** 系统必须按 `mcpConfigs` 数组顺序依次执行，全部完成后再调用 LLM

#### 场景:Dify provider 忽略强制调用配置
- **当** Bot provider 为 dify
- **那么** 系统必须忽略所有 forceCall 配置，直接走 Dify API 调用流程

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
