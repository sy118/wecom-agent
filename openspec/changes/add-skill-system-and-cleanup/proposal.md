## 为什么

当前平台已经完成多 Bot、多 Context、MCP 工具池和管理控制台的主架构，但仓库中仍保留一套根目录 `src/*` 旧版单 Bot 实现、重复的 SessionStore、未真正接入的 Drizzle schema 和历史计划文档。这些遗留代码会干扰后续迭代判断，也提高了维护和测试成本。

下一阶段需要引入 Skill 系统，让管理员可以把提示词、参数、脚本和权限策略打包为可复用能力，并按 Context 分配给机器人。Skill 应复用当前 MCP 的“Bot 级注册、Context 级启用、运行时工具池过滤”设计，但脚本型 Skill 必须有更强的安全边界和审计能力。

## 变更内容

- 新增 Skill 系统：支持 Bot 级 Skill 注册、Context 级 Skill 启用、动态参数配置、运行时 Skill 工具池和 Agent 调用。
- 新增脚本型 Skill：允许管理员注册受控脚本入口，脚本以 JSON 参数执行并返回结构化结果。
- 新增 Skill 安全策略：为脚本执行提供默认关闭、权限白名单、超时、输出大小限制、并发限制和审计日志。
- 修改 Agent 工具解析：BotInstance 在每次消息处理时同时解析 MCP tools 和 Skill tools，并按 Context 能力配置过滤。
- 修改管理控制台：新增 Skill 管理页，并在 Context 表单中增加 Skill 能力配置区。
- 清理无用代码：移除或归档根目录旧版 `src/*` 单 Bot 实现、旧 Dockerfile、重复/未使用模块和过期计划文档。
- **BREAKING**: 根目录旧版单 Bot 入口、`MCP_REMOTE_URL` 环境变量启动路径和旧 `npx tsc && node dist/index.js` Docker 构建路径将被移除；平台仅保留 monorepo 主入口。

## 功能 (Capabilities)

### 新增功能

- `skill-system`: 定义 Skill 的注册、配置、参数 schema、运行时加载、脚本执行、安全策略和审计行为。
- `codebase-cleanup`: 定义清理旧版入口、重复实现、未使用依赖和历史文档的维护要求。

### 修改功能

- `mcp-tool-pool`: Agent 工具池解析需要扩展为同时接收 MCP tools 和 Skill tools，并保持 Context 级过滤。
- `admin-console`: 管理控制台需要新增 Skill 管理和 Context Skill 配置交互。

## 影响

- `packages/types/src/index.ts`: 新增 Skill、SkillConfig、SkillParamSchema、SkillAuditRecord 等共享类型。
- `packages/core/src/`: 新增 SkillRunner/SkillToolFactory，并复用 AgentEngine 的工具调用接口。
- `apps/api/src/db/`: 新增 skills、skill_audit_logs 表和仓储；contexts 表新增 `skill_configs` JSON 字段。
- `apps/api/src/bot-manager/bot-instance.ts`: 启动时构建 Skill 工具池，消息处理时合并 MCP 和 Skill tools。
- `apps/api/src/routes/`: 新增 Skill CRUD、启用状态、审计查询接口。
- `apps/web/src/pages/`: 新增 Skill 管理页，并改造 Context 配置页。
- `package.json`、Dockerfile、文档和测试：删除旧版入口相关内容，补充 Skill 系统构建与测试。
