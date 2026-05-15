## 上下文

当前平台主路径是 pnpm monorepo：`apps/api` 负责 API、数据库和 Bot 运行时，`apps/web` 负责管理控制台，`packages/core` 承载 AgentEngine、MCP client、WeComAdapter、DifyClient 等共享运行逻辑，`packages/types` 承载跨包类型。根目录 `src/*` 仍保留旧版单 Bot 实现，使用 `MCP_REMOTE_URL` 和根 `Dockerfile` 的 `npx tsc` 路径，但这些文件不在当前 `pnpm build` 和 Docker Compose 主路径中。

MCP 已经形成清晰模式：Bot 级注册 MCP Server，Context 级通过 `mcpConfigs` 启用和配置参数，BotInstance 启动时构建 `toolPool: Map<mcpServerId, Tool[]>`，每次消息处理时按 Context 过滤 tools 并传给 AgentEngine。Skill 系统应沿用这一模式，但脚本型 Skill 会执行本地代码，因此必须比 MCP 多出权限、安全、审计和资源控制。

## 目标 / 非目标

**目标：**

- 清理旧版单 Bot 入口、重复模块和未使用依赖，使仓库只保留当前平台主路径。
- 引入 Bot 级 Skill 注册和 Context 级 Skill 配置，支持 prompt-only Skill 和 script Skill。
- 将 Skill 转换为 AgentEngine 可消费的工具，和 MCP tools 在每次 invoke 时共同参与工具选择。
- 为脚本执行提供默认关闭、显式启用、权限白名单、超时、输出大小限制、并发限制和审计日志。
- 在管理控制台提供 Skill 注册、编辑、启停、Context 绑定和审计查看能力。

**非目标：**

- 不在第一版实现远程 Skill marketplace、版本签名和自动升级。
- 不支持任意 shell 命令字符串执行；脚本入口必须来自受控 manifest。
- 不替代 MCP 协议。MCP 仍负责外部工具服务连接，Skill 负责平台内置或本地可控能力包。
- 不对 Dify provider 注入 Skill tools。Dify provider 仍由 Dify 工作流内部处理工具和知识库。

## 决策

### 1. Skill 与 MCP 并列，不伪装成 MCP Server

Skill 和 MCP 都最终转换成 LangChain StructuredTool，但生命周期和信任模型不同。MCP 是外部服务连接，主要风险是远端调用失败或返回质量；脚本型 Skill 是本地执行，风险包括文件访问、网络访问、凭据泄露和资源耗尽。

采用并列模型：

```text
Bot
  |-- mcp_servers      -> Context.mcpConfigs   -> mcpToolPool
  |-- skills           -> Context.skillConfigs -> skillToolPool
                                               -> AgentEngine tools
```

替代方案是把每个 Skill 包装成本地 MCP Server。该方案协议统一，但会引入额外进程、端口、连接管理和调试成本，也无法自然表达脚本权限策略。第一版选择并列模型，保留后续将 Skill 暴露为 MCP Server 的可能性。

### 2. 数据模型复用 MCP 的 paramSchema 思路

新增 `skills` 表，核心字段包括 `bot_id`、`name`、`description`、`type`、`enabled`、`manifest_json`、`param_schema`、`permission_policy`。新增 `contexts.skill_configs` JSON 字段，结构类似：

```json
[
  {
    "skillId": "skill-id",
    "enabled": true,
    "params": {},
    "forceCall": false
  }
]
```

`param_schema` 与 MCP `paramSchema` 保持同类体验，初始支持 `string`、`string[]`、`number`、`boolean`、`secret`。`secret` 在前端以密码框输入，在 API 返回时必须脱敏。

### 3. prompt-only Skill 先落地，script Skill 受控执行

Skill 类型分为：

- `prompt`: 将 manifest 中的 prompt 片段按 Context 配置注入 system prompt，适合规范、风格、流程类能力。
- `script`: 将受控脚本封装为 tool，输入由 tool schema 和 Context params 共同组成，输出作为工具调用结果返回。

脚本型 Skill 通过 `child_process.spawn` 或等价非 shell API 启动，不拼接 shell 字符串。manifest 只允许声明相对 Skill 目录的入口文件、runtime、timeout 和参数 schema。第一版 runtime 限定为 `node` 和 `python`，后续再考虑容器隔离。

### 4. 安全策略默认收紧

脚本执行默认关闭，只有当全局配置、Bot Skill 配置和 Context Skill 配置均允许时才可执行。每次执行必须应用：

- `timeoutMs`: 默认 30 秒，可配置上限。
- `maxOutputBytes`: 默认 64 KB，超出截断并记录。
- `maxConcurrentRuns`: Bot 级和 Skill 级并发限制。
- `allowedEnvKeys`: 仅注入白名单环境变量。
- `allowedReadPaths` / `allowedWritePaths`: 文件访问策略，第一版由脚本约定和执行前校验承担。
- `networkAccess`: 默认 false，第一版作为策略字段和审计项，不强做系统级网络隔离。

替代方案是完全禁止脚本，只做 prompt-only Skill。该方案风险低，但无法满足后续本地自动化和业务脚本能力需求。当前选择分阶段开放，默认安全姿态收紧。

### 5. 审计作为运行时能力的一部分

新增 `skill_audit_logs` 表，记录 `botId`、`contextId`、`skillId`、`chatKey`、`status`、`durationMs`、`inputPreview`、`outputPreview`、`error`、`createdAt`。审计日志不存完整凭据或完整大输出，仅保留可排查问题的摘要。

### 6. 清理先于或伴随 Skill 实现

清理旧 `src/*`、根 `Dockerfile`、`package-lock.json` 和旧文档引用，可以减少实现 Skill 时对入口、测试和 Docker 构建路径的歧义。清理应以构建和测试通过为验收标准，不改变 monorepo 主路径行为。

## 风险 / 权衡

- 脚本执行带来安全风险 -> 默认关闭脚本，启用需多层配置，执行入口必须来自 manifest，禁止任意 shell 字符串。
- Skill 和 MCP 两套配置会增加 UI 复杂度 -> 复用 paramSchema 表单模式，并在 Context 页面分区展示。
- prompt-only Skill 与 system prompt 可能冲突 -> 按 Context 中 skillConfigs 顺序注入，并用稳定标题分隔来源。
- forceCall Skill 会增加响应延迟 -> 仅对显式配置的 Skill 生效，执行失败记录审计后继续主流程。
- 文件访问和网络隔离第一版不够硬 -> 策略字段先落库和审计，后续可替换为容器、沙箱或受限 worker。
- 清理旧代码可能误删历史参考 -> 在删除前确认主构建和测试不引用；必要信息迁移到 OpenSpec 或 README。

## Migration Plan

1. 清理前确认 `pnpm build` 和 `pnpm test` 当前通过，记录旧入口引用点。
2. 删除或归档根目录旧版 `src/*`、旧 `Dockerfile`、`package-lock.json`、未使用依赖和过期计划文档。
3. 增加 Skill 相关类型、数据库列和表，`skill_configs` 默认值为 `[]`，不影响现有 Context。
4. 增加 Skill API 和管理页，默认所有 Skill 为 disabled。
5. BotInstance 启动时构建 skillToolPool，非 Dify provider 消息处理时合并 MCP 和 Skill tools。
6. 增加脚本执行审计和测试，验证失败、超时、输出截断和禁用场景。
7. 回滚策略：保留新增表和列不影响旧流程；关闭 Skill 全局开关即可恢复为仅 MCP 工具链路。

## Open Questions

- 第一版是否需要强制所有脚本放在数据库外的本地目录，还是允许通过 UI 上传脚本内容？
- `networkAccess=false` 是否需要第一版做到操作系统级隔离，还是先作为策略和审计字段？
- Skill 结果是否需要进入会话历史，还是只作为本次工具调用结果参与回答？
