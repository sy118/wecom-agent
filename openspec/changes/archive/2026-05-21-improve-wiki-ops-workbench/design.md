## 上下文

当前 Wiki 能力分布在三个层面：

- Web 控制台的 `WikiPage` 负责 Namespace、文件树、搜索预览、Context 绑定、健康状态和草稿审核。
- API 的 `/api/wiki/*` 负责 Wiki 配置、Markdown 文件读写、草稿、Git Pull、Context MCP 配置绑定和基础健康检查。
- Bot 运行时在 `BotInstance` 中根据 Context 的 Wiki MCP 配置执行 `manual`、`autoSearch` 或 `fixedPage` 策略，并通过 wiki-mcp 的 `wiki_search` / `wiki_read` 获取内容。

已有实现能完成基础闭环，但缺少端到端可观测能力：管理员无法从一次 Bot 回答追溯到实际 query、命中文档、耗时和无命中原因；草稿审核也缺少合并前差异和编辑能力。本设计以增量改造为主，避免引入新的检索基础设施或复杂审批系统。

## 目标 / 非目标

**目标：**

- 提供端到端 Wiki 配置体检，让管理员能定位 Wiki 不可用的具体环节。
- 记录 Bot 自动 Wiki 检索日志，支持后续检索调试、无命中治理和运营看板。
- 将测试检索升级为可解释的调试体验，展示命中路径、摘要、耗时和后续操作。
- 增强草稿审核，支持编辑、驳回原因、合并策略和合并前差异预览。
- 增加 Namespace 运营指标，帮助管理员持续维护知识质量。

**非目标：**

- 不在本变更中实现向量检索或语义索引。
- 不实现 MCP 工具热重载；配置变更后仍允许通过提示引导管理员重启 Bot。
- 不替代 Obsidian、Confluence、飞书文档等完整文档协作系统。
- 不引入多级审批、复杂权限模型或实时多人编辑。
- 不移除现有 `wiki_write` / `wiki_append` 工具，只强化推荐的草稿审核路径。

## 决策

### 决策 1: 使用数据库表记录检索日志

新增 `wiki_retrieval_logs` 表，记录 Bot 在 `autoSearch` 和 `fixedPage` 策略下的 Wiki 检索行为。

建议字段：

```sql
CREATE TABLE wiki_retrieval_logs (
  id TEXT PRIMARY KEY,
  bot_id TEXT,
  context_id TEXT,
  chat_key TEXT,
  namespace TEXT NOT NULL,
  policy TEXT NOT NULL,
  query TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  hit_paths TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL
);
```

理由：

- SQLite/libSQL 已是项目默认持久化方案，适合小团队私有化部署。
- 检索日志需要被 Web API 查询、聚合、筛选和转草稿，落库比只写日志文件更实用。
- 后续可通过定期清理策略控制数据量。

替代方案：

- 只写应用日志：实现简单，但 Web 控制台无法稳定查询和聚合。
- 直接复用 session messages：缺少检索结构化字段，难以统计无命中和热门文档。

### 决策 2: 第一阶段复用现有关键词搜索，不引入向量检索

检索调试台先基于现有搜索能力展示 query、命中数、路径、摘要和耗时。可以改进排序和结构化返回，但不引入 embedding、索引服务或外部向量数据库。

理由：

- 当前主要痛点是不可解释和不可运营，不是单纯召回算法。
- 没有检索日志前，即使引入语义检索，也难以评估效果。
- 保持部署复杂度低，符合项目当前 SQLite + Markdown + MCP 的轻量架构。

替代方案：

- 立即接入向量检索：召回可能提升，但会带来索引更新、权限隔离、部署依赖和质量评估复杂度。

### 决策 3: 草稿审核采用轻量工作流

保留 `pending / merged / rejected` 状态模型，增加编辑、合并策略和 diff 预览，而不是引入多级审批。

建议合并策略：

- `append`: 追加到目标页面，保持当前兼容行为。
- `replace`: 覆盖目标页面。
- `createOnly`: 仅当目标页面不存在时创建。

理由：

- 当前风险最高的是“看不清即将写入什么”，diff 和策略选择比复杂审批更紧迫。
- 保持数据模型简单，适合当前单管理员或小团队场景。

替代方案：

- 新增多级审批流：更完整但超出当前平台权限体系，容易扩大范围。

### 决策 4: 配置体检聚合现有状态而非新建独立服务

扩展 `/api/wiki/health` 返回端到端诊断结果，包括基础设施、MCP 配置、Context 绑定、Bot 运行和最近测试状态。Web 层按结果渲染步骤和修复入口。

理由：

- API 已能访问数据库中的 MCP、Context、Bot 信息，也能访问 `WIKI_ROOT` 和 wiki-mcp 健康端点。
- 聚合到单接口可以减少前端拼装复杂度，也便于测试。

替代方案：

- 前端分别调用多个 API 自行聚合：开发快，但错误原因和诊断规则会分散。

### 决策 5: 运营看板基于日志聚合，不额外维护计数缓存

第一版按时间窗口从 `wiki_retrieval_logs`、`wiki_knowledge_drafts`、文件树和绑定摘要中实时聚合指标。若后续数据量增长，再增加缓存表或定时聚合。

理由：

- 当前部署规模预期较小，实时聚合足够。
- 避免新增缓存一致性问题。

替代方案：

- 新增 `wiki_namespace_metrics` 缓存表：查询更快，但实现和维护成本更高。

## 风险 / 权衡

- [检索日志包含敏感问题] → 默认只记录必要字段，避免记录完整模型回答；后续可增加保留周期和清理任务。
- [日志量增长导致 SQLite 查询变慢] → 为 `namespace`、`created_at`、`hit_count` 建索引；运营看板默认查询近 7 天。
- [API 搜索和 MCP 搜索结果不一致] → 抽取共享搜索排序规则，或至少保持返回字段和排序逻辑一致。
- [Bot 配置变更后未重启仍旧不可用] → 在绑定、MCP URL 修改、策略修改后明确提示“需要重启 Bot”，并提供跳转操作。
- [草稿 diff 对 Markdown 语义理解有限] → 第一版提供文本级 diff，先解决可见性问题，不承诺 Markdown AST 合并。
- [无命中问题可能被误转为低质量草稿] → 转草稿时仅预填来源和问题，不自动生成正式内容；仍需管理员补写和审核。

## 迁移计划

1. 添加数据库迁移：
   - 新建 `wiki_retrieval_logs`。
   - 为草稿表增加合并策略字段，或在 API 请求中临时传入合并策略并保持默认 `append`。
2. 扩展 API：
   - 健康体检聚合。
   - 检索日志写入和查询。
   - 草稿编辑、diff 和合并策略。
   - Namespace 运营指标。
3. 扩展 Bot 运行时：
   - 在 `executeForceCallMcps` 中围绕 `wiki_search` / `wiki_read` 记录日志。
   - 工具不可用或调用失败时记录错误。
4. 扩展 Web：
   - 体检中心。
   - 检索调试台。
   - 草稿详情和 diff。
   - 运营看板。
5. 回滚：
   - 保留新增表不会影响旧功能。
   - Web 新入口可隐藏，旧的 Wiki 文档、绑定和草稿流程仍可继续使用。

## 待定问题

- 检索日志默认保留多久：30 天、90 天，还是由环境变量配置？
- 是否需要对 `chat_key` 或 query 做脱敏/哈希？
- `wiki_search` 是否需要在本变更中抽出共享搜索函数，还是先保持 API/MCP 两套实现但统一排序规则？
- 草稿合并策略是否需要在数据库中持久化，还是只作为合并时的一次性参数？
