# wiki-context-binding

## 目的

定义 Wiki namespace 与 Bot Context 的绑定能力，包括通过 `mcpConfigs.params` 写入 namespace、注入系统提示、在 Context 页面和 namespace 详情页维护绑定关系。

## 需求

### 需求:Context mcpConfigs 支持 namespace 参数
Context 的 `mcpConfigs` 数组中，针对 wiki-mcp-server 的配置项必须支持 `params.namespace` 字段（字符串或字符串数组），用于指定该 Context 绑定的 Wiki namespace。

#### 场景:单 namespace 绑定
- **当** Context 的 mcpConfigs 包含 `{ serverId: "wiki-mcp", params: { namespace: "product" } }`
- **那么** Bot 启动时将 `"当前 Wiki namespace: product，使用 wiki_* 工具时默认查询此 namespace"` 注入到该 Context 的系统提示末尾

#### 场景:多 namespace 绑定
- **当** `params.namespace` 为数组 `["product", "shared"]`
- **那么** 注入 `"当前 Wiki namespaces: product, shared，使用 wiki_* 工具时可查询这些 namespace"`

#### 场景:未配置 namespace
- **当** mcpConfigs 中 wiki-mcp-server 的 params 不含 namespace 字段
- **那么** 不注入 namespace 提示，LLM 可自由使用 wiki_list 探索所有 namespace

---

### 需求:namespace 注入到系统提示
Bot 在构建每次对话的系统提示时，必须将 mcpConfigs 中 wiki-mcp-server 的 namespace params 追加到系统提示。注入位置：系统提示末尾，独立段落。

#### 场景:系统提示注入格式
- **当** Context 绑定了 namespace "hr"
- **那么** 系统提示末尾追加：
  ```
  
  ## Wiki 知识库
  当前绑定的 Wiki namespace: hr
  当你需要查询相关知识时，使用 wiki_read、wiki_search 等工具，默认在 namespace "hr" 中查询。
  ```

#### 场景:forceCall 模式下自动注入 Wiki 内容
- **当** Context 的 mcpConfigs 中 wiki-mcp-server 配置了 `forceCall: true`，且 params 包含 `forceCallPage`（指定页面路径）
- **那么** 每次对话前自动调用 `wiki_read(forceCallPage, namespace)`，将页面内容注入系统提示的"强制检索结果"区域

---

### 需求:Context 配置页面展示 Wiki 绑定状态
Web Console 的 Context 配置页面必须在 MCP Server 配置区域展示 wiki-mcp-server 的 namespace 绑定状态。

#### 场景:展示已绑定 namespace
- **当** Context 已配置 wiki-mcp-server 且 params 含 namespace
- **那么** 在该 MCP Server 配置行显示 namespace 标签（如 `namespace: product`）

#### 场景:namespace 参数编辑
- **当** 用户编辑 wiki-mcp-server 的 params
- **那么** params 编辑框支持输入 namespace 值，保存后生效

### 需求:Namespace 可视化绑定 Context
系统必须支持从 Wiki namespace 详情页直接将知识库绑定到 Bot Context。

#### 场景:查看 namespace 绑定状态
- **当** 管理员进入 namespace 详情页的绑定区域
- **那么** 页面必须展示已经绑定该 namespace 的 Bot 和 Context
- **并且** 展示对应的 MCP Server 名称和检索策略

#### 场景:新增 Context 绑定
- **当** 管理员选择 Bot、Context 和检索策略后提交绑定
- **那么** 系统必须更新该 Context 的 `mcpConfigs`
- **并且** 启用 wiki-mcp
- **并且** 写入当前 namespace 参数

#### 场景:解绑 Context
- **当** 管理员从 namespace 详情页解除某个 Context 绑定
- **那么** 系统必须从该 Context 的 Wiki MCP 配置中移除当前 namespace
- **并且** 如果该 MCP 配置不再包含任何有效 Wiki 参数，可以将其置为未启用

### 需求:Context 页面 Wiki 专用配置
系统必须在 Context 配置页面识别 wiki-mcp，并提供 Wiki 专用配置表单。

#### 场景:配置 Wiki namespace
- **当** 管理员在 Context 页面启用 wiki-mcp
- **那么** 页面必须提供 namespace 选择控件
- **并且** namespace 选项来自 Wiki namespace 列表
- **并且** 保存后必须写入 `mcpConfigs.params.namespace`

#### 场景:保留高级参数
- **当** wiki-mcp 的参数不属于标准 Wiki 专用字段
- **那么** 页面必须保留高级参数编辑入口
- **并且** 不得在保存时丢弃未知参数
