## 上下文

wecom-agent 是一个企业微信机器人管理平台，支持多 Bot、多 Context、MCP 工具调用。当前存在四类问题：

1. Dify provider 已有基础实现（`DifyClient`、`handleDify`），但 Bot 配置 UI 缺少 Dify 字段，`user` 参数未传递，不支持流式输出，Context 页面对 Dify provider 没有特殊处理
2. MCP 能力配置中 `allowedProjects` 是 gitnexus 专属硬编码字段，无法扩展到其他 MCP Server；同时缺少"强制调用"机制，所有 MCP 工具均由 LLM 自主决定是否调用。实际验证中，即使日志显示已解析并传入 16 个 MCP tools，模型也可能只回复“马上调用 MCP 工具查询”而不发起 tool call，或返回空 content 导致企业微信 `empty content` 错误
3. WeComAdapter 未读取企业微信回调中的 `body.quote` 字段，导致用户回复引用消息时，被引用内容不会进入 LLM 上下文
4. 企业微信图片消息在携带 `aeskey` 时 URL 指向加密图片内容，现有图片解析无法将解密后的图片交给视觉模型

技术栈：TypeScript、Hono、React + Ant Design、Drizzle ORM + SQLite、LangChain AgentEngine。

## 目标 / 非目标

**目标：**
- 完善 Dify provider 的 Bot 配置 UI（difyBaseUrl、difyApiKey、difyAppId 字段）
- Dify API 调用时传递 `user` 参数（使用 chatKey 作为唯一标识）
- 支持 Dify 流式输出（streaming mode = typewriter/progressive 时走 SSE）
- Context 配置页面在 Bot provider 为 dify 时隐藏 MCP 能力配置区块
- McpServer 增加 `paramSchema` 字段，声明参数结构
- McpConfig 的 `params` 改为通用 `Record<string, any>`，前端动态渲染
- McpConfig 增加 `forceCall` 字段，标记为强制调用的 MCP 在每条消息前先执行并注入结果
- AgentEngine 参考旧版 `src/wecom-adapter.ts` 的 Agent stream 执行经验，增强 MCP 调用链路的可观测性、递归限制、空回复保护与中断恢复
- WeComAdapter 解析 `body.quote`，将引用内容与当前消息一起传递给 LLM
- WeComAdapter 在图片消息携带 `aeskey` 时下载并解密图片，visionEnabled 关闭时降级为文本占位

**非目标：**
- 不实现 Dify 知识库 API（`/v1/datasets`）的直接集成，Dify 侧的 RAG 配置由用户在 Dify 平台自行完成
- 不实现多 Agent 路由编排
- 不改变 MCP Server 的连接协议（仍为 SSE/stdio）

## 决策

### 1. Dify user 参数：使用 chatKey

chatKey 格式为 `wecom:group:<id>` 或 `wecom:user:<id>`，在 Bot 内唯一，直接作为 Dify 的 `user` 字段。无需额外映射表。

### 2. Dify 流式输出：复用现有 streaming mode 字段

Bot 已有 `streamingMode: 'none' | 'progressive' | 'typewriter'`。当 provider 为 dify 且 streamingMode 非 none 时，调用 Dify 的 `response_mode: 'streaming'` SSE 接口，解析 `event: message` 块拼接输出。

替代方案：为 Dify 单独加一个 streaming 开关 → 否决，复用现有字段更简洁。

### 3. paramSchema 存储：JSON 字段存在 mcpServers 表

`param_schema` 列存储 JSON 字符串，格式：
```json
[
  { "key": "allowedProjects", "label": "可查项目", "type": "string[]", "description": "限制可查询的项目范围" }
]
```
支持类型：`string`、`string[]`、`number`、`boolean`。前端根据 type 渲染对应 Ant Design 控件（Input、Select tags、InputNumber、Switch）。

替代方案：单独建 param_schema 表 → 否决，JSON 字段足够，避免过度设计。

### 4. forceCall 机制：消息处理前串行执行，结果注入 system prompt

在 `BotInstance.handleMessage` 的队列处理中，resolveTools 之后、invokeWithTools 之前，先收集所有 `forceCall: true` 的 MCP 配置，依次调用对应工具（传入用户原始消息作为 query），将返回结果拼接为：

```
# 强制检索结果

[工具名]
<检索内容>
```

追加到 systemPrompt 末尾，再传给 LLM。

替代方案：作为 human message 的前缀注入 → 否决，注入 system prompt 更符合 RAG 惯例，不污染对话历史。

### 5. AgentEngine 稳定性：参考旧版消息流处理而不是只读取最后一条 content

旧版 `src/wecom-adapter.ts` 使用 `agent.stream(..., { streamMode: "messages", recursionLimit })` 遍历 Agent 执行过程中的消息，并在递归超限时使用已收集的中间消息生成阶段性总结。新平台的 `AgentEngine.invokeWithTools` 不应只依赖 `response.messages.at(-1).content`，因为 OpenAI-compatible 模型或 LangChain Agent 在 tool calling 中可能返回空 content 的 AIMessage，导致企业微信发送空消息失败。

新平台应将这部分经验沉淀到 `packages/core/src/agent-engine.ts`：

- `invokeWithTools` 与 `invokeWithStream` 均传入可配置的 `recursionLimit`，默认值建议为 50
- 对 Agent 返回的消息序列做健壮提取：优先返回最后一个非空 AI 文本，禁止返回空字符串
- 在执行过程中记录 tool call 开始、结束、错误，以及消息类型/空 content 等调试信息，方便区分“工具未调用”和“调用后结果提取失败”
- 遇到 `GRAPH_RECURSION_LIMIT` 或 recursion limit 错误时，使用已收集的中间消息调用不带 tools 的基础模型生成阶段性总结
- 如果最终仍无有效文本，返回明确 fallback 文案，避免向企业微信发送空内容

这属于 Agent 执行稳定性增强，不替代 `forceCall`。`forceCall` 负责保证“必须检索”，AgentEngine 稳定性负责保证“检索/执行过程不会空回复、不可观测或异常中断”。

### 6. 向后兼容：allowedProjects 迁移

现有 `injectAllowedProjects` 函数读取 `cfg.params.allowedProjects`，数据结构不变（params 字段本来就是 JSON），只需将前端表单从硬编码改为动态渲染，后端逻辑无需改动。

### 7. WeCom 引用消息：显式拼接引用上下文

`body.quote` 解析后作为当前消息的上文进入 LLM，文本引用格式化为：

```
> 引用消息:
<引用内容>

当前消息:
<用户当前内容>
```

图片引用在 `visionEnabled: true` 时作为多模态内容追加；在 `visionEnabled: false` 时降级为 `[引用图片]`。未知 quote 类型不阻断消息处理，只保留当前消息。

### 8. 企业微信加密图片：按需下载解密

当图片消息或引用图片包含 `aeskey` 且 `visionEnabled: true` 时，WeComAdapter 下载图片密文并用 AES 解密，转换为 LLM 可消费的 base64 图片内容。`visionEnabled: false` 时不下载、不解密，直接降级为 `[图片]` 或 `[引用图片]`。

解密失败时记录日志并降级为 `[图片解密失败]`，避免用户消息整体失败。

## 风险 / 权衡

- **forceCall 延迟**：每条消息多一次 MCP 调用，增加响应时间。缓解：仅对标记了 forceCall 的 MCP 执行，且串行执行（不并行，避免 MCP server 压力）
- **Agent 消息流复杂度**：`streamMode: "messages"` 会暴露 AIMessage、ToolMessage、中间空 content 等更多状态，结果提取不能简单拼接所有 AI token。缓解：只返回最后一个有效非空 AI 文本，并保留中间消息用于异常恢复
- **Dify SSE 解析复杂度**：Dify 流式返回包含多种 event 类型（workflow_started、node_started 等），需要只过滤 `event: message` 块。缓解：在 DifyClient 中封装解析逻辑，上层只消费 token 回调
- **paramSchema 无校验**：前端动态表单依赖 paramSchema 声明，若 server 配置错误会导致表单异常。缓解：前端对 paramSchema 做基础格式校验，type 不合法时降级为文本输入
- **引用消息上下文膨胀**：引用内容会增加 prompt 长度。缓解：仅拼接企业微信提供的 quote 内容，不递归拉取历史消息
- **图片解密失败率**：企业微信图片 URL 或 aeskey 可能过期。缓解：失败时降级为文本占位，不阻断消息处理

## Migration Plan

1. 数据库迁移：mcpServers 表增加 `param_schema TEXT` 列（nullable，默认 null）
2. 现有 McpConfig 数据中 `params.allowedProjects` 字段结构不变，无需数据迁移
4. AgentEngine 调整为可配置 recursionLimit，并增强消息流提取、tool call 日志、空回复 fallback 与 recursion limit 恢复逻辑
5. 前端部署后，旧的 gitnexus MCP Server 需要管理员手动在编辑页面填入 paramSchema（或通过脚本预填）

## Open Questions

- Dify 流式输出时，`workflow_started` / `node_started` 等事件是否需要在企业微信侧展示进度？当前方案：忽略，只展示最终 answer。
- forceCall 的 MCP 工具调用失败时是否阻断消息处理？当前方案：失败时记录日志，跳过注入，继续正常 LLM 调用。
- AgentEngine 在 openai-compatible provider 返回空 content 但包含 tool call 中间态时，是否应切换到更严格的 provider/model 校验？当前方案：先增强日志与 fallback，避免空回复；是否阻断配置留到后续评估。
