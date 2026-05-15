## 新增需求

### 需求: Namespace 可视化绑定 Context

系统必须支持从 Wiki namespace 详情页直接将知识库绑定到 Bot Context。

#### 场景: 查看 namespace 绑定状态

- **当** 管理员进入 namespace 详情页的绑定区域
- **那么** 页面必须展示已经绑定该 namespace 的 Bot 和 Context
- **并且** 展示对应的 MCP Server 名称和检索策略

#### 场景: 新增 Context 绑定

- **当** 管理员选择 Bot、Context 和检索策略后提交绑定
- **那么** 系统必须更新该 Context 的 `mcpConfigs`
- **并且** 启用 wiki-mcp
- **并且** 写入当前 namespace 参数

#### 场景: 解绑 Context

- **当** 管理员从 namespace 详情页解除某个 Context 绑定
- **那么** 系统必须从该 Context 的 Wiki MCP 配置中移除当前 namespace
- **并且** 如果该 MCP 配置不再包含任何有效 Wiki 参数，可以将其置为未启用

### 需求: Context 页面 Wiki 专用配置

系统必须在 Context 配置页面识别 wiki-mcp，并提供 Wiki 专用配置表单。

#### 场景: 配置 Wiki namespace

- **当** 管理员在 Context 页面启用 wiki-mcp
- **那么** 页面必须提供 namespace 选择控件
- **并且** namespace 选项来自 Wiki namespace 列表
- **并且** 保存后必须写入 `mcpConfigs.params.namespace`

#### 场景: 保留高级参数

- **当** wiki-mcp 的参数不属于标准 Wiki 专用字段
- **那么** 页面必须保留高级参数编辑入口
- **并且** 不得在保存时丢弃未知参数
