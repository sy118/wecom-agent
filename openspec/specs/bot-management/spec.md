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

### 需求:Bot 支持 Dify 作为 LLM provider
Bot 配置必须支持 `provider` 字段，可选值为 `openai-compatible`（默认）、`anthropic`、`dify`。当 `provider` 为 `dify` 时，系统必须通过 HTTP 调用 Dify `/v1/chat-messages` API，绕过 LangChain AgentEngine。

#### 场景:新建 Bot 默认 provider
- **当** 创建 Bot 时未指定 `provider`
- **那么** 系统必须将 `provider` 默认设为 `openai-compatible`，行为与 v1 完全一致

#### 场景:更新 Bot provider
- **当** 管理员通过 UI 修改 Bot 的 `provider` 字段
- **那么** 系统必须在下次 Bot 启动时使用新的 provider 逻辑，当前运行中的 Bot 不受影响直到重启

#### 场景:Dify provider 发送消息
- **当** Bot 的 `provider` 为 `dify` 且用户发送消息
- **那么** 系统必须向 `difyBaseUrl/v1/chat-messages` 发送 POST 请求，携带 `query`、`conversation_id`（首次为空）、`response_mode: "blocking"` 和 `user: chatKey`，并将 `answer` 字段作为回复内容

#### 场景:Dify conversation_id 持久化到 Session
- **当** Dify 返回 `conversation_id`
- **那么** 系统必须将其存入当前 chatKey 的 Session，下次请求时携带，实现多轮对话

#### 场景:Dify Session 过期后重置 conversation_id
- **当** chatKey 的 Session TTL 到期被清除
- **那么** 系统必须清除对应的 `dify_conversation_id`，下次请求以新会话开始

#### 场景:Dify provider 不加载本地工具
- **当** Bot 的 `provider` 为 `dify`
- **那么** 系统禁止初始化 AgentEngine、加载 MCP 工具或加载本地 Skill 工具，相关 Context 配置由 Dify 内部处理

#### 场景:Dify API 超时处理
- **当** Dify API 请求超过 30 秒未响应
- **那么** 系统必须中止请求并向用户发送错误提示消息

#### 场景:Anthropic provider 正常调用
- **当** Bot 的 `provider` 为 `anthropic` 且配置了有效的 `llmApiKey` 和 `llmModel`
- **那么** 系统必须通过 ChatAnthropic 调用 Claude API，MCP 工具正常有效

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
`bots` 表必须新增 `difyBaseUrl`、`difyApiKey`、`difyAppId` 字段，仅在 `provider=dify` 时有效；当 Bot 的 `provider` 为 `dify` 时，`difyBaseUrl` 和 `difyApiKey` 字段必须非空，否则 Bot 启动必须失败并返回明确错误信息。

#### 场景:Dify 配置字段在 UI 中条件显示
- **当** 管理员在 Bot 编辑表单中选择 `provider=dify`
- **那么** 前端必须显示 `difyBaseUrl`、`difyApiKey`、`difyAppId` 输入框，隐藏 `llmBaseUrl`、`llmModel` 字段

#### 场景:非 Dify provider 隐藏 Dify 字段
- **当** Bot 的 `provider` 为 `openai-compatible` 或 `anthropic`
- **那么** 前端必须隐藏 Dify 相关配置字段，显示 `llmBaseUrl`、`llmApiKey`、`llmModel` 字段

#### 场景:缺少 Dify 配置时启动失败
- **当** Bot `provider` 为 `dify` 且 `difyBaseUrl` 或 `difyApiKey` 为空
- **那么** 系统必须拒绝启动该 Bot，返回错误 "Dify provider requires difyBaseUrl and difyApiKey"

### 需求:Dify provider 支持流式输出
当 Bot 的 `streamingMode` 为 `typewriter` 或 `progressive` 且 provider 为 `dify` 时，系统必须使用 Dify 的 `response_mode: streaming` SSE 接口，解析 `event: message` 块逐步输出内容。

#### 场景:typewriter 模式下 Dify 流式输出
- **当** Bot streamingMode 为 typewriter，provider 为 dify，且 WeChat frame 可用
- **那么** 系统必须调用 Dify streaming 接口，按 TYPEWRITER_INTERVAL_MS 间隔更新消息内容

#### 场景:streamingMode 为 none 时使用阻塞模式
- **当** Bot streamingMode 为 none，provider 为 dify
- **那么** 系统必须使用 Dify 的 `response_mode: blocking` 接口

#### 场景:Dify 流式调用失败时降级为阻塞模式
- **当** Dify streaming 接口调用失败
- **那么** 系统必须降级为阻塞模式重试，禁止直接向用户返回错误

#### 场景:定时任务携带 user 参数
- **当** 定时任务调用 Dify provider 生成内容
- **那么** DifyClient 必须在请求体中包含基于目标 chatId 的稳定 user 标识，禁止使用默认占位 user

#### 场景:Dify provider 下隐藏 MCP 配置
- **当** 管理员进入 Dify provider Bot 的 Context 配置页面
- **那么** 必须隐藏 MCP 能力配置区块，显示提示：“该 Bot 使用 Dify 工作流，工具调用由 Dify 内部处理”

### 需求:Bot 配置支持 visionEnabled 字段
`bots` 表必须新增 `visionEnabled` 布尔字段，默认 `false`，控制是否将图片消息以多模态格式传给 LLM。

#### 场景:visionEnabled 默认关闭保持向后兼容
- **当** 创建 Bot 时未指定 `visionEnabled`
- **那么** 系统必须将 `visionEnabled` 默认设为 `false`，图片消息降级为 `[图片]` 文本，行为与 v1 完全一致

#### 场景:visionEnabled 开启时透传图片
- **当** Bot 的 `visionEnabled` 为 `true` 且收到图片消息
- **那么** 系统必须将图片 URL 以多模态格式传给 LLM，不再降级为文本标签
