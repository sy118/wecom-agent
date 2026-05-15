## 1. 清理旧代码路径

- [x] 1.1 运行 `pnpm build` 和 `pnpm test`，记录清理前主路径基线
- [x] 1.2 删除根目录旧版单 Bot 实现 `src/index.ts`、`src/graph.ts`、`src/mcp-client.ts`、`src/wecom-adapter.ts`、`src/tests/*` 和 `src/prompts/*`
- [x] 1.3 删除或归档根目录旧 Dockerfile，并确认 `docker-compose.yml` 仅使用 `apps/api/Dockerfile` 和 `apps/web/Dockerfile`
- [x] 1.4 删除根目录旧 `tsconfig.json` 中仅服务旧 `src/*` 的配置，或改造为 monorepo 根配置
- [x] 1.5 移除 `package-lock.json`，确认 pnpm workspace 是唯一包管理入口
- [x] 1.6 清理引用旧 `src/*` 路径的历史计划文档，保留必要信息到 OpenSpec 或归档目录

## 2. 清理重复模块和未使用依赖

- [x] 2.1 删除 `packages/core/src/session-store.ts` 的未使用内存 SessionStore 导出，或将其替换为当前持久化 SessionStore 的共享接口
- [x] 2.2 确认 `apps/api/src/bot-manager/bot-instance.ts` 继续使用持久化 SessionStore，且会话测试通过
- [x] 2.3 若仍使用 raw SQL 初始化数据库，删除未引用的 `apps/api/src/db/schema.ts`
- [x] 2.4 移除未使用的 `drizzle-orm`、`drizzle-kit`、`react-js-cron` 依赖并更新 lockfile
- [x] 2.5 再次运行 `pnpm build` 和 `pnpm test`，确认清理不改变主路径行为

## 3. 纠偏为文件夹型 Skill 数据模型

- [x] 3.1 将共享 Skill 类型从 `prompt/script manifest` 改为 `SKILL.md bundle`
- [x] 3.2 更新 `skills` 表初始化和迁移，新增 bundle path/hash、metadata、resource index 字段
- [x] 3.3 更新 SkillRepository，支持 bundle Skill 创建、查询、启停、删除
- [x] 3.4 保留 ContextRepository 对 `skillConfigs` 的序列化和反序列化，并支持 `forceUse`
- [x] 3.5 保留 SkillAuditRepository，用于通用脚本工具审计

## 4. Skill bundle API

- [x] 4.1 新增 Skill folder multipart 上传接口，接收浏览器文件夹上传的文件集合
- [x] 4.2 实现 bundle 校验：顶层 `SKILL.md`、frontmatter、路径安全、大小限制、资源索引
- [x] 4.3 安装 bundle 到 `data/skills/global/{skillId}/current`
- [x] 4.4 新增 `SKILL.md` 预览接口
- [x] 4.5 更新 Skill API 的启停、删除和审计接口，移除 JSON manifest 创建主路径
- [x] 4.6 在 Context 创建和更新接口中校验 `skillConfigs.skillId` 必须存在于全局 Skill 列表

## 5. Skill bundle 运行时

- [x] 5.1 在 `packages/core` 中实现 Skill bundle 元数据注入
- [x] 5.2 实现 `$skill-name` 和 `forceUse` 触发的 `SKILL.md` 加载
- [x] 5.3 实现通用 `run_skill_script` StructuredTool
- [x] 5.4 通用脚本工具必须使用非 shell `spawn`，并限制 runtime、路径、超时、输出大小、环境变量和并发
- [x] 5.5 通用脚本工具必须写入 success/error/timeout/blocked 审计记录，并做摘要脱敏

## 6. BotInstance 集成

- [x] 6.1 启动 Bot 时加载全局 enabled Skill bundle
- [x] 6.2 非 Dify 消息处理时按 Context 过滤 Skill，并生成 Skill prompt additions
- [x] 6.3 将 MCP tools 与 Skill 通用脚本工具合并后传给 AgentEngine
- [x] 6.4 保持 MCP forceCall 行为，Skill `forceUse` 只强制加载 `SKILL.md`，不自动执行脚本
- [x] 6.5 保持 Dify provider 忽略 MCP/Skill 工具池的现有路径，并在日志中说明跳过原因

## 7. 管理控制台

- [x] 7.1 更新 Web API client，新增 Skill 上传和 `SKILL.md` 预览接口
- [x] 7.2 重做 Skill 管理页，支持文件夹上传、列表、资源索引、预览、启停、删除和审计
- [x] 7.3 保留左侧导航进入全局 Skill 管理页的入口，移除 Bot 列表中的 Skill 操作
- [x] 7.4 改造 Context 配置页，展示全局 MCP 与全局 bundle Skill 列表并支持启用、参数和 `forceUse`
- [x] 7.5 Dify Bot 的 Context 页面展示 Skill/MCP 由 Dify 内部处理的提示，不展示运行时工具配置

## 8. 测试与验证

- [x] 8.1 增加 Skill bundle 校验和上传 API 测试
- [x] 8.2 增加 SkillRunner 测试，覆盖元数据注入、显式触发、forceUse、脚本成功、阻止、超时和输出截断
- [x] 8.3 增加 BotInstance 测试，覆盖 MCP tools 与 Skill 通用脚本工具合并、forceUse 和 Dify 跳过
- [x] 8.4 更新测试脚本，使 `apps/api/src/**/*.test.ts` 也进入 `pnpm test` 覆盖范围
- [x] 8.5 运行 `pnpm build`、`pnpm test` 和 `openspec-cn validate add-skill-system-and-cleanup --strict`
