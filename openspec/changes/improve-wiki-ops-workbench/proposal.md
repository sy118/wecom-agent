## 为什么

当前 Wiki 已经支持 Namespace、文档浏览、Context 绑定、检索策略、健康检查和知识草稿，但整体体验仍偏工程配置页。管理员需要同时理解 `WIKI_ROOT`、wiki-mcp、MCP Server、Context、Bot 重启和检索策略，任何一环出错都会表现为 Bot 无法使用 Wiki 或检索无命中。

本变更旨在把 Wiki 从“可配置的文档入口”升级为“Bot 知识运营工作台”：让管理员能快速判断 Wiki 是否可用、解释一次检索为什么命中或没命中、安全审核沉淀的新知识，并持续观察知识库对 Bot 回答的贡献。

## 变更内容

- 增强 Wiki 全局健康检查，将存储目录、Git、wiki-mcp、MCP Server、Context 绑定、Bot 运行状态和检索测试串成可诊断链路。
- 增加 Wiki 配置体检 UI，提供异常原因、修复入口和 Bot 重启提醒。
- 增加 Wiki 检索日志，记录 Bot 自动检索的 query、namespace、策略、命中数、命中文档、耗时和错误。
- 将测试检索升级为检索调试台，展示命中路径、片段、耗时和无命中后续操作。
- 增强知识草稿审核，支持编辑、驳回原因、合并策略和合并前差异预览。
- 增加 Namespace 运营看板，展示待审核草稿、检索次数、无命中问题、热门命中文档等指标。
- 支持从无命中问题一键创建知识草稿，形成“问题 -> 草稿 -> 审核 -> 正式文档 -> 再验证”的闭环。

## 功能 (Capabilities)

### 新增功能
- `wiki-retrieval-observability`: 记录并查询 Bot 使用 Wiki 的检索日志、无命中问题和命中文档摘要。
- `wiki-ops-dashboard`: 在 Namespace 维度展示知识运营指标，并支持从无命中问题创建草稿。

### 修改功能
- `wiki-health-and-observability`: 将健康状态从基础设施检查扩展为端到端配置体检。
- `wiki-retrieval-policy`: 增强检索策略测试与调试反馈，保存前/运行后均能解释策略效果。
- `wiki-knowledge-review`: 增强知识草稿审核、编辑、合并策略和差异预览。
- `wiki-onboarding-workflow`: 首次使用向导应结合体检结果提供最短修复路径和 Bot 重启提示。

## 影响

- API:
  - 扩展 `/api/wiki/health`、`/api/wiki/:namespace/health`。
  - 新增检索日志、无命中问题、运营指标和草稿 diff/edit 相关接口。
  - 新增或迁移 Wiki 检索日志数据表。
- Web:
  - 重构 Wiki 页面中的健康状态、测试检索、草稿审核和 Namespace 概览区域。
  - 增加配置体检中心、检索调试台和运营看板。
- Bot 运行时:
  - 在 `autoSearch` 和 `fixedPage` 策略执行时记录结构化检索日志。
  - 在配置变更后给出 Bot 重启提示，第一阶段不要求实现 MCP 热重载。
- Wiki MCP:
  - 第一阶段不引入新 MCP 工具；可能需要统一 API 搜索和 MCP 搜索结果结构，避免调试结果与 Bot 实际检索不一致。
- 数据:
  - 新增 `wiki_retrieval_logs` 表。
  - 可能扩展 `wiki_knowledge_drafts`，用于合并策略、审核编辑和更明确的来源追踪。
