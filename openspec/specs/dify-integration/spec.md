# Dify Integration

## 目的

定义 Dify provider 的配置、会话标识、流式输出，以及 Dify 场景下与 MCP 配置的边界。

## 需求

### 需求:Bot 配置页面必须展示 Dify 专属字段
当 Bot 的 provider 选择为 `dify` 时，配置表单必须显示 `difyBaseUrl`、`difyApiKey`、`difyAppId` 三个输入字段；当 provider 为其他值时，这三个字段必须隐藏。

#### 场景:选择 dify provider 时显示 Dify 字段
- **当** 管理员在 Bot 配置表单中将 provider 切换为 `dify`
- **那么** 表单必须显示 difyBaseUrl、difyApiKey、difyAppId 输入框，并隐藏 llmApiKey、llmBaseUrl、llmModel 字段

#### 场景:选择非 dify provider 时隐藏 Dify 字段
- **当** 管理员在 Bot 配置表单中选择 `openai-compatible` 或 `anthropic`
- **那么** 表单必须隐藏 difyBaseUrl、difyApiKey、difyAppId 字段

### 需求:Dify API 调用必须传递 user 标识
调用 Dify `/chat-messages` 接口时，必须在请求体中传递 `user` 字段。普通消息的值为当前会话的 `chatKey`；定时任务必须传递能区分目标会话的稳定 user 标识。

#### 场景:发送消息时携带 user 参数
- **当** BotInstance 处理一条来自 chatKey 的消息并调用 DifyClient.chat
- **那么** DifyClient 必须在请求体中包含 `user: chatKey`

#### 场景:定时任务携带 user 参数
- **当** 定时任务调用 Dify provider 生成内容
- **那么** DifyClient 必须在请求体中包含基于目标 chatId 的稳定 user 标识，禁止使用默认占位 user

### 需求:Dify provider 支持流式输出
当 Bot 的 streamingMode 为 `typewriter` 或 `progressive` 且 provider 为 `dify` 时，系统必须使用 Dify 的 `response_mode: streaming` SSE 接口，解析 `event: message` 块逐步输出内容。

#### 场景:typewriter 模式下 Dify 流式输出
- **当** Bot streamingMode 为 typewriter，provider 为 dify，且 WeChat frame 可用
- **那么** 系统必须调用 Dify streaming 接口，按 TYPEWRITER_INTERVAL_MS 间隔更新消息内容

#### 场景:streamingMode 为 none 时使用阻塞模式
- **当** Bot streamingMode 为 none，provider 为 dify
- **那么** 系统必须使用 Dify 的 `response_mode: blocking` 接口

#### 场景:Dify 流式调用失败时降级为阻塞模式
- **当** Dify streaming 接口调用失败
- **那么** 系统必须降级为阻塞模式重试，禁止直接向用户返回错误

### 需求:Context 配置页面在 Dify provider 下隐藏 MCP 区块
当 Bot 的 provider 为 `dify` 时，Context 配置页面的“MCP 能力配置”区块必须隐藏，并显示说明文字告知用户 Dify 内部处理知识库和工具调用。

#### 场景:Dify provider 下隐藏 MCP 配置
- **当** 管理员进入 Dify provider Bot 的 Context 配置页面
- **那么** 必须隐藏 MCP 能力配置区块，显示提示：“该 Bot 使用 Dify 工作流，知识库检索和工具调用由 Dify 内部处理”
