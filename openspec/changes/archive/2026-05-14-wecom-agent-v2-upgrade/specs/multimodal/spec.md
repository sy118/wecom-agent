## 新增需求

### 需求:图片消息透传给视觉 LLM
当 Bot 收到图片消息时，系统必须将图片 URL 以 LangChain 多模态格式传给 LLM，而不是丢弃为 `[图片]` 文本标签。

#### 场景:图片消息调用视觉 LLM
- **当** Bot 收到 `MessageType.Image` 消息且 `provider` 为 `openai-compatible` 或 `anthropic`
- **那么** 系统必须构建包含 `{ type: 'image_url', image_url: { url } }` 的 LangChain `HumanMessage`，将图片 URL 和可选文字一起传给 LLM

#### 场景:图文混合消息透传
- **当** Bot 收到 `mixed` 类型消息（含文字和图片）
- **那么** 系统必须将所有文字和图片 URL 按顺序组合为 LangChain 多模态 `HumanMessage.content` 数组传给 LLM

#### 场景:LLM 不支持视觉时降级
- **当** LLM 返回不支持多模态的错误（如 400/422）
- **那么** 系统必须 fallback 为纯文本描述（`[图片: <url>]`）重试一次，并记录 warning 日志

### 需求:语音消息继续使用 ASR 转写
语音消息必须继续使用 WeCom SDK 提供的 ASR 转写文本，不做额外处理。

#### 场景:语音消息转写后传给 LLM
- **当** Bot 收到 `MessageType.Voice` 消息
- **那么** 系统必须使用 `body.voice.recognition` 转写文本作为纯文本内容传给 LLM；若转写为空则发送提示"收到语音消息，但未能识别文字内容"

### 需求:Session 历史支持结构化内容
`SessionMessage.content` 必须支持 `string | IncomingContent[]`，以便多轮对话时图片上下文不丢失。

#### 场景:图片消息存入 Session 历史
- **当** Bot 处理完含图片的消息
- **那么** 系统必须将 `IncomingContent[]`（含图片 URL）存入 Session 历史，下次对话时作为历史 HumanMessage 的多模态内容重建

#### 场景:Session 历史重建多模态 HumanMessage
- **当** AgentEngine 从 Session 历史构建 BaseMessage 数组
- **那么** 对于 `content` 为 `IncomingContent[]` 的历史消息，系统必须构建多模态 `HumanMessage`；对于 `string` 类型则构建普通 `HumanMessage`

### 需求:Dify provider 多模态支持
当 Bot 的 `provider` 为 `dify` 且收到图片消息时，系统必须将图片 URL 通过 Dify API 的 `files` 字段传递。

#### 场景:Dify 图片消息传递
- **当** Bot `provider` 为 `dify` 且收到图片消息
- **那么** 系统必须在 POST `/v1/chat-messages` 请求体中包含 `files` 数组，每个图片以 `{ type: 'image', transfer_method: 'remote_url', url }` 格式传递

### 需求:Bot 配置支持视觉模式开关
Bot 配置必须支持 `visionEnabled` 布尔字段（默认 `false`），用于控制是否启用多模态图片传递。

#### 场景:visionEnabled 为 false 时图片降级为文本
- **当** Bot 的 `visionEnabled` 为 `false` 且收到图片消息
- **那么** 系统必须将图片内容降级为 `[图片]` 文本标签，行为与 v1 一致，不向 LLM 传递图片 URL

#### 场景:visionEnabled 为 true 时透传图片
- **当** Bot 的 `visionEnabled` 为 `true` 且收到图片消息
- **那么** 系统必须按多模态格式透传图片 URL 给 LLM

## 修改需求

## 移除需求
