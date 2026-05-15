## 新增需求

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

## 修改需求
## 移除需求
