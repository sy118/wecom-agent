## 为什么

当前平台已经完成多 Bot、多 Context、MCP 工具池和管理控制台的主路径，但仓库中仍保留旧版单 Bot 入口、重复模块和未使用依赖，需要清理以降低后续维护成本。

下一阶段需要引入 Skill 系统。这里的 Skill 不应该是“在数据库里手填 prompt/script manifest 的工具注册表”，而应该是一个可上传、可安装、可复用的全局能力包目录。每个 Skill 目录必须包含 `SKILL.md` 作为入口，可选包含 `scripts/`、`references/`、`assets/` 等资源。平台负责全局安装、Context 级启用、运行时按需加载 `SKILL.md`，并为 bundle 内脚本提供受控执行和审计。MCP 同样作为全局工具服务资产，由 Context 引用和配置。

## 变更内容

- 清理旧版单 Bot 入口、重复 SessionStore、未使用 Drizzle schema、过期计划文档和未使用依赖。
- 新增文件夹型 Skill 系统：管理员上传一个包含 `SKILL.md` 的文件夹，服务端校验并安装为全局 Skill。
- 新增 Skill bundle 校验：解析 `SKILL.md` YAML frontmatter 中的 `name` 和 `description`，索引 `scripts/`、`references/`、`assets/`，拒绝路径穿越和无效命名。
- 新增 Context 级 Skill 启用：Context 仅保存 `skillConfigs`，用于启用、传参和可选 `forceUse`。
- 修改 Agent 运行时：每次消息处理时注入可用 Skill 元数据；当用户显式 `$skill-name` 或 Context 配置 `forceUse` 时读取对应 `SKILL.md` 并注入本次 system prompt。
- 新增通用脚本工具：将所有启用 Skill 的 bundle 脚本通过单个受控 `run_skill_script` 工具暴露给 Agent，而不是把每个脚本预注册为一个 LangChain tool。
- 修改管理控制台：左侧 Skill 页面改为全局上传文件夹、预览 `SKILL.md`、展示资源索引、启停和审计；Context 页面引用全局 MCP 与全局 Skill 并配置启用和参数。
- 保持 Dify provider 跳过本地 MCP/Skill 工具池，由 Dify 工作流内部处理工具和知识。

## 功能

### 新增能力

- `skill-system`: 定义文件夹型 Skill 的上传、校验、安装、Context 启用、运行时加载、脚本执行和审计行为。
- `codebase-cleanup`: 定义清理旧版入口、重复实现、未使用依赖和历史文档的维护要求。

### 修改能力

- `mcp-tool-pool`: Agent 工具池解析需要支持 MCP tools 与 Skill 通用脚本工具并存，同时保持 Context 级过滤。
- `admin-console`: 管理控制台需要支持 Skill 文件夹上传、资源预览、Context Skill 启用和审计查看。

## 影响

- `packages/types/src/index.ts`: Skill 类型从 prompt/script manifest 模型调整为 bundle 模型。
- `packages/core/src/skill-runner.ts`: 改为 Skill bundle 元数据注入、`SKILL.md` 按需加载和通用脚本执行工具。
- `apps/api/src/db/`: `skills` 表新增 bundle path/hash、metadata、resource index 等字段；保留审计表。
- `apps/api/src/routes/skills.ts`: 改为文件夹上传、bundle 校验、预览、启停、删除和审计接口。
- `apps/api/src/bot-manager/bot-instance.ts`: 运行时加载 enabled Skill bundle，按 Context 生成 Skill 提示和通用脚本工具。
- `apps/web/src/pages/SkillsPage.tsx`: 改为 Skill 文件夹上传和 bundle 预览 UI。
- `apps/web/src/pages/ContextsPage.tsx`: Context Skill 配置改为启用、参数和 `forceUse`，不再展示 prompt/script 类型表单。
- `package.json`、测试和 OpenSpec 产物：更新为 bundle Skill 语义并验证主路径。

## BREAKING

根目录旧版单 Bot 入口、`MCP_REMOTE_URL` 启动路径和旧 `npx tsc && node dist/index.js` Docker 构建路径被移除。Skill API 从 JSON manifest 创建模式改为上传 `SKILL.md` 文件夹的 bundle 模式。
