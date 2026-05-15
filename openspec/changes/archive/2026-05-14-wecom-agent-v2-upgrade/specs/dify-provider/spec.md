## 新增需求

### 需求:Bot 支持 Dify 作为 LLM provider
Bot 配置必须支持 `provider` 字段，可选值为 `openai-compatible`（默认）、`anthropic`、`dify`。当 `provider` 为 `dify` 时，系统必须通过 HTTP 调用 Dify `/v1/chat-messages` API，绕过 LangChain AgentEngine。

#### 场景:Dify provider 发送消息
- **当** Bot 的 `provider` 为 `dify` 且用户发送消息
- **那么** 系统必须向 `difyBaseUrl/v1/chat-messages` 发送 POST 请求，携带 `query`、`conversation_id`（首次为空）、`response_mode: "blocking"`，并将 `answer` 字段作为回复内容

#### 场景:Dify conversation_id 持久化到 Session
- **当** Dify 返回 `conversation_id`
- **那么** 系统必须将其存入当前 chatKey 的 Session，下次请求时携带，实现多轮对话

#### 场景:Dify Session 过期后重置 conversation_id
- **当** chatKey 的 Session TTL 到期被清除
- **那么** 系统必须清除对应的 `dify_conversation_id`，下次请求以新会话开始

#### 场景:Dify provider 不加载 MCP 工具
- **当** Bot 的 `provider` 为 `dify`
- **那么** 系统禁止初始化 AgentEngine 和加载 MCP 工具，MCP 服务器配置对该 Bot 无效

#### 场景:Dify API 超时处理
- **当** Dify API 请求超过 30 秒未响应
- **那么** 系统必须中止请求并向用户发送错误提示消息

### 需求:Dify Bot 必须配置 difyBaseUrl 和 difyApiKey
当 Bot 的 `provider` 为 `dify` 时，`difyBaseUrl` 和 `difyApiKey` 字段必须非空，否则 Bot 启动必须失败并返回明确错误信息。

#### 场景:缺少 Dify 配置时启动失败
- **当** Bot `provider` 为 `dify` 且 `difyBaseUrl` 或 `difyApiKey` 为空
- **那么** 系统必须拒绝启动该 Bot，返回错误 "Dify provider requires difyBaseUrl and difyApiKey"

### 需求:Anthropic provider 支持
当 Bot 的 `provider` 为 `anthropic` 时，系统必须使用 `@langchain/anthropic` 的 `ChatAnthropic` 替代 `ChatOpenAI`，其余 AgentEngine 逻辑不变。

#### 场景:Anthropic provider 正常调用
- **当** Bot 的 `provider` 为 `anthropic` 且配置了有效的 `llmApiKey` 和 `llmModel`
- **那么** 系统必须通过 ChatAnthropic 调用 Claude API，MCP 工具正常有效

## 修改需求

## 移除需求
