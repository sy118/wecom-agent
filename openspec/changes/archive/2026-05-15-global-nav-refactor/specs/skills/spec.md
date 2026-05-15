## 修改需求

### 需求:Skills 页面为全局视图
Skills 管理页面必须展示所有全局 Skills，禁止依赖 botId URL 参数。页面路由必须为 `/skills`。

#### 场景:访问全局 Skills 列表
- **当** 用户导航到 `/skills`
- **那么** 页面必须显示系统中所有 Skills 的列表，不限于特定 Bot

#### 场景:添加新 Skill
- **当** 用户在 Skills 页面点击"添加"
- **那么** 表单中禁止出现 Bot 选择字段，新建的 Skill 属于全局资源

#### 场景:旧路由访问被废弃
- **当** 用户访问 `/bots/:botId/skills`
- **那么** 该路由禁止存在，应返回 404 或重定向到 `/skills`

## 移除需求

### 需求:Bot 行内 Skills 入口按钮
**Reason**: Skills 已提升为全局顶级导航，不再是 Bot 的子功能
**Migration**: 通过左侧边栏"Skills"菜单项访问
