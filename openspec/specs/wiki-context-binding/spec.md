# wiki-context-binding

Wiki Context 绑定能力，通过 mcpConfigs.params 将 Wiki namespace 与 Bot Context 关联，并将 namespace 信息注入系统提示，使 LLM 能够感知当前知识库范围。

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
