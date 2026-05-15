## 为什么

当前 Wiki 能力已经完成底层闭环：Markdown 文件存储在 `WIKI_ROOT` Git 仓库中，Web Console 支持 namespace 与文件管理，Bot 通过 `wiki-mcp-server` 的 MCP 工具读取和写入知识，Context 通过 `mcpConfigs.params.namespace` 绑定知识域。

但从使用路径看，Wiki 仍然偏工程配置型：管理员需要在 Wiki、MCP 服务器、Context、定时任务和 Skills 多个页面之间跳转，并手动理解 `namespace`、`forceCall`、`forceCallPage`、SSE URL 等概念。对“我想让某个 Bot 使用某个知识库”这个目标来说，当前交互成本过高，也缺少验证知识库是否可用的可视化反馈。

这次变更聚焦把 Wiki 从“可用能力”打磨成“可运营的知识库产品”：让管理员能按自然工作流完成创建、导入、绑定、测试和持续沉淀。

## 变更内容

- 新增 Wiki 首次使用向导，将“创建 namespace、确认 Git 存储、注册 wiki-mcp、绑定 Context、测试检索”串成一个连续流程。
- 增强 Wiki namespace 详情页，提供文档搜索、Markdown 预览、文件元信息、绑定状态和快速操作。
- 新增从 Wiki namespace 直接绑定 Bot/Context 的交互，减少在 MCP 参数区手填 `namespace` 的步骤。
- 将通用 `forceCall` 在 Wiki 场景中产品化为检索策略：按问题搜索、固定注入页面、手动工具调用。
- 新增 Wiki 健康状态面板，展示 Git、MCP、文件数量、最近同步、绑定关系和检索测试结果。
- 将自动知识沉淀调整为“草稿审核”模型：Bot 或定时任务提炼知识后先进入待审核队列，由管理员确认后写入 Wiki。

## 功能

### 新增能力

- `wiki-onboarding-workflow`: 面向管理员的 Wiki 初始化与绑定向导。
- `wiki-document-experience`: Wiki 文档搜索、预览、文件详情和内容验证体验。
- `wiki-context-binding-ux`: 从 namespace 到 Bot/Context 的可视化绑定体验。
- `wiki-retrieval-policy`: 面向 Wiki 的检索策略配置，替代裸露的通用强制调用心智。
- `wiki-health-and-observability`: Wiki 运行状态、同步状态、绑定状态和检索可用性观测。
- `wiki-knowledge-review`: 自动提炼知识的草稿、审核、合并与拒绝流程。

### 修改能力

- `wiki-file-management`: 从“上传和文件树浏览”扩展为“可搜索、可预览、可验证”的文档管理。
- `wiki-context-binding`: 从手动填写 MCP params 扩展为可视化绑定，并保留高级参数编辑。
- `mcp-force-call`: Wiki 场景下不直接暴露为默认主路径，而映射为更易理解的检索策略。

## 影响

- `apps/web/src/pages/WikiPage.tsx`: 增加向导入口、namespace 详情信息架构、搜索预览、健康状态和绑定入口。
- `apps/web/src/pages/ContextsPage.tsx`: 在 MCP 配置区域识别 Wiki MCP 并展示知识库绑定摘要、检索策略和高级参数。
- `apps/web/src/pages/McpServersPage.tsx`: 为 wiki-mcp 提供推荐配置或自动注册入口。
- `apps/api/src/routes/wiki.ts`: 增加文档搜索、文件详情、健康检查、绑定辅助和知识草稿相关 API。
- `apps/api/src/db/client.ts`: 可能新增知识草稿、检索策略或健康缓存相关表/字段。
- `apps/api/src/bot-manager/bot-instance.ts`: 根据 Wiki 检索策略生成运行时行为，保留已有工具调用路径。
- `packages/wiki-mcp-server`: 可补充健康检查、搜索摘要或工具元数据，不改变现有工具名。

## 非目标

- 不引入向量数据库或 embedding 检索，本轮仍沿用 Markdown + Git + 关键词/MCP 工具模式。
- 不替代 Obsidian 作为高级编辑器；Web Console 只补齐运维和轻量编辑/预览体验。
- 不改变 Dify provider 的知识库职责边界；Dify Bot 仍由 Dify 内部处理知识库和工具调用。
- 不在本变更中实现复杂多人协作编辑、全文版本 diff 或冲突解决 UI。
