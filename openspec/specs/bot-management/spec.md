# 机器人管理 (Bot Management)

## 目的

管理企业微信机器人的配置持久化、生命周期控制及 MCP 服务器配置，支持多机器人独立运行，并约束不同 provider、流式模式和视觉能力开关的配置行为。

## 需求

### 需求:机器人配置持久化
系统必须将机器人配置（企业微信凭证、LLM 配置、名称）持久化到 SQLite 数据库，重启后配置不丢失。

#### 场景:创建机器人
- **当** 管理员通过 API POST /api/bots 提交机器人配置
- **那么** 系统将配置写入 bots 表，返回新建机器人的 id 和初始 status=stopped

#### 场景:更新机器人配置
- **当** 管理员通过 API PUT /api/bots/:id 提交更新
- **那么** 系统更新 bots 表对应记录，若机器人正在运行则不自动重启（需手动停止后重启生效）

#### 场景:删除机器人
- **当** 管理员通过 API DELETE /api/bots/:id
- **那么** 系统必须先停止该机器人（若运行中），再级联删除 contexts、bindings、mcp_servers 相关记录

### 需求:机器人生命周期管理
系统必须支持独立启动和停止每个机器人，每个机器人运行时状态相互隔离。

#### 场景:启动机器人
- **当** 管理员通过 API POST /api/bots/:id/start
- **那么** BotManager 从 DB 加载该机器人完整配置，创建 BotInstance，建立企业微信 WebSocket 连接，将 status 更新为 running

#### 场景:启动失败
- **当** 企业微信 WebSocket 连接失败（凭证错误或网络问题）
- **那么** BotInstance 将 status 更新为 error，记录错误信息，不影响其他机器人运行

#### 场景:停止机器人
- **当** 管理员通过 API POST /api/bots/:id/stop
- **那么** BotInstance 关闭 WebSocket 连接，清空该机器人的所有消息队列和内存会话，将 status 更新为 stopped

#### 场景:查询机器人状态
- **当** 管理员通过 API GET /api/bots 或 GET /api/bots/:id
- **那么** 系统返回机器人列表及每个机器人的当前 status（running/stopped/error）

### 需求:MCP 服务器配置
每个机器人必须支持独立配置一个或多个 MCP 服务器，机器人启动时建立独立的 MCP 连接。

#### 场景:配置 MCP 服务器
- **当** 管理员通过 API 为机器人添加 MCP 服务器配置（name、url、transport_type）
- **那么** 配置持久化到 mcp_servers 表，机器人下次启动时使用新配置

#### 场景:MCP 连接失败不阻断启动
- **当** 机器人启动时某个 MCP 服务器连接失败
- **那么** 系统记录错误日志，跳过该 MCP 服务器，继续启动机器人（工具数量减少但机器人可用）

### 需求:Bot 配置支持 provider 字段
`bots` 表必须新增 `provider` 字段，可选值为 `openai-compatible`（默认）、`anthropic`、`dify`，存量数据默认为 `openai-compatible`。

#### 场景:新建 Bot 默认 provider
- **当** 创建 Bot 时未指定 `provider`
- **那么** 系统必须将 `provider` 默认设为 `openai-compatible`，行为与 v1 完全一致

#### 场景:更新 Bot provider
- **当** 管理员通过 UI 修改 Bot 的 `provider` 字段
- **那么** 系统必须在下次 Bot 启动时使用新的 provider 逻辑，当前运行中的 Bot 不受影响直到重启

### 需求:Bot 配置支持 streamingMode 字段
`bots` 表必须新增 `streamingMode` 字段，可选值为 `none`（默认）、`progressive`、`typewriter`。

#### 场景:新建 Bot 默认 streamingMode
- **当** 创建 Bot 时未指定 `streamingMode`
- **那么** 系统必须将 `streamingMode` 默认设为 `none`

### 需求:allowedProjects 改为动态自由输入
Context 的 `allowedProjects` 字段必须支持用户自由输入任意项目名，前端禁止使用硬编码选项列表。

#### 场景:用户自由输入项目名
- **当** 管理员在 Context 编辑表单中配置 `allowedProjects`
- **那么** 前端必须提供 tags 模式输入框，用户可输入任意字符串并回车确认，无预设选项限制

#### 场景:存量 allowedProjects 数据兼容
- **当** 读取包含旧版 15 个硬编码项目名的 Context 记录
- **那么** 系统必须正常显示这些项目名，用户可继续编辑

### 需求:Dify Bot 配置字段
`bots` 表必须新增 `difyBaseUrl`、`difyApiKey`、`difyAppId` 字段，仅在 `provider=dify` 时有效。

#### 场景:Dify 配置字段在 UI 中条件显示
- **当** 管理员在 Bot 编辑表单中选择 `provider=dify`
- **那么** 前端必须显示 `difyBaseUrl`、`difyApiKey`、`difyAppId` 输入框，隐藏 `llmBaseUrl`、`llmModel` 字段

#### 场景:非 Dify provider 隐藏 Dify 字段
- **当** Bot 的 `provider` 为 `openai-compatible` 或 `anthropic`
- **那么** 前端必须隐藏 Dify 相关配置字段，显示 `llmBaseUrl`、`llmApiKey`、`llmModel` 字段

### 需求:Bot 配置支持 visionEnabled 字段
`bots` 表必须新增 `visionEnabled` 布尔字段，默认 `false`，控制是否将图片消息以多模态格式传给 LLM。

#### 场景:visionEnabled 默认关闭保持向后兼容
- **当** 创建 Bot 时未指定 `visionEnabled`
- **那么** 系统必须将 `visionEnabled` 默认设为 `false`，图片消息降级为 `[图片]` 文本，行为与 v1 完全一致

#### 场景:visionEnabled 开启时透传图片
- **当** Bot 的 `visionEnabled` 为 `true` 且收到图片消息
- **那么** 系统必须将图片 URL 以多模态格式传给 LLM，不再降级为文本标签
