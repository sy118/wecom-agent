## 1. 后端 API 确认与准备

- [x] 1.1 确认后端是否已有全局 MCP 服务器 API（不带 botId 的 GET /api/mcp-servers）
- [x] 1.2 确认后端是否已有全局 Skills API（不带 botId 的 GET /api/skills）
- [x] 1.3 确认后端是否已有全局定时任务 API（不带 botId 的 GET /api/scheduled-tasks）
- [x] 1.4 若定时任务表缺少 botId 字段，执行数据库迁移添加可空的 botId 字段（默认 null）
- [x] 1.5 若后端缺少全局查询接口，新增对应的全局 API 路由

## 2. 路由重构

- [x] 2.1 在 `apps/web/src/App.tsx` 中新增全局路由：`/mcp-servers`、`/skills`、`/scheduled-tasks`
- [x] 2.2 移除旧路由：`/bots/:botId/mcp-servers`、`/bots/:botId/skills`、`/bots/:botId/scheduled-tasks`
- [x] 2.3 更新默认重定向，确保 `/` 仍重定向到 `/bots`

## 3. 侧边栏导航重构

- [x] 3.1 在 `apps/web/src/components/AppLayout.tsx` 中新增菜单项：MCP 服务器（`/mcp-servers`）、Skills（`/skills`）、定时任务（`/scheduled-tasks`）
- [x] 3.2 将会话监控菜单项移至底部，添加视觉分隔线（Ant Design `Menu.Divider` 或 `type: 'divider'`）
- [x] 3.3 更新菜单选中逻辑，使 selectedKeys 正确匹配新路由路径

## 4. MCP 服务器页面全局化

- [x] 4.1 移除 `apps/web/src/pages/McpServersPage.tsx` 中对 `botId` URL 参数的依赖
- [x] 4.2 将 API 调用从 `/api/bots/:botId/mcp-servers` 改为全局端点
- [x] 4.3 移除页面顶部的"返回机器人"按钮
- [x] 4.4 更新页面标题为"MCP 服务器"（去除 Bot 名称前缀）

## 5. Skills 页面全局化

- [x] 5.1 移除 `apps/web/src/pages/SkillsPage.tsx` 中对 `botId` URL 参数的依赖
- [x] 5.2 将 API 调用从 `/api/bots/:botId/skills` 改为全局端点
- [x] 5.3 移除页面顶部的"返回机器人"按钮
- [x] 5.4 更新页面标题为"Skills"（去除 Bot 名称前缀）

## 6. 定时任务页面全局化

- [x] 6.1 移除 `apps/web/src/pages/ScheduledTasksPage.tsx` 中对 `botId` URL 参数的依赖
- [x] 6.2 将 API 调用从 `/api/bots/:botId/scheduled-tasks` 改为全局端点
- [x] 6.3 在新建/编辑表单中新增"目标机器人"下拉选择字段，选项来自 `/api/bots`，包含"全部机器人"选项（值为 null）
- [x] 6.4 在任务列表表格中新增"目标机器人"列，显示 Bot 名称或"全部"
- [x] 6.5 移除页面顶部的"返回机器人"按钮
- [x] 6.6 更新页面标题为"定时任务"（去除 Bot 名称前缀）

## 7. Bot 列表页面精简

- [x] 7.1 在 `apps/web/src/pages/BotsPage.tsx` 中移除每行的 MCP 服务器、Skills、定时任务跳转按钮
- [x] 7.2 确认保留的行内按钮为：上下文、绑定、编辑（共 3 个）

## 8. 上下文配置页面数据源更新

- [x] 8.1 在 `apps/web/src/pages/ContextsPage.tsx` 中，将 MCP 能力区域的数据来源改为全局 MCP API
- [x] 8.2 将 Skill 区域的数据来源改为全局 Skills API
- [x] 8.3 验证绑定关系（开关状态 + 参数）的保存逻辑不受影响

## 9. API 客户端更新

- [x] 9.1 在 `apps/web/src/api/index.ts` 中更新 MCP 相关 API 函数，使用全局路径
- [x] 9.2 更新 Skills 相关 API 函数，使用全局路径
- [x] 9.3 更新定时任务相关 API 函数，使用全局路径，新增 botId 参数支持

## 10. 验证与测试

- [x] 10.1 验证侧边栏所有菜单项可正常跳转且高亮状态正确
- [x] 10.2 验证 MCP 服务器页面可正常增删改查
- [x] 10.3 验证 Skills 页面可正常增删改查
- [x] 10.4 验证定时任务页面可正常增删改查，目标机器人字段正常工作
- [x] 10.5 验证上下文配置 Modal 中 MCP/Skill 绑定功能正常
- [x] 10.6 验证 Bot 列表页面行内按钮只剩 3 个且功能正常
