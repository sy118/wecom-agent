## 目的

定义管理控制台中 MCP 服务器管理页面和上下文表单 MCP 能力配置区块的交互规范，确保管理员可以维护服务器配置、启用上下文能力并配置参数。
## 需求
### 需求:MCP 服务器管理页面
管理控制台必须提供独立的 MCP 服务器管理页面，支持查看、新建、编辑、删除全局 MCP 服务器配置。页面路由必须为 `/mcp-servers`，禁止依赖 botId URL 参数。页面必须支持按传输类型维护 SSE、stdio 和 Streamable HTTP MCP Server 的配置字段。

#### 场景:访问全局 MCP 服务器列表
- **当** 用户导航到 `/mcp-servers`
- **那么** 页面必须显示系统中所有 MCP 服务器的列表，不限于特定 Bot

#### 场景:添加新 MCP 服务器
- **当** 用户在 MCP 服务器页面点击"添加"
- **那么** 表单中禁止出现 Bot 选择字段，新建的 MCP 服务器属于全局资源

#### 场景:旧路由访问被废弃
- **当** 用户访问 `/bots/:botId/mcp-servers`
- **那么** 该路由禁止存在，应返回 404 或重定向到 `/mcp-servers`

#### 场景:MCP 服务器列表展示
- **当** 管理员访问 MCP 服务器管理页
- **那么** 界面必须展示：名称、连接配置摘要、传输类型、启用状态

#### 场景:新建 SSE MCP 服务器
- **当** 管理员填写名称、URL、传输类型 `sse` 并提交
- **那么** 系统创建 SSE MCP 服务器配置，列表刷新显示新条目

#### 场景:新建 stdio MCP 服务器
- **当** 管理员填写名称、command、可选 args、可选 env、传输类型 `stdio` 并提交
- **那么** 系统创建 stdio MCP 服务器配置，列表刷新显示新条目

#### 场景:新建 Streamable HTTP MCP 服务器
- **当** 管理员填写名称、URL、可选 headers、传输类型 `streamable-http` 并提交
- **那么** 系统创建 Streamable HTTP MCP 服务器配置，列表刷新显示新条目

#### 场景:删除 MCP 服务器
- **当** 管理员确认删除某 MCP 服务器
- **那么** 系统删除该配置；若有上下文的 mcp_configs 引用了该 mcpServerId，对应条目自动失效（不报错，下次 invoke 时工具池中无该服务器则跳过）

### 需求:上下文表单 MCP 能力配置区块
上下文创建/编辑表单必须包含 MCP 能力配置区块，动态展示全局已注册的 MCP 服务器，支持逐个启用并配置参数。

#### 场景:展示全局 MCP 服务器列表
- **当** 管理员打开上下文创建/编辑表单
- **那么** MCP 能力配置区块必须从全局 MCP API 加载所有 MCP 服务器列表，每个服务器显示为一个可开关的配置项

#### 场景:启用 gitnexus 并配置 allowedProjects
- **当** 管理员开启 gitnexus 开关
- **那么** 界面必须展开显示「可查项目」输入区，供管理员配置可查询的项目范围

#### 场景:禁用某 MCP 服务器
- **当** 管理员关闭某 MCP 服务器的开关
- **那么** 该服务器的 enabled 设为 false，保存后该上下文 invoke 时不使用该工具

#### 场景:无全局 MCP 服务器时的提示
- **当** 系统未配置任何全局 MCP 服务器
- **那么** MCP 能力配置区块显示提示「尚未配置全局 MCP 服务器，请先在左侧「MCP 服务器」菜单中添加」

### 需求:MCP 服务器管理页面区分传输类型配置
管理控制台 MCP 服务器管理页面必须根据传输类型展示对应配置字段：SSE 使用 `/sse` URL，stdio 使用 command、args 和 env，Streamable HTTP 使用 `/mcp` URL 和 headers。

#### 场景:SSE 表单展示 URL
- **当** 管理员在 MCP 服务器表单中选择 `SSE`
- **那么** 表单必须展示 URL 输入项并要求填写
- **并且** 表单不得要求填写 command

#### 场景:stdio 表单展示命令配置
- **当** 管理员在 MCP 服务器表单中选择 `stdio`
- **那么** 表单必须展示 command 输入项、args 配置项和 env 配置项
- **并且** 表单不得要求填写 URL

#### 场景:stdio 表单提供示例
- **当** 管理员选择 `stdio`
- **那么** 页面必须提供类似 `command=uvx`、`args=["mcp-atlassian"]`、`env={"JIRA_PERSONAL_TOKEN":"${JIRA_PERSONAL_TOKEN}"}` 的配置提示

#### 场景:Streamable HTTP 表单展示 HTTP 配置
- **当** 管理员在 MCP 服务器表单中选择 `streamable-http`
- **那么** 表单必须展示 URL 输入项和 headers 配置项
- **并且** URL 提示必须说明该地址通常以 `/mcp` 结尾

#### 场景:Streamable HTTP 表单提供示例
- **当** 管理员选择 `streamable-http`
- **那么** 页面必须提供类似 `url=http://10.1.250.157:4000/mcp`、`headers={"Authorization":"Bearer ${YUQUE_MCP_TOKEN}"}` 的配置提示

#### 场景:列表展示 stdio 配置摘要
- **当** MCP 服务器列表包含 stdio Server
- **那么** 列表必须展示传输类型为 `stdio`
- **并且** 必须展示 command 摘要而不是空 URL

#### 场景:列表展示 Streamable HTTP 配置摘要
- **当** MCP 服务器列表包含 Streamable HTTP Server
- **那么** 列表必须展示传输类型为 `streamable-http`
- **并且** 必须展示 URL 摘要但不得展示完整 headers

