## 为什么

wecom-agent-platform 的 Bot 目前只能依赖系统提示中的静态知识，无法访问持续更新的领域文档。随着业务知识的积累，需要一套能自动维护、也支持人工编辑的知识库系统，让不同 Bot Context 能绑定各自的知识域，实现"知识与对话分离"。

## 变更内容

- **新增** `packages/wiki-mcp-server`：独立 MCP SSE Server，提供 Wiki 读写工具
- **新增** `wiki_namespaces` 数据库表：管理 namespace 元数据与目录映射
- **新增** Wiki 管理 API：namespace CRUD、文件上传、目录浏览、git pull 触发
- **新增** Wiki 管理页面（Web Console）：namespace 管理、文件上传、目录浏览
- **新增** `wiki-compiler` Skill 模板：对话后自动提炼知识写入 Wiki
- **修改** Context 配置：通过 `mcpConfigs.params` 绑定 Wiki namespace，注入系统提示
- Wiki 存储为服务器本地 Git 仓库（`WIKI_ROOT` 环境变量配置），支持 Obsidian + obsidian-git 直接编辑同步

## 功能 (Capabilities)

### 新增功能

- `wiki-mcp-server`: MCP SSE Server，暴露 wiki_read/wiki_search/wiki_write/wiki_append/wiki_list/wiki_git_pull 工具，支持 namespace 路由
- `wiki-namespace-management`: namespace 的 CRUD 管理，包含数据库表、API 路由、Web Console 页面
- `wiki-file-management`: Wiki 文件的上传、浏览、手动 git pull，通过 Web Console 操作
- `wiki-compiler-skill`: Script Skill 模板，对话结束后由 LLM 提炼知识并写入对应 namespace
- `wiki-context-binding`: Context 通过 mcpConfigs.params 绑定 namespace，params 注入系统提示实现 namespace 路由

### 修改功能

（无规范级行为变更，仅新增能力）

## 影响

- **新增 package**：`packages/wiki-mcp-server`（monorepo 第四个 package）
- **数据库**：新增 `wiki_namespaces` 表，`apps/api/src/db/client.ts` 迁移
- **API**：新增 `apps/api/src/routes/wiki.ts`，挂载到 Express
- **Web**：新增 `apps/web/src/pages/WikiPage.tsx`，添加路由和导航
- **环境变量**：新增 `WIKI_ROOT`（Wiki 根目录路径）、`WIKI_GIT_REMOTE`（可选，远端地址）
- **依赖**：`wiki-mcp-server` 需要 `@modelcontextprotocol/sdk`、`simple-git`
- **外部工具**：Obsidian + obsidian-git 插件（用户侧，非代码依赖）
