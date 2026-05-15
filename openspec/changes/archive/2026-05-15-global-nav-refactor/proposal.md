## 为什么

当前 UI 将 MCP 服务器、Skills、定时任务作为每个 Bot 的子页面呈现，但这三者在数据模型上是全局共享资源，与 Bot 是多对多关系。这种错位导致用户心智模型混乱，且随着 Bot 数量增长，每行 6 个操作按钮的表格会变得难以使用。

## 变更内容

- **新增** 左侧边栏顶级导航项：MCP 服务器、Skills、定时任务
- **移除** Bot 表格行内的 MCP、Skill、定时任务跳转按钮（**BREAKING**）
- **修改** 路由：`/bots/:botId/mcp-servers` → `/mcp-servers`，`/bots/:botId/skills` → `/skills`，`/bots/:botId/scheduled-tasks` → `/scheduled-tasks`（**BREAKING**）
- **修改** 定时任务页面：新增"目标机器人"字段（下拉选择，支持选择全部）
- **修改** 上下文配置页面：MCP/Skill 绑定区域从"管理入口"变为"从全局池中选择"的配置面板
- **修改** 侧边栏布局：会话监控移至底部，与上方功能区用分隔线区分
- Bot 表格行内按钮从 6 个缩减为 3 个（上下文、绑定、编辑）

## 功能 (Capabilities)

### 新增功能

- `global-nav-layout`: 左侧边栏新增 MCP 服务器、Skills、定时任务三个顶级导航项，会话监控移至底部分区

### 修改功能

- `mcp-servers`: 路由和数据模型从 Bot 私有改为全局共享，页面不再依赖 botId 参数
- `skills`: 路由和数据模型从 Bot 私有改为全局共享，页面不再依赖 botId 参数
- `scheduled-tasks`: 路由改为全局，新增目标机器人选择字段
- `context-routing`: 上下文配置中的 MCP/Skill 绑定区域改为从全局资源池中选择

## 影响

- `apps/web/src/components/AppLayout.tsx`：侧边栏菜单结构重构
- `apps/web/src/App.tsx`：路由配置变更
- `apps/web/src/pages/McpServersPage.tsx`：移除 botId 依赖，改为全局视图
- `apps/web/src/pages/SkillsPage.tsx`：移除 botId 依赖，改为全局视图
- `apps/web/src/pages/ScheduledTasksPage.tsx`：移除 botId 依赖，新增目标机器人字段
- `apps/web/src/pages/BotsPage.tsx`：行内操作按钮从 6 个缩减为 3 个
- `apps/web/src/pages/ContextsPage.tsx`：MCP/Skill 绑定区域 UI 调整
- `apps/web/src/api/index.ts`：MCP/Skill/定时任务相关 API 路径可能需要调整
- `apps/api/src/routes/`：后端路由可能需要去除 botId 前缀（需评估）
