## 新增需求

### 需求:Skill 注册
系统必须支持管理员在 Bot 级别注册 Skill，并持久化 Skill 的名称、描述、类型、启用状态、参数 schema、manifest 和权限策略。

#### 场景:创建 prompt Skill
- **当** 管理员提交类型为 `prompt` 的 Skill，且包含有效名称、描述、prompt 内容和参数 schema
- **那么** 系统必须创建 Skill 记录，并在后续 Context 配置中允许选择该 Skill

#### 场景:创建 script Skill
- **当** 管理员提交类型为 `script` 的 Skill，且 manifest 包含 runtime、入口文件、工具名称和输入 schema
- **那么** 系统必须创建 Skill 记录，并保存脚本权限策略

#### 场景:禁用 Skill
- **当** 管理员将某个 Skill 设置为 disabled
- **那么** 系统必须在 Bot 启动和消息处理时忽略该 Skill，不得将其加入可用工具列表

### 需求:Context 级 Skill 配置
系统必须支持在 Context 中配置 `skillConfigs`，每个配置项必须包含 `skillId`、`enabled`、`params`，并可选包含 `forceCall`。

#### 场景:启用 Context Skill
- **当** 管理员在 Context 表单中启用某个属于当前 Bot 的 Skill
- **那么** 系统必须将该 Skill 的配置序列化存入 `skill_configs`，并在读取 Context 时反序列化为 `skillConfigs`

#### 场景:引用不存在的 Skill
- **当** 管理员提交的 `skillConfigs` 包含不属于当前 Bot 的 `skillId`
- **那么** API 必须返回 400 错误，并说明无效的 `skillId`

#### 场景:Context 未启用 Skill
- **当** Context 的 `skillConfigs` 为空或所有配置项 `enabled=false`
- **那么** 消息处理时不得加载任何 Skill 工具

### 需求:prompt Skill 注入
类型为 `prompt` 的 Skill 必须在消息处理时按 Context 配置注入 system prompt，且不得污染会话历史。

#### 场景:注入 prompt Skill
- **当** Context 启用了一个 prompt Skill
- **那么** 系统必须将 Skill 的 prompt 内容追加到本次 system prompt 中，并标记 Skill 名称作为分隔

#### 场景:多个 prompt Skill
- **当** Context 启用了多个 prompt Skill
- **那么** 系统必须按 `skillConfigs` 数组顺序注入 prompt 内容

### 需求:script Skill 工具化
类型为 `script` 的 Skill 必须被包装为 AgentEngine 可调用的工具，工具输入必须基于 Skill manifest 和 Context params 构建。

#### 场景:Agent 自主调用 script Skill
- **当** Context 启用了 script Skill 且 `forceCall` 未开启
- **那么** 系统必须将该 Skill 转换为 tool 传入 AgentEngine，由 LLM 自主决定是否调用

#### 场景:强制调用 script Skill
- **当** Context 中某个 script Skill 配置了 `forceCall=true`
- **那么** 系统必须在 LLM 调用前先执行该 Skill，并将执行结果注入本次 system prompt

#### 场景:Dify provider 忽略 Skill tools
- **当** Bot provider 为 `dify`
- **那么** 系统必须忽略 `skillConfigs` 的运行时工具加载，直接走 Dify API 调用流程

### 需求:脚本执行安全策略
系统必须默认禁止任意脚本执行，只有满足全局开关、Skill 启用状态和 Context 启用状态时才允许执行 script Skill。

#### 场景:脚本全局开关关闭
- **当** 全局脚本执行开关关闭
- **那么** 系统不得执行任何 script Skill，并必须记录跳过原因

#### 场景:脚本超时
- **当** script Skill 执行时间超过权限策略中的 `timeoutMs`
- **那么** 系统必须终止该次执行，记录审计日志，并向 Agent 返回明确的超时结果

#### 场景:输出超过限制
- **当** script Skill 输出超过 `maxOutputBytes`
- **那么** 系统必须截断输出，记录审计日志，并禁止返回超过限制的完整内容

#### 场景:禁止任意 shell 字符串
- **当** script Skill manifest 试图提交任意 shell 命令字符串而非受控 runtime 和入口文件
- **那么** 系统必须拒绝保存或拒绝执行该 Skill

### 需求:Skill 审计
系统必须为每次 script Skill 执行写入审计记录，记录执行状态、耗时、输入摘要、输出摘要和错误摘要。

#### 场景:执行成功写入审计
- **当** script Skill 执行成功
- **那么** 系统必须写入 status 为 `success` 的审计记录

#### 场景:执行失败写入审计
- **当** script Skill 执行失败、超时或被权限策略阻止
- **那么** 系统必须写入 status 为 `error`、`timeout` 或 `blocked` 的审计记录

#### 场景:审计不得泄露密钥
- **当** Skill 输入或输出包含 secret 类型参数
- **那么** 审计记录必须脱敏该参数，禁止保存明文密钥

## 修改需求

## 移除需求
