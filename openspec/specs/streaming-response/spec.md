# 流式消息输出 (Streaming Response)

## 目的

利用企微长连接的 `stream.id` 机制，将 AI 回复内容实时推送给用户，提供类似打字机的流式体验，替代等待完成后一次性发送的方式。

## 需求

### 需求:流式消息输出
系统必须利用企微长连接的 `stream.id` 机制，将 AI 回复内容实时推送给用户，替代当前的占位消息方式。

#### 场景:LLM 开始生成时创建流式消息
- **当** AgentEngine 开始流式调用 LLM
- **那么** 系统必须通过 `aibot_respond_msg`（`finish=false`）发送第一个 token，在企微侧创建一条流式消息

#### 场景:LLM 生成过程中持续更新
- **当** LLM 每产生新的 token 片段
- **那么** 系统必须使用相同的 `stream.id` 发送 `aibot_respond_msg`（`finish=false`），内容为累积的完整文本，企微侧原地更新该消息

#### 场景:LLM 生成完成时结束流式
- **当** LLM 完成全部内容生成
- **那么** 系统必须发送 `aibot_respond_msg`（`finish=true`），标记流式消息结束

#### 场景:MCP 工具调用期间显示进度
- **当** Agent 调用 MCP 工具（如代码检索）时
- **那么** 系统必须推送一条进度提示（`finish=false`），告知用户正在执行工具调用，避免用户看到消息长时间无更新

#### 场景:流式输出发生错误
- **当** 流式推送过程中发生异常
- **那么** 系统必须发送 `finish=true` 结束流式消息，并在消息内容中包含错误提示，不得留下未完成的流式消息

### 需求:stream.id 生命周期管理
系统必须为每次消息回调生成唯一的 `stream.id`，并在整个流式过程中复用。

#### 场景:每次消息回调生成新 stream.id
- **当** 收到一条新的 `aibot_msg_callback`
- **那么** 系统必须生成一个新的 UUID 作为本次回复的 `stream.id`，与该回调的 `req_id` 绑定

#### 场景:同一回调的所有流式推送使用相同 stream.id
- **当** 同一次消息回调触发的流式推送（包括进度提示和最终回复）
- **那么** 所有推送必须使用相同的 `stream.id`，确保企微侧将其识别为同一条消息的更新

### 需求:Bot 支持流式回复模式配置
每个 Bot 必须支持 `streamingMode` 配置字段，可选值为 `none`、`progressive`、`typewriter`，默认值为 `none`。

#### 场景:默认模式行为不变
- **当** Bot 的 `streamingMode` 为 `none` 或未配置
- **那么** 系统必须先发送"🤔 正在分析，请稍候..."占位消息，LLM 完成后发送新消息作为回复，行为与 v1 完全一致

#### 场景:progressive 模式替换占位消息
- **当** Bot 的 `streamingMode` 为 `progressive` 且 LLM 生成完成
- **那么** 系统必须调用 editMessage 将占位消息替换为完整回复内容

#### 场景:progressive 模式 editMessage 失败降级
- **当** Bot 的 `streamingMode` 为 `progressive` 且 editMessage 调用失败
- **那么** 系统必须 fallback 调用 sendMessage 发送完整回复，禁止让用户看不到回复

#### 场景:typewriter 模式逐步更新消息
- **当** Bot 的 `streamingMode` 为 `typewriter`
- **那么** 系统必须开启 LLM streaming，每累积 800ms 的 token 调用一次 editMessage 更新消息内容，LLM 完成后必须最后一次 editMessage 写入完整内容，禁止再发送新的 sendMessage

#### 场景:typewriter 模式节流保护
- **当** typewriter 模式下 editMessage 调用频率超过每 800ms 一次
- **那么** 系统必须跳过本次更新，等待下一个 800ms 窗口，禁止无限制调用 editMessage

### 需求:WecomAdapter 实现 editMessage
WecomAdapter 必须实现 `editMessage(chatId, msgId, text)` 方法，调用底层 WSClient 的消息更新能力。

#### 场景:editMessage 成功
- **当** 调用 `editMessage(chatId, msgId, text)` 且 WSClient 支持消息更新
- **那么** 系统必须更新指定消息内容并 resolve Promise

#### 场景:editMessage 不支持时抛出
- **当** WSClient 不支持消息更新
- **那么** `editMessage` 必须 throw Error，调用方必须 catch 并降级为 sendMessage
