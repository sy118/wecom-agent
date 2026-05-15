## 1. 修复 JSX 渲染 Bug

- [x] 1.1 修复 `apps/web/src/pages/ContextsPage.tsx` 中技能名称渲染时的 `${}` 语法错误
- [x] 1.2 修复 `apps/web/src/pages/SkillsPage.tsx` 中技能名称渲染时的 `${}` 语法错误

## 2. 删除死导入

- [x] 2.1 删除 `apps/api/src/routes/bots.ts` 中未使用的 `Request` 导入
- [x] 2.2 删除 `apps/api/src/skills/skill-bundle.ts` 中未使用的 `join` 导入
- [x] 2.3 删除 `apps/web/src/App.tsx` 中不必要的 `React` 默认导入

## 3. 清理死参数

- [x] 3.1 移除 `apps/api/src/db/mcp-server-repository.ts` 中 `findByBotId()` 的 `botId` 参数，并更新所有调用点
- [x] 3.2 移除 `apps/api/src/db/skill-repository.ts` 中 `findByBotId()` 的 `botId` 参数，并更新所有调用点
- [x] 3.3 移除 `apps/api/src/db/skill-repository.ts` 中 `findEnabledByBotId()` 的 `botId` 参数，并更新所有调用点
- [x] 3.4 移除 `apps/api/src/routes/contexts.ts` 中 `validateMcpConfigs`、`validateSkillConfigs`、`maskContextResponse` 三个函数的 `botId` 参数，并更新所有调用点

## 4. 删除未使用的前端 API 方法

- [x] 4.1 删除 `apps/web/src/api/index.ts` 中的 `sessionsApi.get` 方法
- [x] 4.2 删除 `apps/web/src/api/index.ts` 中的 `skillsApi.get` 方法
- [x] 4.3 删除 `apps/web/src/api/index.ts` 中的 `wikiApi.updateNamespace` 方法
- [x] 4.4 删除 `apps/web/src/api/index.ts` 中的 `wikiApi.getFile` 方法
