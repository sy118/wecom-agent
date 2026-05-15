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

## 3. Skill 类型与数据库

- [ ] 3.1 在 `packages/types/src/index.ts` 新增 `SkillType`、`SkillConfig`、`SkillDefinition`、`SkillParamSchemaItem`、`SkillPermissionPolicy`、`SkillAuditRecord` 类型
- [ ] 3.2 在数据库初始化中新增 `skills` 表，包含 bot_id、name、description、type、enabled、manifest_json、param_schema、permission_policy、created_at、updated_at
- [ ] 3.3 在数据库初始化中新增 `skill_audit_logs` 表，记录 skillId、botId、contextId、chatKey、status、durationMs、输入摘要、输出摘要、错误摘要和创建时间
- [ ] 3.4 为 `contexts` 表新增 `skill_configs TEXT NOT NULL DEFAULT '[]'`
- [ ] 3.5 更新 ContextRepository 读写逻辑，支持 `skillConfigs` 序列化和反序列化

## 4. Skill API

- [ ] 4.1 新增 SkillRepository，支持按 Bot 查询、按 id 查询、创建、更新、删除和启停
- [ ] 4.2 新增 SkillAuditRepository，支持写入审计记录和按 Skill 查询审计列表
- [ ] 4.3 新增 `/api/bots/:botId/skills` 路由，提供 Skill CRUD 接口
- [ ] 4.4 在 Context 创建和更新接口中校验 `skillConfigs.skillId` 必须属于当前 Bot
- [ ] 4.5 对 `secret` 类型参数和 manifest 中的敏感字段做 API 返回脱敏

## 5. Skill 运行时

- [ ] 5.1 在 `packages/core` 新增 SkillRunner，支持 prompt Skill 注入和 script Skill 执行
- [ ] 5.2 实现 script Skill manifest 校验，禁止任意 shell 字符串，仅允许受控 runtime 和入口文件
- [ ] 5.3 使用非 shell API 执行脚本，并实现 timeout、maxOutputBytes、环境变量白名单和并发限制
- [ ] 5.4 将 script Skill 包装为 LangChain StructuredTool，并生成稳定工具名称
- [ ] 5.5 执行 script Skill 时写入成功、失败、超时和阻止执行的审计记录

## 6. BotInstance 集成

- [ ] 6.1 启动 Bot 时加载该 Bot 的 enabled Skills，并构建 `skillToolPool`
- [ ] 6.2 消息处理时按 Context 的 `skillConfigs` 过滤 prompt Skills 和 script Skills
- [ ] 6.3 将 prompt Skill 内容按 `skillConfigs` 顺序追加到本次 system prompt
- [ ] 6.4 将 MCP tools 和 Skill tools 合并后传给 AgentEngine，并处理工具名称冲突
- [ ] 6.5 扩展 forceCall 逻辑，使 MCP 和 Skill 的强制调用结果均可在 LLM 调用前注入
- [ ] 6.6 保持 Dify provider 忽略 MCP/Skill 工具池的现有路径，并在日志中说明跳过原因

## 7. 管理控制台

- [ ] 7.1 在 Web API client 中新增 skillsApi 和 skillAuditApi
- [ ] 7.2 新增 Skill 管理页面，支持查看、新建、编辑、启用、禁用和删除 Skill
- [ ] 7.3 在 Bot 列表或布局中增加进入 Skill 管理的入口
- [ ] 7.4 改造 Context 配置页，加载 Skill 列表并渲染 Skill 配置区
- [ ] 7.5 根据 Skill 参数 schema 动态渲染 `string`、`string[]`、`number`、`boolean`、`secret` 控件
- [ ] 7.6 新增 Skill 审计查看界面，展示状态、耗时、Context、chatKey、输入摘要、输出摘要和错误摘要
- [ ] 7.7 Dify Bot 的 Context 页面展示 Skill/MCP 由 Dify 内部处理的提示，不展示运行时工具配置

## 8. 测试与验证

- [ ] 8.1 增加 SkillRepository、Skill API、Context skillConfigs 校验的单元或集成测试
- [ ] 8.2 增加 SkillRunner 测试，覆盖 prompt 注入、script 成功、script 失败、超时和输出截断
- [ ] 8.3 增加 BotInstance 测试，覆盖 MCP tools 与 Skill tools 合并、forceCall 顺序和 Dify 跳过
- [ ] 8.4 更新测试脚本，使 `apps/api/src/**/*.test.ts` 也进入 `pnpm test` 覆盖范围
- [ ] 8.5 运行 `pnpm build`、`pnpm test` 和 `openspec-cn validate add-skill-system-and-cleanup --strict`
