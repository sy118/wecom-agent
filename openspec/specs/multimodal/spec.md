# 多模态消息支持 (Multimodal)

## 目的

支持企业微信图片和图文混合消息透传给视觉 LLM，通过 `visionEnabled` 开关控制，保持对纯文本模型的向后兼容。
## 需求
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

### 需求:图片生成模型接入
系统必须支持配置并调用图片生成模型，图片生成能力必须与现有文本/视觉输入对话能力区分。

#### 场景:通过企微触发图片生成
- **当** 有权限用户发送 `/image 一张蓝色科技风海报`
- **那么** 系统必须使用图片生成模型或创建图片生成任务
- **并且** 禁止将该命令作为普通文本问题交给聊天模型回答

#### 场景:图片生成模型未配置
- **当** 用户发送 `/image 一张海报`
- **并且** 当前 Bot 或平台未启用图片生成模型
- **那么** 系统必须返回图片生成能力未开启提示

### 需求:图片生成结果返回
系统必须在图片生成成功后通过企业微信返回可访问的图片、文件或受控下载链接。

#### 场景:企微支持图片发送
- **当** 图片生成任务成功且企微适配器支持发送图片
- **那么** 系统必须向原 chatId 返回图片结果

#### 场景:企微不支持图片发送
- **当** 图片生成任务成功但企微适配器不支持发送图片
- **那么** 系统必须返回受控下载链接
- **并且** 链接必须受过期时间和访问权限约束

### 需求:图片生成失败处理
系统必须处理图片生成模型失败、超时、限流和内容安全拒绝，并向用户返回可理解的失败原因。

#### 场景:内容安全拒绝
- **当** 图片生成模型或内容安全策略拒绝请求
- **那么** 系统必须将任务标记为失败
- **并且** 返回内容不符合生成规则的提示

#### 场景:模型限流
- **当** 图片生成模型返回限流错误
- **那么** 系统必须返回稍后重试提示
- **并且** 记录限流错误用于监控

