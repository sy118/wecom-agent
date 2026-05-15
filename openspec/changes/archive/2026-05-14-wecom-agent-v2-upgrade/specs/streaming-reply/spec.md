## 新增需求

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

## 修改需求

## 移除需求
