## 新增需求

### 需求:机器人配置持久化
系统必须将机器人配置（企业微信凭证、LLM 配置、名称）持久化到 SQLite 数据库，重启后配置不丢失。

#### 场景:创建机器人
- **当** 管理员通过 API POST /api/bots 提交机器人配置
- **那么** 系统将配置写入 bots 表，返回新建机器人的 id 和初始 status=stopped

#### 场景:更新机器人配置
- **当** 管理员通过 API PUT /api/bots/:id 提交更新
- **那么** 系统更新 bots 表对应记录，若机器人正在运行则不自动重启（需手动停止后重启生效）

#### 场景:删除机器人
- **当** 管理员通过 API DELETE /api/bots/:id
- **那么** 系统必须先停止该机器人（若运行中），再级联删除 contexts、bindings、mcp_servers 相关记录

### 需求:机器人生命周期管理
系统必须支持独立启动和停止每个机器人，每个机器人运行时状态相互隔离。

#### 场景:启动机器人
- **当** 管理员通过 API POST /api/bots/:id/start
- **那么** BotManager 从 DB 加载该机器人完整配置，创建 BotInstance，建立企业微信 WebSocket 连接，将 status 更新为 running

#### 场景:启动失败
- **当** 企业微信 WebSocket 连接失败（凭证错误或网络问题）
- **那么** BotInstance 将 status 更新为 error，记录错误信息，不影响其他机器人运行

#### 场景:停止机器人
- **当** 管理员通过 API POST /api/bots/:id/stop
- **那么** BotInstance 关闭 WebSocket 连接，清空该机器人的所有消息队列和内存会话，将 status 更新为 stopped

#### 场景:查询机器人状态
- **当** 管理员通过 API GET /api/bots 或 GET /api/bots/:id
- **那么** 系统返回机器人列表及每个机器人的当前 status（running/stopped/error）

### 需求:MCP 服务器配置
每个机器人必须支持独立配置一个或多个 MCP 服务器，机器人启动时建立独立的 MCP 连接。

#### 场景:配置 MCP 服务器
- **当** 管理员通过 API 为机器人添加 MCP 服务器配置（name、url、transport_type）
- **那么** 配置持久化到 mcp_servers 表，机器人下次启动时使用新配置

#### 场景:MCP 连接失败不阻断启动
- **当** 机器人启动时某个 MCP 服务器连接失败
- **那么** 系统记录错误日志，跳过该 MCP 服务器，继续启动机器人（工具数量减少但机器人可用）
