## 1. 基础设施：wiki-mcp-server package

- [x] 1.1 在 `packages/wiki-mcp-server/` 初始化 package，添加 `package.json`（name: `@wecom-platform/wiki-mcp-server`）、`tsconfig.json`，配置 pnpm workspace
- [x] 1.2 安装依赖：`@modelcontextprotocol/sdk`、`simple-git`，dev 依赖复用 monorepo 根配置
- [x] 1.3 实现 `src/git-sync.ts`：封装 `simple-git` 的 `pull`、`add`、`commit` 操作，内部写入队列串行化 git 操作
- [x] 1.4 实现 `src/wiki-tools.ts`：`wiki_read`、`wiki_search`、`wiki_write`、`wiki_append`、`wiki_list`、`wiki_git_pull` 六个工具函数，含路径遍历防护
- [x] 1.5 实现 `src/index.ts`：MCP SSE Server 入口，读取 `WIKI_ROOT`/`WIKI_MCP_PORT` 环境变量，启动时验证 Git 仓库，注册所有工具
- [x] 1.6 在根 `package.json` 的 `scripts` 中添加 `wiki-mcp` 启动脚本，在 `docker-compose.yml` 中添加 `wiki-mcp-server` 服务配置

## 2. 数据库：wiki_namespaces 表

- [x] 2.1 在 `apps/api/src/db/client.ts` 的 `initDb()` 中添加 `wiki_namespaces` 表的 `CREATE TABLE IF NOT EXISTS` 语句
- [x] 2.2 创建 `apps/api/src/db/wiki-namespace-repository.ts`：实现 `findAll`、`findById`、`findByName`、`create`、`update`、`delete` 方法

## 3. API：Wiki 路由

- [x] 3.1 创建 `apps/api/src/routes/wiki.ts`：实现 `GET /api/wiki/namespaces`、`POST /api/wiki/namespaces`、`PUT /api/wiki/namespaces/:id`、`DELETE /api/wiki/namespaces/:id`
- [x] 3.2 在 `wiki.ts` 中实现 `GET /api/wiki/:namespace/files`（目录树）、`GET /api/wiki/:namespace/files/*filepath`（文件内容）
- [x] 3.3 在 `wiki.ts` 中实现 `POST /api/wiki/:namespace/upload`（multer 上传，限 .md，50 文件，5MB），上传后执行 git commit
- [x] 3.4 在 `wiki.ts` 中实现 `POST /api/wiki/git-pull`，调用 `WIKI_ROOT` 的 git pull
- [x] 3.5 在 `apps/api/src/index.ts` 中挂载 wiki 路由

## 4. Web Console：Wiki 管理页面

- [x] 4.1 在 `apps/web/src/api/index.ts` 中添加 `wikiApi`：namespace CRUD、文件列表、文件上传、git pull 接口封装
- [x] 4.2 创建 `apps/web/src/pages/WikiPage.tsx`：namespace 列表视图，展示卡片，支持新建/删除 namespace
- [x] 4.3 在 `WikiPage.tsx` 中实现 namespace 详情视图：文件树浏览（可展开/折叠）、文件上传、git pull 触发按钮
- [x] 4.4 在 `apps/web/src/App.tsx` 中添加 `/wiki` 路由，在导航栏添加"Wiki 知识库"入口

## 5. Context 绑定：namespace 注入系统提示

- [x] 5.1 在 `apps/api/src/bot-manager/bot-instance.ts` 的系统提示构建逻辑中，检测 mcpConfigs 中是否有 `params.namespace`，若有则追加 Wiki namespace 提示段落到系统提示末尾
- [x] 5.2 实现 `forceCallPage` 支持：当 mcpConfigs 中 wiki-mcp-server 配置了 `forceCall: true` 且 `params.forceCallPage` 存在时，在强制调用结果中注入对应 Wiki 页面内容

## 6. wiki-compiler Skill 模板

- [x] 6.1 创建 `packages/wiki-mcp-server/skill-template/wiki-compiler/` 目录，编写 `SKILL.md`（技能说明、触发条件、参数说明）
- [x] 6.2 编写 `index.js`：从 stdin 读取 JSON，调用 LLM 判断是否有新知识，有则通过 HTTP 调用 wiki-mcp-server 的 `wiki_append` 工具，输出 JSON 结果到 stdout
- [x] 6.3 编写 `package.json`，打包为 `wiki-compiler.zip`，添加到项目 `examples/skills/` 目录

## 7. 文档与配置示例

- [x] 7.1 在 `README.md` 中添加 Wiki 知识库章节：环境变量说明、Obsidian 配置步骤、快速上手流程
- [x] 7.2 在 `docker-compose.yml` 中添加 `WIKI_ROOT` 环境变量示例和 volume 挂载配置
- [x] 7.3 提供 Scheduled Task 配置示例（JSON）：每天 02:00 触发 Wiki 编译，系统提示模板，结果发管理员群
