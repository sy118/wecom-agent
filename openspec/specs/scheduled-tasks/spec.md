# 定时任务 (Scheduled Tasks)

## 目的

支持 Bot 主动定时推送消息，通过 Cron 表达式触发 LLM 生成内容并发送到指定企业微信群或用户，实现从被动响应到主动播报的能力扩展。

## 需求

### 需求:定时任务 CRUD 管理
系统必须支持对定时任务的增删改查操作。

#### 场景:创建定时任务
- **当** 管理员通过 API POST `/api/scheduled-tasks` 提交任务配置
- **那么** 系统必须将任务持久化到 `scheduled_tasks` 表，并在任务 `enabled` 为 true 时立即注册 cron job

#### 场景:更新定时任务
- **当** 管理员通过 API PUT `/api/scheduled-tasks/:id` 更新任务
- **那么** 系统必须更新 DB 记录，取消旧 cron job，若 `enabled` 为 true 则重新注册新 cron job

#### 场景:删除定时任务
- **当** 管理员通过 API DELETE `/api/scheduled-tasks/:id`
- **那么** 系统必须删除 DB 记录并取消对应 cron job

#### 场景:列出定时任务
- **当** 管理员通过 API GET `/api/scheduled-tasks`
- **那么** 系统必须返回所有任务，包含 `last_run_at`、`next_run_at` 字段

### 需求:定时任务按 Cron 表达式触发
系统必须按照任务配置的 `cronExpr`（标准 5 字段 cron 表达式）定时触发任务执行。

#### 场景:任务按时触发
- **当** cron 表达式匹配当前时间且任务 `enabled` 为 true 且对应 Bot 处于运行状态
- **那么** 系统必须执行任务：解析 `contextId`（为空则取 Bot defaultContext），用 `promptTemplate` + systemPrompt 调用 Bot 的 LLM（或 Dify），将结果 sendMessage 到 `targetChatId`（企业微信原始 chatId）

#### 场景:Bot 未运行时跳过任务
- **当** cron 触发时对应 Bot 处于 stopped 或 error 状态
- **那么** 系统必须跳过本次执行，记录跳过原因，禁止抛出未捕获异常

#### 场景:任务执行后更新 last_run_at 和 next_run_at
- **当** 定时任务执行完成（无论成功或失败）
- **那么** 系统必须更新 `last_run_at` 为当前时间，并用 `cron-parser` 计算下次执行时间写入 `next_run_at`

#### 场景:任务执行失败不影响其他任务
- **当** 某个定时任务执行过程中抛出异常
- **那么** 系统必须捕获异常并记录错误日志，禁止影响其他定时任务或 Bot 的正常运行

### 需求:服务重启后恢复定时任务
系统启动时必须从 DB 加载所有 `enabled` 为 true 的定时任务并重新注册 cron job。

#### 场景:启动时恢复任务
- **当** API 服务启动完成
- **那么** 系统必须查询所有 `enabled=true` 的 `scheduled_tasks` 记录，为每条记录注册对应的 cron job

### 需求:定时任务页面为全局视图并支持目标机器人
定时任务管理页面必须展示所有全局定时任务，禁止依赖 botId URL 参数。页面路由必须为 `/scheduled-tasks`。新建和编辑定时任务的表单必须包含"目标机器人"字段。

#### 场景:访问全局定时任务列表
- **当** 用户导航到 `/scheduled-tasks`
- **那么** 页面必须显示系统中所有定时任务的列表，并在列表中显示每个任务的目标机器人名称

#### 场景:新建定时任务时选择目标机器人
- **当** 用户在定时任务页面点击"新建任务"
- **那么** 表单必须包含"目标机器人"下拉选择字段，选项来自系统中所有 Bot，并包含"全部机器人"选项

#### 场景:定时任务目标为全部机器人
- **当** 用户创建定时任务时选择"全部机器人"
- **那么** 该任务的 botId 字段必须存储为 null，列表中显示"全部"

#### 场景:定时任务目标为指定机器人
- **当** 用户创建定时任务时选择某个具体 Bot
- **那么** 该任务的 botId 字段必须存储对应 Bot 的 ID，列表中显示该 Bot 的名称

#### 场景:旧路由访问被废弃
- **当** 用户访问 `/bots/:botId/scheduled-tasks`
- **那么** 该路由禁止存在，应返回 404 或重定向到 `/scheduled-tasks`

### 需求:前端提供可视化 Cron 编辑器
前端定时任务表单必须提供可视化 Cron 表达式编辑器，用户无需手写 cron 字符串。

#### 场景:可视化编辑 cron 表达式
- **当** 用户在定时任务表单中配置执行时间
- **那么** 前端必须提供分钟/小时/日/月/星期的下拉选择，实时预览下次执行时间，并将选择结果转换为标准 cron 表达式存储

### 需求:定时任务必须存储 targetChatId 和可选 contextId
`scheduled_tasks` 表必须同时存储 `targetChatKey`（内部路由键）和 `targetChatId`（企业微信原始 chatId），以及可选的 `contextId`。

#### 场景:targetChatId 用于 sendMessage
- **当** 定时任务触发并需要发送消息
- **那么** 系统必须使用 `targetChatId` 调用 `sendMessage`，禁止使用 `targetChatKey` 作为 sendMessage 参数

#### 场景:contextId 为空时使用 defaultContext
- **当** 定时任务的 `contextId` 为空
- **那么** 系统必须使用该 Bot 的 defaultContext 作为 systemPrompt 来源
