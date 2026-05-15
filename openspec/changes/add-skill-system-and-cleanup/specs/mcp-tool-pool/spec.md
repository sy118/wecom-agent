## 新增需求

### 需求:Agent 工具池必须合并 MCP 与 Skill 工具
BotInstance 在处理非 Dify provider 消息时，必须同时解析当前 Context 启用的 MCP tools 和 Skill tools，并将合并后的工具列表传给 AgentEngine。

#### 场景:Context 同时启用 MCP 和 Skill
- **当** Context 的 `mcpConfigs` 和 `skillConfigs` 均存在 enabled=true 的配置项
- **那么** 系统必须将对应 MCP tools 和 Skill tools 合并后传给 AgentEngine

#### 场景:Context 只启用 Skill
- **当** Context 未启用 MCP 但启用了 Skill
- **那么** 系统必须仅传入 Skill tools，不得因为 MCP tools 为空而跳过 Skill tools

#### 场景:工具名称冲突
- **当** MCP tool 和 Skill tool 生成了相同工具名称
- **那么** 系统必须使用稳定命名规则避免冲突，并在日志中记录原始来源

### 需求:强制调用必须覆盖 MCP 和 Skill
强制调用机制必须同时支持 MCP 配置和 Skill 配置，并在 LLM 调用前完成所有显式配置的 forceCall。

#### 场景:同时存在 forceCall MCP 和 forceCall Skill
- **当** Context 同时启用 forceCall MCP 和 forceCall Skill
- **那么** 系统必须在 LLM 调用前执行两类强制调用，并将结果注入 system prompt

#### 场景:forceCall Skill 执行失败
- **当** forceCall Skill 执行失败
- **那么** 系统必须记录审计和日志，跳过该结果注入，并继续处理用户消息

### 需求:Dify provider 不加载工具池
当 Bot provider 为 `dify` 时，系统必须保持当前 Dify 调用路径，禁止加载 MCP 或 Skill tools 给 AgentEngine。

#### 场景:Dify Bot 配置了 Skill
- **当** Dify Bot 的 Context 中存在 `skillConfigs`
- **那么** 系统必须忽略这些配置的运行时工具加载，并在管理控制台提示工具由 Dify 内部处理

## 修改需求

## 移除需求
