# wiki-onboarding-workflow 规范

## 目的
待定 - 由归档变更 improve-wiki-knowledge-workflow 创建。归档后请更新目的。
## 需求
### 需求: Wiki 首次使用向导

系统必须在 Wiki 管理页面提供首次使用向导，帮助管理员完成从空知识库到可被 Bot 使用的最短路径配置。

#### 场景: 系统检测到 Wiki 尚未完成基础配置

- **当** 管理员访问 `/wiki`
- **并且** 系统不存在任何 Wiki namespace，或不存在可用的 wiki-mcp MCP Server，或不存在绑定了 Wiki namespace 的 Context
- **那么** 页面必须展示首次使用向导入口
- **并且** 向导必须说明当前缺失的配置步骤

#### 场景: 向导创建 namespace

- **当** 管理员在向导中填写 namespace 标识符、展示名、目录路径和描述
- **那么** 系统必须调用 namespace 创建 API
- **并且** 创建成功后进入下一步，而不是要求管理员手动返回列表页

#### 场景: 向导注册 wiki-mcp

- **当** 系统未检测到可用的 wiki-mcp MCP Server
- **那么** 向导必须提供注册 MCP Server 的步骤
- **并且** 预填推荐名称、SSE URL 和传输类型
- **并且** 允许管理员跳转到 MCP 服务器页面进行高级配置

#### 场景: 向导绑定 Context

- **当** 管理员选择目标 Bot 和 Context
- **那么** 系统必须在该 Context 的 MCP 配置中启用 wiki-mcp
- **并且** 写入当前 namespace 参数
- **并且** 允许管理员选择 Wiki 检索策略

#### 场景: 向导测试检索

- **当** 管理员完成绑定并输入测试问题
- **那么** 系统必须使用当前 namespace 执行一次测试检索
- **并且** 展示命中的页面、摘要或无结果提示
- **并且** 不得将测试问题发送到真实企业微信群聊

