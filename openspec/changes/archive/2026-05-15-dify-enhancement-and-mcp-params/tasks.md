## 1. 数据库迁移

- [x] 1.1 在 `apps/api/src/db/schema.ts` 的 `mcpServers` 表增加 `param_schema TEXT` 列（nullable）
- [x] 1.2 在 `apps/api/src/db/schema.ts` 的 `contexts` 表的 mcpConfigs JSON 结构中，确认 `forceCall` 字段已在类型定义中声明（无需 DDL 变更，mcpConfigs 存为 JSON）
- [x] 1.3 编写数据库迁移脚本，为现有 mcpServers 记录添加 `param_schema` 列

## 2. 类型定义更新

- [x] 2.1 在 `@wecom-platform/types` 中更新 `McpServerConfig`，增加 `paramSchema?: ParamSchemaItem[]` 字段
- [x] 2.2 在 `@wecom-platform/types` 中定义 `ParamSchemaItem` 类型：`{ key: string; label: string; type: 'string' | 'string[]' | 'number' | 'boolean'; description?: string }`
- [x] 2.3 在 `@wecom-platform/types` 中更新 `McpConfig`，将 `params` 改为 `Record<string, any>`，增加 `forceCall?: boolean` 字段

## 3. API 后端 - MCP Server

- [x] 3.1 更新 `apps/api/src/routes/mcp-servers.ts` 的 create/update 接口，支持接收和存储 `paramSchema` 字段（JSON 序列化存储）
- [x] 3.2 更新 `apps/api/src/routes/mcp-servers.ts` 的 list/get 接口，返回时反序列化 `paramSchema` 字段
- [x] 3.3 更新 `apps/api/src/db/mcp-server-repository.ts`，CRUD 操作支持 `paramSchema` 字段

## 4. API 后端 - Bot 配置

- [x] 4.1 更新 `apps/api/src/routes/bots.ts` 的 create/update 接口，确保 `difyBaseUrl`、`difyApiKey`、`difyAppId` 字段正确处理（已有字段，确认 validation 完整）
- [x] 4.2 更新 `apps/api/src/routes/bots.ts` 的 list/get 接口，返回 Bot 数据时包含 `provider` 字段供前端判断

## 5. BotInstance - Dify 增强

- [x] 5.1 更新 `apps/api/src/bot-manager/bot-instance.ts` 的 `handleDify` 方法，向 `DifyClient.chat` 传递 `chatKey` 作为 `user` 参数
- [x] 5.2 更新 `DifyClient`（`packages/core` 或内联），`chat` 方法增加 `user` 参数，在请求体中传递
- [x] 5.3 在 `DifyClient` 中实现流式调用方法 `chatStream`，调用 `response_mode: streaming`，解析 SSE 流中 `event: message` 块，通过 `onToken` 回调逐步输出
- [x] 5.4 在 `BotInstance` 中增加 `handleDifyStreaming` 方法，复用 `handleTypewriter` 的 streamId 逻辑，调用 `DifyClient.chatStream`
- [x] 5.5 在 `BotInstance.handleMessage` 中，当 provider 为 dify 且 streamingMode 非 none 时，路由到 `handleDifyStreaming`

## 6. BotInstance - MCP 强制调用

- [x] 6.1 在 `BotInstance` 中实现 `executeForceCallMcps` 方法：收集 `forceCall: true` 的 McpConfig，依次调用对应工具（传入用户消息作为 query），拼接结果字符串
- [x] 6.2 在 `BotInstance.handleMessage` 的队列处理中，在 `resolveTools` 之后、LLM 调用之前，调用 `executeForceCallMcps`，将结果追加到 systemPrompt
- [x] 6.3 `executeForceCallMcps` 中单个工具调用失败时，捕获异常记录日志，跳过该工具继续执行

## 7. AgentEngine - MCP 执行稳定性

- [x] 7.1 在 `packages/core/src/agent-engine.ts` 中为 `invokeWithTools` 和 `invokeWithStream` 传入可配置 `recursionLimit`，默认值建议为 50
- [x] 7.2 参考旧版 `src/wecom-adapter.ts`，在 Agent 执行中使用或等价支持 `streamMode: "messages"`，收集执行过程中的 AI/Tool 消息
- [x] 7.3 增强结果提取逻辑：优先返回最后一个非空 AI 文本；如果最后一条 content 为空但存在中间有效回答，不得返回空字符串
- [x] 7.4 增加 tool call 与消息结构日志，能区分“LLM 没有发起 tool call”“tool call 执行失败”“结果提取为空”三类问题
- [x] 7.5 增加空回复 fallback，禁止向企业微信发送空内容
- [x] 7.6 处理 `GRAPH_RECURSION_LIMIT` / recursion limit 错误：基于已收集的中间消息调用不带 tools 的基础模型生成阶段性总结

## 8. 前端 - MCP Server 管理页面

- [x] 7.1 更新 `apps/web/src/pages/McpServersPage.tsx`，在 MCP Server 表单中增加 paramSchema 配置区域（动态增删参数条目，每条包含 key、label、type 下拉、description 输入）
- [x] 7.2 在 MCP Server 列表中展示 paramSchema 条目数量（如"3 个参数"）

## 9. 前端 - Context 配置页面

- [x] 8.1 更新 `apps/web/src/pages/ContextsPage.tsx`，从 API 获取 Bot 信息（provider 字段），当 provider 为 dify 时隐藏 MCP 能力配置区块，显示 Dify 说明提示
- [x] 8.2 更新 `ContextsPage.tsx` 的 MCP Server 卡片，根据 `server.paramSchema` 动态渲染参数表单，替换硬编码的"可查项目" Select tags
- [x] 8.3 在 MCP Server 卡片中增加"强制调用"Switch 控件，绑定 `McpConfig.forceCall` 字段
- [x] 8.4 更新 `toggleMcp`、`getMcpConfig` 等状态管理函数，支持 `forceCall` 字段的读写

## 10. 前端 - Bot 配置页面

- [x] 9.1 更新 `apps/web/src/pages/BotsPage.tsx`，当 provider 选择 `dify` 时显示 difyBaseUrl、difyApiKey、difyAppId 输入字段，隐藏 llmApiKey、llmBaseUrl、llmModel 字段
- [x] 9.2 确保 Bot 表单提交时，dify 字段正确包含在 payload 中

## 11. WeComAdapter - 引用消息解析

- [x] 11.1 更新 `packages/core/src/wecom-adapter.ts` 的消息类型定义，补充 `body.quote` 的 text/image 等结构
- [x] 11.2 更新 `parseContent`，读取 `body.quote` 并将文本引用拼接到当前消息中
- [x] 11.3 更新 `parseContent`，在 visionEnabled 为 true 时将引用图片作为多模态内容传递
- [x] 11.4 更新 `parseContent`，在 visionEnabled 为 false 时将引用图片降级为 `[引用图片]`
- [x] 11.5 增加引用字段为空或未知类型时的兼容处理，保持现有消息解析行为

## 12. WeComAdapter - 图片解密

- [x] 12.1 在 `packages/core/src/wecom-adapter.ts` 中实现图片下载与 AES 解密工具函数，输入图片 URL 和 aeskey，输出解密后的图片 buffer/base64
- [x] 12.2 更新图片消息解析逻辑：visionEnabled 为 true 且存在 aeskey 时，先解密再传递给 LLM
- [x] 12.3 更新图片消息解析逻辑：visionEnabled 为 false 时降级为 `[图片]`，不下载或解密图片
- [x] 12.4 将同一图片解密逻辑复用于引用图片处理
- [x] 12.5 增加图片下载或解密失败时的降级处理，记录日志并返回 `[图片解密失败]` 占位

## 13. 验证

- [x] 13.1 运行 OpenSpec 验证，确认新增 wecom-quote-parsing 与 wecom-image-decrypt 规格格式正确
- [x] 13.2 运行类型检查，确认新增类型定义与调用链一致
- [x] 13.3 增加或更新单元测试，覆盖 Dify user 参数、Dify streaming、paramSchema 动态参数、forceCall、AgentEngine 空回复保护、recursion limit 恢复、quote parsing、图片 aeskey 解密降级场景
