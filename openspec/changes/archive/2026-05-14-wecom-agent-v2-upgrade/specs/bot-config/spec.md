## 新增需求

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

## 修改需求

## 移除需求
