## 为什么

项目经历多次版本迭代后，积累了无效导入、死参数、未使用的 API 方法以及 JSX 渲染 bug。这些问题会误导开发者、掩盖真实行为，并在 UI 中产生可见的渲染错误（技能名称前出现字面量 `$` 符号）。

## 变更内容

- **修复** `ContextsPage.tsx` 和 `SkillsPage.tsx` 中 JSX 字符串里错误使用 `${}` 语法导致技能名称渲染为 `$skill-name` 的 bug
- **删除** 死导入：`routes/bots.ts` 中的 `Request`、`skills/skill-bundle.ts` 中的 `join`、`App.tsx` 中的 `React`
- **清理** 死参数：`mcp-server-repository.ts` 的 `findByBotId(botId)`、`skill-repository.ts` 的 `findByBotId(botId)` 和 `findEnabledByBotId(botId)`、`routes/contexts.ts` 中三个辅助函数的 `botId` 参数
- **删除** `api/index.ts` 中未被任何页面调用的方法：`sessionsApi.get`、`skillsApi.get`、`wikiApi.updateNamespace`、`wikiApi.getFile`

## 功能 (Capabilities)

### 新增功能

无

### 修改功能

无（此变更仅涉及代码清理，不改变任何规范级行为）

## 影响

- `apps/web/src/App.tsx`
- `apps/web/src/api/index.ts`
- `apps/web/src/pages/ContextsPage.tsx`
- `apps/web/src/pages/SkillsPage.tsx`
- `apps/api/src/routes/bots.ts`
- `apps/api/src/routes/contexts.ts`
- `apps/api/src/db/mcp-server-repository.ts`
- `apps/api/src/db/skill-repository.ts`
- `apps/api/src/skills/skill-bundle.ts`
