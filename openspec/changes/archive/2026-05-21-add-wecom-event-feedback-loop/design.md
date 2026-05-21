## 上下文

当前平台以企业微信 Bot WebSocket SDK 接收普通消息，`WecomAdapter` 会把可解析的消息转换为 `IncomingMessage`，再由 `BotInstance` 进入按 chatKey 串行的 Agent 队列。Wiki 侧已经具备 namespace、MCP 检索、检索日志、无命中治理、知识草稿审核、Git 合并和运营看板。

企微事件回调引入了另一类输入：它们不是用户问题，不一定需要 Agent 回复，并且对响应时限更敏感。尤其是 `feedback_event` 只支持回复空包，却非常适合作为质量治理信号。如果不把事件和普通消息分流，反馈、卡片点击和进入会话事件可能被误当成普通文本消息，污染会话与模型上下文。

## 目标 / 非目标

**目标：**

- 建立统一事件管道，支持企业微信事件排重、审计、快速响应和异步处理。
- 将 `feedback_event` 关联到某一次机器人回复，复盘当时用户问题、答案、Context、Session 和 Wiki 检索证据。
- 把反馈引入 Wiki 运营工作台，支持转草稿、标记检索问题、标记模型/工具问题和忽略。
- 让正反馈和已审核负反馈可以沉淀为标注答案，作为高频确定性问题的稳定回复路径。
- 复用现有 SQLite/libSQL、Wiki 草稿审核和检索日志能力，避免引入新检索基础设施。

**非目标：**

- 不在本变更中引入向量数据库、embedding 索引或新的搜索服务。
- 不实现复杂多级审批、权限矩阵或实时多人编辑。
- 不承诺自动把用户反馈内容直接写入正式 Wiki。
- 不替代 Dify、LangSmith 等外部观测平台；本变更只提供平台内的轻量质量闭环。
- 不要求所有回复都变成模板卡片；只有需要反馈控件或交互控件的回复才携带相关元数据。

## 决策

### 决策 1: 事件和普通消息使用同一内部入口、不同处理分支

新增 `IncomingEvent` 类型和事件处理器。`WecomAdapter` 解析 `msgtype=event` 后必须交给事件处理器，禁止进入 `onMessage` 的普通 Agent 队列。若企业微信事件通过 HTTP 加密回调进入，则 HTTP 路由解密后也转换为同一 `IncomingEvent`。

理由：

- 保持 WebSocket SDK 和 HTTP callback 两种来源的后续逻辑一致。
- 事件处理不占用 chatKey 的普通消息队列，避免反馈事件触发“正在分析”占位消息。
- 可以统一做 `msgid` 去重、审计和异步任务调度。

替代方案：

- 在 `BotInstance.handleMessage` 内判断事件并提前返回：改动少，但会把事件和消息边界继续混在一起，后续卡片交互与反馈处理会越来越难维护。

### 决策 2: 所有事件先持久化，再异步处理

新增 `wecom_events` 表，至少记录 `msgid`、`event_type`、`bot_id`、`aibotid`、`chat_key`、`chatid`、`chattype`、`from_userid`、`response_url`、`raw_payload`、`status`、`created_at` 和 `processed_at`。事件收到后先按 `msgid` 去重并落库，再进入轻量后台处理。

理由：

- 企业微信可能重复回调，`msgid` 是天然幂等键。
- `template_card_event` 五秒内未响应会被丢弃，先落库后快速响应更稳。
- 反馈和卡片点击是运营审计数据，不能只写应用日志。

替代方案：

- 只内存去重：重启后会重复处理，且无法在控制台复盘。

### 决策 3: 使用 response run 作为反馈和知识证据的核心关联对象

新增 `bot_response_runs` 表表示一次机器人回答，保存 `id`、`feedback_id`、`bot_id`、`context_id`、`session_id`、`chat_key`、`chat_id`、`user_id`、`question_preview`、`answer_preview`、`provider`、`model`、`status`、`created_at`。`session_messages` 和 `wiki_retrieval_logs` 增加 nullable `response_run_id`，用于把某次回答和当时检索证据连起来。

理由：

- 企微反馈事件只返回开发者设置的反馈 ID，不会自动带回完整问答上下文。
- 反馈复盘需要明确知道“这次回答用了哪些 Wiki 文档”，只靠 chatKey 和时间窗口不可靠。
- 后续评测、标注答案和质量指标都可以以 response run 为最小单元。

替代方案：

- 直接在 `session_messages` 里塞反馈 ID：简单但难以承载检索日志、消息平台 ID、模型信息和处理状态。

### 决策 4: 反馈运营项独立于原始事件

新增 `wiki_feedback_items` 表，按反馈可处理项建模，字段包括 `event_id`、`response_run_id`、`namespace`、`feedback_type`、`content`、`inaccurate_reasons`、`classification`、`status`、`assigned_target_path`、`draft_id`、`resolution_note`、`created_at`、`updated_at`。

理由：

- 原始事件是事实记录，运营项是处理流程，两者生命周期不同。
- 同一个负反馈可能最终被判定为知识缺失、检索问题、模型问题或无需处理。
- 反馈工作台需要状态流转和处理备注，不宜污染原始事件表。

状态建议：

- `new`: 新反馈，尚未分流。
- `triaged`: 已分流但未完成。
- `drafted`: 已生成 Wiki 草稿。
- `resolved`: 已通过草稿合并、标注答案或配置修复完成。
- `ignored`: 已确认无需处理。

### 决策 5: 负反馈只生成草稿，不直接修改正式 Wiki

反馈转 Wiki 时复用现有 `wiki_knowledge_drafts`，新增 `source_type = feedback-event`，`source_ref` 保存 `feedback:<feedbackItemId>;run:<responseRunId>`。草稿内容由系统预填“问题、原答案、反馈内容、负反馈原因、命中文档、建议修正方向”，管理员必须编辑确认后才能合并。

理由：

- 用户反馈只能说明“这次回答可能有问题”，不等同于可信知识。
- 现有草稿审核、diff、合并策略和 Git commit 已覆盖知识变更安全边界。
- 对 `与问题无关`、`数据分析错误` 等原因，不一定应该写 Wiki，先进入分流更稳。

替代方案：

- 让模型自动修 Wiki：速度快但风险高，容易把错误反馈或幻觉写入正式知识库。

### 决策 6: 标注答案作为 Wiki/RAG 前的高置信快路径

新增 `annotation_answers` 表，保存已审核的问题变体、答案、namespace、context 范围、来源反馈项、启用状态和命中统计。Bot 处理用户问题时，在 Wiki `autoSearch` 前先检查当前 Context/namespace 下的启用标注答案；命中后可以直接回复或作为强提示注入。

理由：

- 对高频、标准化、合规要求强的问题，人工审核答案比 RAG 更稳定。
- 正反馈高的问题和负反馈修复后的答案都可以转成标注答案。
- 这是可选能力，不影响现有 Wiki 检索策略。

替代方案：

- 全部写入 Wiki 后依赖检索召回：统一但不稳定，尤其是关键字检索可能漏召回。

### 决策 7: 反馈原因驱动默认分流建议

系统根据 `feedback_event.type` 和 `inaccurate_reason_list` 给出默认建议，但管理员可以覆盖：

- 准确反馈：建议加入正样本或候选标注答案。
- 与问题无关：建议标记为检索/路由问题。
- 内容不完整：建议转 Wiki 补充草稿。
- 内容有错误：若有命中文档，建议修正目标文档；否则建议新建知识草稿。
- 数据分析错误：建议标记为模型/工具/数据口径问题。
- 取消反馈：撤销统计影响，保留原始事件审计。

理由：

- 产品上先帮助管理员分流，不替管理员做最终判断。
- 原因映射让运营看板能回答“应该改知识、改检索，还是改工具链”。

## 风险 / 权衡

- [事件加密回调接入复杂] → 优先复用官方 SDK 或现有 SDK 能力；HTTP callback 解密、签名校验和错误响应必须有独立测试。
- [反馈 ID 未正确设置导致无法关联] → feedback event 必须仍入库，但反馈项标记为 `unlinked`，控制台提示该 Bot 回复未启用反馈追踪。
- [反馈内容包含敏感信息] → 原始事件仅管理员可见；草稿预填必须提醒审核者清理敏感信息，正式 Wiki 不自动写入用户原话。
- [SQLite 日志增长] → 事件和 response run 表按 created_at 建索引，运营页默认近 7/30 天窗口，后续可增加保留策略。
- [标注答案误命中] → 第一版可采用精确问题或管理员维护的问题变体，不做激进语义匹配；命中记录可回滚禁用。
- [Dify provider 的回复追踪不一致] → response run 放在平台层创建，Dify conversationId 作为附加字段保存，避免和本地 Session 耦合。
- [模板卡片 response_url 时效短] → 事件处理先快速响应并落库，主动回复或卡片更新失败记录为处理错误，不阻塞事件确认。

## 迁移计划

1. 新增数据表和 nullable 字段，旧数据无需回填；已有 session、草稿和检索日志继续可用。
2. 扩展类型和适配器，让事件从普通消息流中分离。
3. 在 Bot 回复路径创建 response run，并在发送回复时设置反馈 ID。
4. 将 Wiki 检索日志和 session messages 关联到 response run。
5. 接入 `feedback_event`，生成反馈运营项。
6. 扩展 Wiki API 和 Web 控制台，提供反馈工作台、转草稿和指标。
7. 增加标注答案 API 和命中路径。

回滚策略：

- 禁用事件接收 URL 或 Bot 反馈信息配置后，普通消息问答不受影响。
- 新增表保留但不参与主流程；关闭标注答案后恢复现有 Wiki 检索路径。
- 已生成的 Wiki 草稿仍通过现有审核流程处理，可手动拒绝。

## 待定问题

- 企业微信 Node SDK 是否已经暴露完整事件帧和反馈信息设置能力，还是需要补充 HTTP callback 解密实现？
- 反馈 ID 在普通 markdown、流式回复、模板卡片回复中的具体承载格式是否一致？
- 标注答案第一版采用精确匹配、关键词匹配，还是接入后续语义匹配能力？
- 反馈事件和 response run 默认保留周期应为 30 天、90 天，还是跟随环境变量配置？
