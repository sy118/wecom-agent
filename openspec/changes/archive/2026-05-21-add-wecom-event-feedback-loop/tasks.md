## 1. 数据模型与共享类型

- [x] 1.1 在 `packages/types` 中新增企微事件、回复追踪、反馈处理项和标注答案的共享类型
- [x] 1.2 在数据库初始化中新增 `wecom_events` 表和 `msgid` 唯一约束
- [x] 1.3 新增 `bot_response_runs` 表，保存反馈 ID、Bot、Context、Session、chatKey、问题摘要、回答摘要和状态
- [x] 1.4 新增 `wiki_feedback_items` 表，保存反馈分流状态、负反馈原因、目标草稿和处理备注
- [x] 1.5 新增 `annotation_answers` 表，保存人工审核答案、适用范围、来源引用、启用状态和命中统计
- [x] 1.6 为 `session_messages` 增加 nullable `response_run_id` 字段
- [x] 1.7 为 `wiki_retrieval_logs` 增加 nullable `response_run_id` 字段和查询索引
- [x] 1.8 为新增表实现 Repository，并覆盖创建、查询、更新状态和幂等写入

## 2. 企微事件接入

- [x] 2.1 扩展 `WecomAdapter`，将 `msgtype=event` 解析为独立事件对象而不是普通 `IncomingMessage`
- [x] 2.2 为 BotInstance 或 BotManager 增加事件处理入口，保证事件不进入普通 Agent 队列
- [x] 2.3 实现 `enter_chat` 事件入库，并预留按 Bot/Context 配置欢迎回复的处理点
- [x] 2.4 实现 `template_card_event` 入库、排重和五秒内快速确认
- [x] 2.5 实现 `feedback_event` 入库、排重和空包成功响应
- [x] 2.6 若企业微信事件走 HTTP 加密回调，新增 callback 路由并完成签名校验、解密和统一事件转换
- [x] 2.7 为未知事件类型增加入库和安全跳过逻辑

## 3. 回复追踪与反馈 ID

- [x] 3.1 在 Bot 回复处理开始时创建 `bot_response_runs` 草稿记录
- [x] 3.2 在普通回复发送完成后写入最终回答摘要和成功状态
- [x] 3.3 在 progressive/typewriter 流式回复完成后更新同一条回复追踪记录
- [x] 3.4 在 Dify provider 回复完成后记录 Dify conversationId 和回复追踪状态
- [x] 3.5 在保存 session human/ai message 时写入当前 `response_run_id`
- [x] 3.6 在 `executeForceCallMcps` 记录 Wiki 检索日志时写入当前 `response_run_id`
- [x] 3.7 在可支持反馈的回复中生成并发送反馈 ID；不支持时记录不可关联状态
- [x] 3.8 增加通过 feedback ID 查询 response run、session 消息和检索证据的服务方法

## 4. 反馈运营闭环

- [x] 4.1 处理 `feedback_event` 时按 feedback ID 查找回复追踪记录
- [x] 4.2 为已关联反馈创建 `wiki_feedback_items`，保存反馈类型、内容、负反馈原因和默认分流建议
- [x] 4.3 为无法关联的反馈创建可排查状态，保留原始事件和错误原因
- [x] 4.4 实现反馈分流 API：知识缺失、检索问题、模型/工具问题、已忽略和已解决
- [x] 4.5 实现反馈转 Wiki 草稿 API，预填问题、原回答、反馈原因、用户补充内容和检索证据
- [x] 4.6 扩展 Wiki 草稿审核详情，展示 `feedback-event` 来源上下文
- [x] 4.7 草稿合并成功后自动将关联反馈处理项标记为已解决
- [x] 4.8 增加反馈统计 API，返回正负反馈、负反馈率、待处理数量、转草稿数量和原因分布

## 5. Web 控制台体验

- [x] 5.1 在 Wiki 页面新增“反馈”Tab 或反馈收件箱入口
- [x] 5.2 展示反馈列表，支持按状态、原因、namespace、Context 和时间窗口筛选
- [x] 5.3 实现反馈详情抽屉，展示原问题、原回答、反馈内容、负反馈原因和检索证据
- [x] 5.4 在反馈详情中提供转草稿、标记检索问题、标记模型/工具问题和忽略操作
- [x] 5.5 从反馈转草稿后跳转或关联到现有草稿审核详情
- [x] 5.6 在 Wiki 运营看板增加反馈质量指标和负反馈原因分布
- [x] 5.7 为无法关联的反馈提供清晰状态和排查提示

## 6. 标注答案路径

- [x] 6.1 实现标注答案 CRUD API，支持启用、禁用、来源引用和适用范围
- [x] 6.2 支持从准确反馈或已解决负反馈创建标注答案
- [x] 6.3 在 Bot 回复流程中于 Wiki autoSearch 前检查当前 Context/namespace 的启用标注答案
- [x] 6.4 命中标注答案时直接回复或作为高优先级上下文，并记录命中日志
- [x] 6.5 未命中标注答案时保持现有 Wiki 检索和 Agent 回复流程
- [x] 6.6 在 Web 控制台提供标注答案管理和禁用入口

## 7. 测试与验证

- [x] 7.1 为 `WecomAdapter` 增加 `enter_chat`、`template_card_event`、`feedback_event` 和未知事件解析测试
- [x] 7.2 为事件 Repository 增加 `msgid` 排重和重复事件跳过测试
- [x] 7.3 为 Bot 回复追踪增加普通回复、流式回复、Dify 回复和错误状态测试
- [x] 7.4 为 Wiki 检索日志关联 `response_run_id` 增加 BotInstance 单元测试
- [x] 7.5 为反馈转草稿、草稿合并后反馈解决和反馈统计增加 API 流程测试
- [x] 7.6 为标注答案命中和未命中路径增加 BotInstance 测试
- [x] 7.7 运行 `pnpm build`
- [x] 7.8 运行 `pnpm test`
- [x] 7.9 运行 `openspec-cn validate add-wecom-event-feedback-loop --strict`

