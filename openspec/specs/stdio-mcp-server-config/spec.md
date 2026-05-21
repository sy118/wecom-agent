# stdio-mcp-server-config 规范

## 目的
待定 - 由归档变更 support-stdio-mcp-servers 创建。归档后请更新目的。
## 需求
### 需求:stdio MCP Server 配置
系统必须支持管理员创建和编辑 stdio 类型 MCP Server 配置，配置内容必须包含启动命令，并可选包含参数数组和环境变量映射。

#### 场景:创建 stdio MCP Server
- **当** 管理员提交 `transportType=stdio`、`command=uvx`、`args=["mcp-atlassian"]` 的 MCP Server 配置
- **那么** 系统必须保存该 MCP Server，并在列表中标记传输类型为 `stdio`

#### 场景:stdio 缺少 command
- **当** 管理员提交 `transportType=stdio` 但未提供非空 `command`
- **那么** API 必须拒绝保存并返回明确的校验错误

#### 场景:stdio args 类型错误
- **当** 管理员提交的 `args` 不是字符串数组
- **那么** API 必须拒绝保存并返回明确的校验错误

#### 场景:stdio env 类型错误
- **当** 管理员提交的 `env` 不是字符串到字符串的映射
- **那么** API 必须拒绝保存并返回明确的校验错误

### 需求:stdio 环境变量解析
系统必须支持在 stdio MCP Server 的 `env` 值中使用 `${VAR_NAME}` 引用 API 进程环境变量，并禁止在日志中输出解析后的敏感值。

#### 场景:解析环境变量引用
- **当** stdio MCP Server 配置包含 `env={"JIRA_PERSONAL_TOKEN":"${JIRA_PERSONAL_TOKEN}"}`
- **并且** API 进程环境变量中存在 `JIRA_PERSONAL_TOKEN`
- **那么** 系统必须在启动 stdio MCP Server 时传入该环境变量的真实值

#### 场景:环境变量缺失
- **当** stdio MCP Server 配置引用 `${MISSING_TOKEN}`
- **并且** API 进程环境变量中不存在 `MISSING_TOKEN`
- **那么** 系统必须记录缺失变量名并跳过该 MCP Server
- **并且** Bot 启动或刷新工具池不得因此失败

#### 场景:普通环境变量值
- **当** stdio MCP Server 配置包含 `env={"JIRA_SSL_VERIFY":"false"}`
- **那么** 系统必须按字面值传入 `JIRA_SSL_VERIFY=false`

### 需求:stdio MCP 工具加载
Bot 工具池构建必须支持通过 stdio transport 连接已启用的 stdio MCP Server，并将加载到的工具纳入现有 MCP 工具池。

#### 场景:加载 stdio MCP tools
- **当** 存在 enabled=true 的 stdio MCP Server 配置
- **并且** 其命令可以成功启动并提供 MCP tools
- **那么** Bot 工具池构建必须连接该 Server 并加载其 tools

#### 场景:stdio MCP 连接失败
- **当** stdio MCP Server 启动失败、连接失败或工具加载失败
- **那么** 系统必须记录错误并跳过该 Server
- **并且** 其他 MCP Server 和 Bot 启动流程必须继续执行

#### 场景:SSE MCP 行为保持兼容
- **当** 存在 enabled=true 的 SSE MCP Server 配置
- **那么** 系统必须继续使用其 `url` 创建 SSE transport 并加载 tools

