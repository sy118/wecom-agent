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

### 需求:上下文配置中 MCP 和 Skill 绑定从全局资源池选择
上下文配置 Modal 中的 MCP 能力区域和 Skill 区域必须从全局 MCP/Skill 列表中加载可选项，禁止从 Bot 私有列表加载；Context 必须使用 `mcp_configs` 存储每个 MCP Server 的启用状态和专属参数。

#### 场景:上下文配置加载全局 MCP 列表
- **当** 用户打开某个 Bot 的上下文配置 Modal
- **那么** MCP 能力区域必须显示系统中所有全局 MCP 服务器作为可选项

#### 场景:上下文配置加载全局 Skill 列表
- **当** 用户打开某个 Bot 的上下文配置 Modal
- **那么** Skill 区域必须显示系统中所有全局 Skills 作为可选项

#### 场景:为上下文启用某个全局 MCP
- **当** 用户在上下文配置中开启某个 MCP 服务器的开关并保存
- **那么** 该 Bot 的上下文必须记录与该全局 MCP 的绑定关系及配置参数

#### 场景:为上下文启用某个全局 Skill
- **当** 用户在上下文配置中开启某个 Skill 的开关并保存
- **那么** 该 Bot 的上下文必须记录与该全局 Skill 的绑定关系及配置参数

#### 场景:创建上下文时写入 mcp_configs
- **当** 管理员通过 API 创建上下文，提交包含 `mcpConfigs` 数组的请求体
- **那么** 系统必须将 `mcpConfigs` 序列化为 JSON 存入 `mcp_configs` 列

#### 场景:读取上下文时反序列化 mcp_configs
- **当** API 返回上下文数据
- **那么** `mcp_configs` 必须被反序列化为 `McpConfig[]` 数组返回给客户端

#### 场景:旧数据迁移
- **当** 数据库初始化时检测到 contexts 表存在 `allowed_projects` 列但不存在 `mcp_configs` 列
- **那么** 系统必须执行迁移：为每条 context 记录，将 `allowed_projects` 的值转换为对应 gitnexus MCP 的 `params.allowedProjects`，写入 `mcp_configs`

#### 场景:引用不存在的 mcpServerId
- **当** `mcp_configs` 中包含不存在的 `mcpServerId`
- **那么** 系统必须返回 400 错误，说明无效的 `mcpServerId`

### 需求:项目范围限制
上下文的项目范围必须通过 MCP 配置参数表达；gitnexus 的可查项目范围必须从 `mcp_configs` 中对应条目的 `params.allowedProjects` 读取。

#### 场景:项目范围注入系统提示词
- **当** gitnexus 的 `params.allowedProjects` 为非空数组
- **那么** 系统必须将项目列表注入 system prompt 的项目范围限制章节，覆盖默认值

#### 场景:allowedProjects 为空时不限制项目
- **当** gitnexus 的 `params.allowedProjects` 为空数组
- **那么** 系统不注入项目范围限制，AI 可查询所有项目

### 需求:编辑 chatKey 路由绑定
系统必须允许管理员编辑已有普通 chatKey 路由绑定的可变字段，并禁止通过编辑操作修改绑定的 `chatKey`。

#### 场景:编辑绑定上下文
- **当** 管理员编辑某个绑定并提交新的 `contextId`
- **那么** 系统必须将该绑定路由到新的上下文，并保持原 `chatKey` 不变

#### 场景:编辑绑定展示信息
- **当** 管理员编辑某个绑定并提交新的 `chatName` 或 `chatType`
- **那么** 系统必须更新该绑定的展示信息，并保持原 `chatKey` 不变

#### 场景:禁止修改 chatKey
- **当** 管理员编辑绑定时请求修改 `chatKey`
- **那么** 系统必须拒绝修改 `chatKey`，或忽略该字段并保持原 `chatKey` 不变

#### 场景:运行中 Bot 同步绑定编辑
- **当** 绑定编辑成功且对应 Bot 正在运行
- **那么** 系统必须同步更新运行中 Bot 的绑定映射，使后续来自原 `chatKey` 的消息使用编辑后的绑定配置

