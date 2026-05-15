# 上下文路由 (Context Routing)

## 目的

支持为每个机器人创建多个上下文配置，并通过 chatKey 绑定机制将不同来源的消息路由到对应上下文，实现差异化的系统提示词和项目范围控制。

## 需求

### 需求:上下文配置管理
系统必须支持为每个机器人创建多个上下文配置，每个上下文包含独立的系统提示词、可查项目范围和会话超时时间。

#### 场景:创建上下文
- **当** 管理员通过 API POST /api/bots/:botId/contexts 提交上下文配置
- **那么** 系统将配置写入 contexts 表，关联到指定机器人

#### 场景:设置默认上下文
- **当** 管理员将某个上下文标记为 is_default=true
- **那么** 系统必须保证同一机器人下只有一个默认上下文（新设默认时自动取消旧默认）

#### 场景:无绑定时使用默认上下文
- **当** 收到消息的 chatKey 在 bindings 表中无对应记录
- **那么** 系统必须使用该机器人的默认上下文处理消息；若无默认上下文则拒绝处理并回复提示

### 需求:chatKey 路由绑定
系统必须支持将企业微信群或用户绑定到指定上下文，实现不同来源消息使用不同上下文配置。

#### 场景:创建绑定
- **当** 管理员通过 API POST /api/bots/:botId/bindings 提交 chatKey 和 contextId
- **那么** 系统将绑定关系写入 bindings 表；同一 botId + chatKey 组合必须唯一（重复绑定覆盖旧记录）

#### 场景:消息路由到绑定上下文
- **当** 收到来自 chatKey=`wecom:group:xxx` 的消息，且该 chatKey 已绑定到 contextId=`ctx-001`
- **那么** 系统使用 ctx-001 的系统提示词和 allowed_projects 处理该消息

#### 场景:chatKey 格式规范
- **当** 收到企业微信群消息（body.chatid 存在）
- **那么** chatKey 必须格式化为 `wecom:group:${body.chatid}`

#### 场景:私聊 chatKey 格式
- **当** 收到企业微信私聊消息（body.chatid 不存在，body.from.userid 存在）
- **那么** chatKey 必须格式化为 `wecom:user:${body.from.userid}`

### 需求:项目范围限制
每个上下文必须配置 allowed_projects 列表，Agent 调用 MCP 工具时只能查询列表内的项目。

#### 场景:项目范围注入系统提示词
- **当** Agent 使用某个上下文处理消息
- **那么** 系统必须将 allowed_projects 列表注入到系统提示词的项目范围限制章节，覆盖默认的全局项目列表

#### 场景:空项目范围
- **当** 上下文的 allowed_projects 为空数组
- **那么** 系统必须拒绝创建该上下文，返回验证错误
