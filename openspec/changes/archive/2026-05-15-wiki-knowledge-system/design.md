## 上下文

wecom-agent-platform 是一个多 Bot 企业微信 AI 平台，Bot 通过 Context（系统提示 + 工具配置）驱动。当前 Context 只支持静态系统提示，无法访问外部知识库。MCP Server 已支持 SSE transport，Context 通过 `mcpConfigs` 绑定工具集，`params` 字段可注入系统提示。

本变更在不修改 `bot-instance.ts` 核心逻辑的前提下，通过新增 Wiki MCP Server package 和配套管理能力，为平台引入可持续演化的知识库系统。

## 目标 / 非目标

**目标：**
- Wiki 以本地 Git 仓库形式存储，支持 Obsidian 直接编辑
- 单个 Wiki MCP Server 实例服务多个 namespace，Context 通过 params 绑定
- 四条更新路径均可独立工作：Obsidian 编辑、Web 上传、定时编译、对话提炼
- namespace 元数据持久化到 SQLite，与现有数据模型一致
- wiki-mcp-server 作为 monorepo 第四个 package，复用 types 包

**非目标：**
- 不引入向量数据库或 embedding（Karpathy Wiki 模式，纯文件）
- 不实现全文搜索引擎（关键字 + 标题匹配即可）
- 不修改 `bot-instance.ts` 的 `resolveTools` 逻辑
- 不支持 stdio MCP transport（现有限制）
- 不实现 Wiki 页面的版本历史 UI（git log 已覆盖）

## 决策

### D1：namespace 路由通过系统提示注入，而非工具参数绑定

**选择**：`mcpConfigs.params` 的 namespace 值注入到系统提示，LLM 在调用工具时自动带上 namespace 参数。

**理由**：现有 `resolveTools` 不传递 params 给工具调用，修改会影响所有 MCP 工具的行为。系统提示注入对 LLM 语义更自然，且零改动核心代码。

**替代方案**：修改 `resolveTools` 将 params 绑定为工具默认参数——更精确但侵入性强，留作未来优化。

### D2：wiki-mcp-server 作为独立 package，SSE transport

**选择**：`packages/wiki-mcp-server`，独立 Node.js 进程，SSE transport，与现有 MCP 架构完全一致。

**理由**：复用现有 `mcp-client.ts` 的 SSE 连接逻辑，无需改动 Bot 启动流程。独立 package 便于单独部署和版本管理。

**替代方案**：内嵌到 `packages/core`——耦合度高，不利于独立迭代。

### D3：Wiki 存储为本地 Git 仓库，WIKI_ROOT 环境变量配置

**选择**：`WIKI_ROOT` 指向服务器本地目录，该目录同时是 Git 仓库。Obsidian 打开同一目录，obsidian-git 自动 push，wiki-mcp-server 定时 `git pull`。

**理由**：最简单的同步机制，无需额外服务。本地文件读写延迟最低，`forceCall` 场景下注入系统提示性能最优。

**替代方案**：独立 Git 远端仓库（GitHub/Gitea）——更干净但多一跳网络延迟，适合多机部署时再引入。

### D4：wiki_namespaces 表存储元数据，路径相对于 WIKI_ROOT

**选择**：数据库存储 namespace 的 `name`、`display_name`、`path`（相对路径）、`description`、`git_enabled`、`auto_compile`、`compile_schedule`。

**理由**：与现有数据模型一致（SQLite + libSQL），Web Console 可直接 CRUD，无需解析文件系统。

### D5：wiki-compiler 作为 Script Skill 模板，而非内置功能

**选择**：提供一个可安装的 Node.js Script Skill bundle，用户按需安装到 Bot。

**理由**：不同 Bot 的知识提炼逻辑差异大（提炼频率、目标 namespace、过滤规则），Skill 机制天然支持自定义。复用现有 Skill 安全沙箱和审计日志。

## 风险 / 权衡

- **git pull 延迟**：Obsidian 编辑后最长 5 分钟才反映到 Bot → 缓解：wiki-mcp-server 提供 `wiki_git_pull` 工具，可手动触发或通过 Web Console 触发
- **并发写入冲突**：多个 Bot 同时调用 `wiki_write` 可能产生 git 冲突 → 缓解：wiki-mcp-server 内部使用写入队列串行化 git 操作
- **WIKI_ROOT 未配置**：wiki-mcp-server 启动时检查，未配置则拒绝启动并输出明确错误 → 不影响其他 Bot 功能
- **大文件性能**：单个 Wiki 页面过大时 `forceCall` 注入会撑大 context window → 缓解：`wiki_read` 支持 `max_chars` 参数截断

## 迁移计划

1. 部署 wiki-mcp-server（`pnpm --filter wiki-mcp-server start`）
2. 初始化 WIKI_ROOT 目录（`git init`）
3. 在 Web Console 创建 namespace
4. 在 Bot 的 MCP Servers 页面注册 wiki-mcp-server（SSE URL）
5. 在 Context 的 mcpConfigs 中启用 wiki-mcp-server，配置 `params.namespace`
6. （可选）Obsidian 打开 WIKI_ROOT，安装 obsidian-git 插件

回滚：禁用 Context 中的 wiki-mcp-server 配置即可，无数据损失。

## Open Questions

- wiki-mcp-server 的 SSE 端口默认值？建议 `3001`，通过 `WIKI_MCP_PORT` 配置
- `wiki_search` 是否需要支持正则表达式？当前设计为关键字匹配，足够 MVP
- 对话后自动提炼的触发时机：session TTL 到期 vs 显式 `/end` 命令？留给 Skill 实现者决定
