## 新增需求

### 需求:移除旧版单 Bot 入口
系统代码库必须只保留 monorepo 平台主入口，禁止继续维护根目录旧版 `src/*` 单 Bot 运行路径。

#### 场景:根目录旧入口被移除
- **当** 开发者查看仓库主入口
- **那么** 根目录不得再存在用于生产启动的旧版 `src/index.ts`、`src/graph.ts`、`src/mcp-client.ts` 和 `src/wecom-adapter.ts`

#### 场景:构建路径保持 monorepo
- **当** 开发者运行 `pnpm build`
- **那么** 系统必须只构建 `packages/types`、`packages/core`、`apps/api` 和 `apps/web`

### 需求:移除旧 Docker 构建路径
仓库必须移除或废弃根目录旧 Dockerfile 中基于 `npx tsc` 和 `dist/index.js` 的构建路径。

#### 场景:Docker Compose 使用应用级 Dockerfile
- **当** 开发者运行 Docker Compose 部署
- **那么** API 必须使用 `apps/api/Dockerfile`，Web 必须使用 `apps/web/Dockerfile`

#### 场景:旧 Dockerfile 不再误导部署
- **当** 开发者查看根目录部署文件
- **那么** 不得存在指向旧单 Bot 入口的生产 Docker 启动说明

### 需求:移除重复 SessionStore
代码库必须只保留当前运行时使用的持久化 SessionStore，禁止保留未被主路径引用的重复 SessionStore 导出。

#### 场景:SessionStore 引用唯一
- **当** 开发者搜索 `SessionStore`
- **那么** BotInstance 必须引用当前持久化实现，且 `packages/core` 不得导出未使用的内存实现

### 需求:移除未使用依赖和 schema
代码库必须移除未被主路径使用的依赖、schema 文件和锁文件，或将其接入真实运行路径。

#### 场景:Drizzle 未接入时被移除
- **当** 系统仍使用 raw SQL 初始化和迁移数据库
- **那么** 必须移除未被引用的 Drizzle schema 文件和相关依赖

#### 场景:包管理器保持单一
- **当** 仓库使用 pnpm workspace 作为主包管理方式
- **那么** 不得保留会误导安装路径的 `package-lock.json`

### 需求:历史文档归档
历史计划文档中引用旧 `src/*` 路径的内容必须归档或迁移到 OpenSpec，避免被误认为当前实现指引。

#### 场景:旧文档引用被处理
- **当** 开发者搜索 `src/wecom-adapter.ts` 等旧路径
- **那么** 搜索结果不得指向仍处于活跃文档区的实现计划

## 修改需求

## 移除需求
