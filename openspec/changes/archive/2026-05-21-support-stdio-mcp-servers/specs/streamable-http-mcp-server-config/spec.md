## 新增需求

### 需求:Streamable HTTP MCP Server 配置
系统必须支持管理员创建和编辑 Streamable HTTP 类型 MCP Server 配置，配置内容必须包含 MCP HTTP endpoint URL，并可选包含请求 headers 映射。

#### 场景:创建 Streamable HTTP MCP Server
- **当** 管理员提交 `transportType=streamable-http`、`url=http://10.1.250.157:4000/mcp` 的 MCP Server 配置
- **那么** 系统必须保存该 MCP Server，并在列表中标记传输类型为 `streamable-http`

#### 场景:Streamable HTTP 缺少 URL
- **当** 管理员提交 `transportType=streamable-http` 但未提供非空 `url`
- **那么** API 必须拒绝保存并返回明确的校验错误

#### 场景:Streamable HTTP headers 类型错误
- **当** 管理员提交的 `headers` 不是字符串到字符串的映射
- **那么** API 必须拒绝保存并返回明确的校验错误

### 需求:Streamable HTTP headers 变量解析
系统必须支持在 Streamable HTTP MCP Server 的 `headers` 值中使用 `${VAR_NAME}` 引用 API 进程环境变量，并禁止在日志或列表摘要中输出解析后的敏感值。

#### 场景:解析 Authorization header 引用
- **当** Streamable HTTP MCP Server 配置包含 `headers={"Authorization":"Bearer ${YUQUE_MCP_TOKEN}"}`
- **并且** API 进程环境变量中存在 `YUQUE_MCP_TOKEN`
- **那么** 系统必须在连接该 MCP Server 时传入解析后的 Authorization header

#### 场景:headers 环境变量缺失
- **当** Streamable HTTP MCP Server 配置引用 `${MISSING_TOKEN}`
- **并且** API 进程环境变量中不存在 `MISSING_TOKEN`
- **那么** 系统必须记录缺失变量名并跳过该 MCP Server
- **并且** Bot 启动或刷新工具池不得因此失败

#### 场景:普通 header 值
- **当** Streamable HTTP MCP Server 配置包含 `headers={"X-Client":"wecom-agent"}`
- **那么** 系统必须按字面值传入该 header

### 需求:Streamable HTTP MCP 工具加载
Bot 工具池构建必须支持通过 Streamable HTTP transport 连接已启用的 `/mcp` endpoint，并将加载到的工具纳入现有 MCP 工具池。

#### 场景:加载 Streamable HTTP MCP tools
- **当** 存在 enabled=true 的 Streamable HTTP MCP Server 配置
- **并且** 其 `/mcp` endpoint 可以成功提供 MCP tools
- **那么** Bot 工具池构建必须连接该 Server 并加载其 tools

#### 场景:Streamable HTTP MCP 返回非成功状态
- **当** Streamable HTTP MCP Server 返回非 2xx 状态码或连接失败
- **那么** 系统必须记录错误并跳过该 Server
- **并且** 其他 MCP Server 和 Bot 启动流程必须继续执行

#### 场景:Streamable HTTP 与 SSE 区分
- **当** 管理员配置 `transportType=streamable-http` 且 URL 以 `/mcp` 结尾
- **那么** 系统必须使用 Streamable HTTP transport 连接
- **并且** 禁止使用 SSE EventSource transport 连接该 URL

## 修改需求

## 移除需求
