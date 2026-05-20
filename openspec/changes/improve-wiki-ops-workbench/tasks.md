## 1. 数据与仓储

- [x] 1.1 在数据库初始化中新增 `wiki_retrieval_logs` 表和必要索引
- [x] 1.2 新增 Wiki 检索日志 repository，支持创建日志、按 namespace 查询、按时间范围筛选和无命中聚合
- [x] 1.3 扩展草稿 repository，支持编辑草稿内容、目标路径、驳回原因和合并策略所需字段
- [x] 1.4 为新增数据库逻辑补充单元测试或 API 集成测试覆盖

## 2. Wiki API

- [x] 2.1 扩展 `/api/wiki/health`，聚合 `WIKI_ROOT`、Git、wiki-mcp、MCP Server、Namespace、Context 绑定和 Bot 运行状态
- [x] 2.2 扩展 `/api/wiki/:namespace/health`，返回待审核草稿数、最近无命中数和最近检索测试状态
- [x] 2.3 新增 namespace 检索日志查询 API，返回 query、策略、命中数、命中文档、耗时、错误和创建时间
- [x] 2.4 新增 namespace 无命中问题 API，按 query 聚合无命中次数、最近出现时间和关联 context 信息
- [x] 2.5 新增 namespace 运营指标 API，返回文档数、绑定数、待审核草稿数、检索次数、无命中次数、热门命中文档和热门无命中问题
- [x] 2.6 新增草稿编辑 API，支持修改 Markdown 内容和目标页面路径，并复用安全路径校验
- [x] 2.7 新增草稿 diff API，支持 `append`、`replace` 和 `createOnly` 策略的合并前预览
- [x] 2.8 更新草稿批准 API，按合并策略追加、覆盖或仅创建新页面，并保持失败时不误标记已合并

## 3. Bot 运行时

- [x] 3.1 在 `autoSearch` 执行路径中记录 Wiki 检索日志，包括命中数、命中文档路径、耗时和错误
- [x] 3.2 在 `fixedPage` 执行路径中记录页面读取日志，包括页面路径、成功状态、耗时和错误
- [x] 3.3 确保检索日志写入失败不会影响 Bot 正常回复流程
- [x] 3.4 为 `manual`、`autoSearch`、`fixedPage` 和工具不可用场景补充运行时测试

## 4. Web 配置体检与向导

- [x] 4.1 将 Wiki 总览页增加配置体检中心，展示存储目录、Git、wiki-mcp、MCP Server、Namespace、Context 绑定、Bot 运行和测试检索状态
- [x] 4.2 为体检异常增加修复入口，包括创建 Namespace、启用 MCP Server、绑定 Context、启动或重启 Bot、执行测试检索
- [x] 4.3 更新首次使用向导，使缺失步骤与配置体检结果一致
- [x] 4.4 在启用 wiki-mcp、修改 Context 绑定或保存检索策略后提示关联 Bot 需要重启

## 5. Web 检索调试台

- [x] 5.1 将健康状态中的测试检索升级为检索调试台，展示 query、命中数、命中路径、片段和耗时
- [x] 5.2 在无命中状态中提供上传文档、创建草稿、调整 query 和检查策略的操作入口
- [x] 5.3 支持查看 namespace 最近检索日志和无命中问题列表
- [x] 5.4 从无命中问题创建草稿时自动带入 sourceType、sourceRef 和原始 query

## 6. Web 草稿审核增强

- [x] 6.1 增加草稿详情弹窗，展示 Markdown 预览、来源、目标路径和状态
- [x] 6.2 支持编辑草稿内容和目标页面路径
- [x] 6.3 支持选择 `append`、`replace`、`createOnly` 合并策略
- [x] 6.4 合并前展示目标页面差异预览
- [x] 6.5 驳回草稿时要求或允许填写原因，并在草稿列表中展示

## 7. Web 运营看板

- [x] 7.1 为 Namespace 增加运营 Tab，展示文档数、绑定数、待审核草稿数、最近更新时间、近 7 天检索次数和无命中次数
- [x] 7.2 展示热门命中文档和热门无命中问题
- [x] 7.3 在 Namespace 列表中展示待审核草稿数和基础健康状态摘要
- [x] 7.4 为无数据状态提供测试检索、上传文档和创建草稿入口

## 8. 验证与文档

- [x] 8.1 更新 README 的 Wiki 使用说明，补充配置体检、检索调试、运营看板和草稿 diff 流程
- [x] 8.2 运行 `pnpm build`
- [x] 8.3 运行 `pnpm test`
- [x] 8.4 运行 `openspec-cn validate improve-wiki-ops-workbench --strict`
