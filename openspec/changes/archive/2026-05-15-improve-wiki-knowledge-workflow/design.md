## 上下文

Wiki 当前由三层组成：

```text
管理员
  │
  ├─ Web Console /wiki
  │    ├─ namespace CRUD
  │    ├─ Markdown 上传/删除
  │    └─ Git Pull
  │
  ├─ MCP 服务器
  │    └─ 注册 wiki-mcp SSE URL
  │
  └─ Context 配置
       └─ 启用 wiki-mcp，并在 params 中填写 namespace/forceCallPage

Bot 运行时
  │
  ├─ injectWikiNamespace 注入 namespace 提示
  ├─ wiki_read/wiki_search 等工具由 LLM 主动调用
  └─ forceCall 可在对话前注入固定页面或检索结果
```

这套架构合理，但管理端心智分散。产品优化的核心不是换技术路线，而是把现有能力按用户目标重组：

```text
创建知识库 -> 导入内容 -> 绑定助手 -> 验证回答 -> 持续沉淀
```

## 目标 / 非目标

**目标：**

- 让首次配置 Wiki 的管理员不需要理解所有底层参数，也能完成可用配置。
- 让 Wiki namespace 成为主对象：从 namespace 出发看到文档、状态、绑定、检索策略和沉淀队列。
- 让“Bot 是否真的能读到知识”可测试、可观察。
- 让自动写入 Wiki 从高风险的直接写入变为可审核的草稿流程。
- 保留高级用户对 MCP 参数、Git 存储和 Obsidian 工作流的控制能力。

**非目标：**

- 不改变 Wiki 的基础存储模型。
- 不把 Wiki 做成完整 CMS。
- 不把所有 MCP 服务器都纳入专用向导，只针对 wiki-mcp 做产品化捷径。

## 信息架构

建议将 `/wiki` 从单页卡片 + 文件树扩展为三层结构：

```text
Wiki 知识库
  ├─ 总览
  │   ├─ namespace 列表
  │   ├─ 全局健康状态
  │   └─ 首次使用向导入口
  │
  ├─ Namespace 详情
  │   ├─ 文档
  │   │   ├─ 文件树
  │   │   ├─ 搜索
  │   │   └─ Markdown 预览
  │   ├─ 绑定
  │   │   ├─ 已绑定 Bot/Context
  │   │   └─ 绑定/解绑操作
  │   ├─ 检索策略
  │   │   ├─ 按问题自动搜索
  │   │   ├─ 固定注入页面
  │   │   └─ 仅手动工具调用
  │   ├─ 健康状态
  │   │   ├─ Git 状态
  │   │   ├─ wiki-mcp 在线状态
  │   │   ├─ 文件数量和最近同步
  │   │   └─ 检索测试
  │   └─ 知识草稿
  │       ├─ 待审核
  │       ├─ 已合并
  │       └─ 已拒绝
```

## 关键决策

### 1. Namespace 是产品主对象

当前 namespace 只是数据库元数据和目录映射。优化后，namespace 页面应该承载“这个知识库能被谁用、怎么用、是否健康、有哪些待沉淀知识”的完整视图。

这样做的好处是管理员的工作路径更顺：他先关心知识库本身，再决定把它接给哪些 Bot。

### 2. Wiki MCP 注册提供推荐路径

如果系统检测不到名称或 URL 指向 wiki-mcp 的 MCP Server，Wiki 向导应提供“注册 Wiki MCP Server”步骤，并预填 `http://localhost:3001/sse` 或基于环境变量推导的地址。

仍保留 MCP 服务器页面作为高级配置入口，但首次路径不要求用户离开 Wiki 页面。

### 3. 检索策略包装 forceCall

当前 `forceCall` 是通用 MCP 概念，在 Wiki 上容易产生误用：如果强制调用所有工具，部分工具参数不匹配；如果固定页面注入，又可能撑大上下文。

建议在 UI 中暴露 Wiki 专用策略：

| 策略 | 底层行为 | 适用场景 |
| --- | --- | --- |
| 按问题自动搜索 | 对用户问题调用 `wiki_search(query, namespace)`，结果注入系统提示 | 常规知识问答 |
| 固定注入页面 | 调用 `wiki_read(forceCallPage, namespace)` | 规则、政策、固定 SOP |
| 手动工具调用 | 只注入 namespace 提示，模型自行决定调用工具 | 成本敏感或知识偶发使用 |

### 4. 健康检查分层展示

健康状态不应该只有一个“可用/不可用”。建议拆成：

- 存储健康：`WIKI_ROOT` 是否配置、目录是否存在、是否 Git 仓库。
- 同步健康：是否有 remote、最近 pull 结果、是否有未提交变更。
- 服务健康：wiki-mcp `/health` 是否可达、MCP tools 是否能加载。
- 绑定健康：是否有 Context 引用该 namespace、是否有失效 MCP Server。
- 检索健康：用测试问题执行一次 search/read，返回命中摘要。

### 5. 自动沉淀采用审核队列

直接让 Bot 或定时任务 `wiki_write/wiki_append` 写入正式页面，容易引入过期、重复或模型幻觉内容。更稳的产品路径是：

```text
对话/定时任务
  -> 提炼候选知识
  -> 写入 wiki_knowledge_drafts
  -> 管理员审核
  -> 合并到目标 Markdown 页面
  -> Git commit
```

第一版可以不做复杂 diff，只要求草稿包含目标 namespace、建议页面、Markdown 内容、来源会话、状态和审核人。

## API 草图

这些接口是产品产物层面的建议，具体实现时可调整命名：

```text
GET  /api/wiki/health
GET  /api/wiki/:namespace/health
GET  /api/wiki/:namespace/search?q=...
GET  /api/wiki/:namespace/files/*filepath
GET  /api/wiki/:namespace/bindings
POST /api/wiki/:namespace/bindings
PUT  /api/wiki/:namespace/bindings/:contextId/policy

GET  /api/wiki/:namespace/drafts
POST /api/wiki/:namespace/drafts
POST /api/wiki/:namespace/drafts/:id/approve
POST /api/wiki/:namespace/drafts/:id/reject
```

## 风险 / 权衡

- 向导过度封装可能遮蔽高级配置。缓解：每一步提供“高级配置”入口，落到现有 MCP/Context 页面。
- 健康检查可能引入跨服务调用失败。缓解：健康项独立展示，单项失败不阻断页面加载。
- 搜索预览如果只做关键词匹配，召回质量有限。缓解：明确这是第一版搜索体验，后续再评估索引或 embedding。
- 审核队列会让自动沉淀慢一步。这个成本是值得的，因为知识库质量比写入速度更关键。

## 迁移计划

1. 保留现有 Wiki、MCP、Context 数据结构和路由。
2. 在 Wiki 页面补充向导和 namespace 详情框架。
3. 增加只读健康检查和绑定摘要，先不改变运行时行为。
4. 增加搜索与 Markdown 预览，让管理员能验证内容。
5. 将 Context 中 Wiki 相关参数以专用 UI 呈现，并映射回现有 `mcpConfigs`。
6. 增加知识草稿表和审核 API，再接入 wiki-compiler 或定时任务。
7. 最后再将运行时 forceCall 逻辑收敛到 Wiki 检索策略。
