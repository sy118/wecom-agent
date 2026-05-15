## 1. Wiki 使用向导

- [x] 1.1 在 Wiki 页面增加首次使用状态检测：无 namespace、无 wiki-mcp、无绑定 Context 时展示向导入口
- [x] 1.2 实现向导步骤：创建 namespace、确认 Wiki 根目录、注册 wiki-mcp、选择 Bot/Context、选择检索策略、发送测试问题
- [x] 1.3 支持从向导预填 wiki-mcp 推荐配置，并允许跳转到高级 MCP 配置
- [x] 1.4 向导完成后在 namespace 详情页展示配置摘要和下一步操作

## 2. Namespace 详情体验

- [x] 2.1 重构 WikiPage 的 namespace 详情布局，拆分文档、绑定、检索策略、健康状态、知识草稿区域
- [x] 2.2 增加 Markdown 文件搜索 API 和 UI，支持按文件名和正文关键词搜索
- [x] 2.3 增加文件内容预览，点击文件树节点后展示 Markdown 预览、路径、大小和最近修改时间
- [x] 2.4 保留上传、删除、刷新、Git Pull 等现有操作，并在操作后刷新详情状态

## 3. Context 绑定交互

- [x] 3.1 增加 namespace 绑定摘要 API，返回已绑定的 Bot、Context、MCP Server 和策略信息
- [x] 3.2 在 namespace 详情页提供“绑定到 Bot/Context”操作，自动写入对应 Context 的 wiki-mcp 配置
- [x] 3.3 在 Context 页面识别 wiki-mcp，并使用专用表单配置 namespace 和检索策略
- [x] 3.4 保留高级 params JSON/动态参数入口，避免阻断非标准 wiki-mcp 配置

## 4. Wiki 检索策略

- [x] 4.1 定义 Wiki 检索策略类型：manual、autoSearch、fixedPage
- [x] 4.2 将策略配置映射到现有或新增的 `mcpConfigs.params` 字段
- [x] 4.3 修改 BotInstance 的强制检索逻辑，让 Wiki MCP 按策略调用 `wiki_search` 或 `wiki_read`
- [x] 4.4 为检索策略增加单元测试，覆盖固定页面、自动搜索、无策略和 MCP 不可用场景

## 5. 健康状态与可观测性

- [x] 5.1 增加全局 Wiki 健康检查 API：WIKI_ROOT、Git 仓库、remote、wiki-mcp 连接状态
- [x] 5.2 增加 namespace 健康检查 API：文件数、最近同步、绑定数量、最近检索测试结果
- [x] 5.3 在 Wiki 页面展示健康状态，区分正常、警告、错误和未知
- [x] 5.4 增加“测试检索”操作，输入问题后展示 `wiki_search` 命中摘要

## 6. 知识草稿审核

- [x] 6.1 增加知识草稿数据模型，保存 namespace、建议页面、Markdown 内容、来源、状态、审核信息
- [x] 6.2 增加草稿创建、列表、批准、拒绝 API
- [x] 6.3 审核通过时将草稿内容写入目标 Markdown 页面并执行 Git commit
- [x] 6.4 在 Wiki 页面增加待审核草稿列表和 Markdown 预览
- [x] 6.5 调整 wiki-compiler 使用建议：默认写入草稿而不是直接写入正式 Wiki

## 7. 验证

- [x] 7.1 更新或新增 API 测试，覆盖搜索、健康检查、绑定和草稿审核
- [x] 7.2 更新或新增前端关键流程测试，覆盖向导、预览、绑定和策略配置
- [x] 7.3 运行 `pnpm build`
- [x] 7.4 运行 `pnpm test`
- [x] 7.5 运行 `openspec-cn validate improve-wiki-knowledge-workflow --strict`
