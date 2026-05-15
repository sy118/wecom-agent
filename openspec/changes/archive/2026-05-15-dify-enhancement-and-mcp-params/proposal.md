## 为什么

当前项目的 Dify provider 仅支持阻塞模式且缺少用户标识传递，导致 Dify 侧无法区分用户会话；MCP 能力配置中的"可查项目"字段硬编码为 gitnexus 专属逻辑，无法适配其他 MCP Server 的参数需求；MCP 工具虽然能被加载并传入 Agent，但在代码库/知识库问答场景中，LLM 可能只回复“马上调用 MCP”而不真正发起 tool call，或返回空 content 导致企业微信发送失败；此外 WecomAdapter 解析消息时未读取 `body.quote` 字段，导致用户引用回复时被引用的内容完全丢失，LLM 无法感知上下文。

## 变更内容

- **Dify provider 增强**：Bot 配置页面补全 Dify 字段 UI（difyBaseUrl、difyApiKey、difyAppId）；向 Dify API 传递 `user` 标识（使用 chatKey）；支持 Dify 流式输出（streaming mode）；Context 配置页面在 Bot 为 Dify provider 时隐藏 MCP 能力配置区块
- **MCP 通用参数系统**：McpServer 增加 `paramSchema` 字段，声明该 server 所需参数的 key、label、type、description；McpConfig 的 `params` 改为 `Record<string, any>` 通用结构；Context 配置页面根据 `paramSchema` 动态渲染参数表单，替换硬编码的"可查项目"字段；**BREAKING** 现有 `allowedProjects` 数据需迁移至 `params.allowedProjects`
- **MCP 强制调用与 Agent 稳定性**：McpConfig 增加 `forceCall` 布尔字段；当 `forceCall: true` 时，每条用户消息在进入 LLM 之前强制调用该 MCP 工具，将检索结果注入 system prompt；适用于知识库/代码库类 MCP 需要每次必须检索的场景；同时增强 AgentEngine 的消息流处理、递归限制、空回复保护与中断恢复，避免出现只口头承诺调用 MCP、没有实际检索或向企业微信发送空消息的问题
- **引用消息解析**：WecomAdapter 的 `parseContent` 增加对 `body.quote` 字段的读取，将被引用的消息内容拼接到当前消息中传给 LLM，支持 text、image 等引用类型
- **图片解密**：企业微信图片消息携带 `aeskey` 时，图片 URL 为加密内容，需在 WecomAdapter 中先解密图片数据（下载 + AES 解密），再以 base64 或可访问 URL 形式传给 LLM；`visionEnabled: false` 时降级为 `[图片]` 文本

## 功能 (Capabilities)

### 新增功能

- `mcp-param-schema`: MCP Server 参数模式声明能力，允许每个 MCP Server 声明自己所需的配置参数，前端动态渲染对应表单
- `mcp-force-call`: MCP 强制调用能力，Context 中可将某个 MCP 标记为强制调用，每条消息处理前先执行该 MCP 检索并将结果注入 system prompt
- `wecom-quote-parsing`: 企业微信引用消息解析能力，解析 body.quote 字段并将被引用内容拼接到消息中
- `wecom-image-decrypt`: 企业微信图片解密能力，图片消息携带 aeskey 时需先解密 URL 再传给 LLM

### 修改功能

- `dify-integration`: Dify provider 的用户标识传递、流式输出支持、Bot 配置 UI 完善，以及 Context 页面对 Dify provider 的适配展示

## 影响

- `apps/api/src/db/schema.ts`：mcpServers 表增加 `param_schema` 字段
- `apps/api/src/bot-manager/bot-instance.ts`：handleDify 传递 user 参数，支持流式模式；消息处理前执行 forceCall MCP 并注入检索结果
- `apps/api/src/routes/mcp-servers.ts`：CRUD 支持 paramSchema 字段
- `apps/web/src/pages/BotsPage.tsx`：Dify 配置字段 UI
- `apps/web/src/pages/McpServersPage.tsx`：paramSchema 配置 UI
- `apps/web/src/pages/ContextsPage.tsx`：动态参数表单 + Dify provider 隐藏 MCP 区块
- `packages/core/src/agent-engine.ts`：参考旧版 `src/wecom-adapter.ts` 的 Agent stream 处理方式，增强 MCP tool calling 观测、递归限制、空回复保护与中断恢复
- `packages/core/src/wecom-adapter.ts`：parseContent 增加 quote 字段解析、图片 AES 解密逻辑
