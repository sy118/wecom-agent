# wiki-namespace-management

Wiki Namespace 管理能力，包含数据库表、REST API 和 Web Console 页面，用于管理 Wiki 知识库的命名空间。

## 需求

### 需求:wiki_namespaces 数据库表
系统必须在 SQLite 数据库中创建 `wiki_namespaces` 表，存储 namespace 元数据。表结构必须通过 `addColumnIfMissing` 模式支持增量迁移。

#### 场景:表结构定义
- **当** 数据库初始化时
- **那么** 必须创建包含以下字段的表：`id TEXT PRIMARY KEY`、`name TEXT NOT NULL UNIQUE`（kebab-case 标识符）、`display_name TEXT NOT NULL`（展示名）、`path TEXT NOT NULL`（相对于 WIKI_ROOT 的路径）、`description TEXT`、`git_enabled INTEGER NOT NULL DEFAULT 1`、`auto_compile INTEGER NOT NULL DEFAULT 0`、`compile_schedule TEXT`（cron 表达式）、`created_at INTEGER NOT NULL`、`updated_at INTEGER NOT NULL`

---

### 需求:Namespace CRUD API
系统必须提供 namespace 的增删改查 REST API，路由挂载于 `/api/wiki`。

#### 场景:列出所有 namespace
- **当** `GET /api/wiki/namespaces` 请求到达
- **那么** 返回所有 namespace 记录数组，按 `created_at` 升序排列

#### 场景:创建 namespace
- **当** `POST /api/wiki/namespaces` 携带 `{ name, display_name, path, description? }` 请求到达
- **那么** 验证 `name` 为合法 kebab-case，在 `WIKI_ROOT/{path}` 创建目录（如不存在），插入数据库记录，返回 201 和新记录

#### 场景:name 重复
- **当** 创建时 `name` 已存在
- **那么** 返回 409 错误 `"namespace 已存在"`

#### 场景:更新 namespace
- **当** `PUT /api/wiki/namespaces/:id` 携带更新字段
- **那么** 更新数据库记录，返回更新后的记录

#### 场景:删除 namespace
- **当** `DELETE /api/wiki/namespaces/:id` 请求到达
- **那么** 删除数据库记录，不删除磁盘文件（防止误删），返回 200

---

### 需求:Namespace 管理 Web 页面
Web Console 必须提供 `/wiki` 路由的 Wiki 管理页面，包含 namespace 列表和 CRUD 操作。

#### 场景:展示 namespace 列表
- **当** 用户访问 `/wiki` 页面
- **那么** 展示所有 namespace 的卡片列表，每张卡片显示 `display_name`、`name`、`path`、`description`

#### 场景:创建 namespace
- **当** 用户点击"新建 Namespace"并填写表单提交
- **那么** 调用 POST API，成功后刷新列表，显示成功提示

#### 场景:删除 namespace
- **当** 用户点击删除并确认
- **那么** 调用 DELETE API，从列表移除，显示"已删除（磁盘文件保留）"提示
