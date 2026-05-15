## 新增需求

### 需求:MCP Server 必须支持参数模式声明

MCP Server 配置必须支持可选的 `paramSchema` 字段，用于声明该 Server 在 Context 中使用时所需的参数结构。`paramSchema` 为数组，每项包含 `key`（参数键名）、`label`（显示名称）、`type`（`string` | `string[]` | `number` | `boolean`）、`description`（说明文字）。

#### 场景:创建 MCP Server 时可填写 paramSchema

- **当** 管理员在 MCP Server 管理页面创建或编辑 Server 时
- **那么** 页面必须提供 paramSchema 配置区域，允许添加多个参数声明条目

#### 场景:paramSchema 为空时不影响 MCP Server 正常使用

- **当** MCP Server 的 paramSchema 为空或 null
- **那么** 系统必须正常加载该 Server，Context 配置页面不渲染任何参数表单

### 需求:Context 配置必须根据 paramSchema 动态渲染参数表单

当 Context 配置页面展示某个 MCP Server 的配置时，必须根据该 Server 的 `paramSchema` 动态渲染对应的输入控件，替换原有硬编码的"可查项目"字段。

#### 场景:string[] 类型参数渲染为标签选择器

- **当** paramSchema 中某参数的 type 为 `string[]`
- **那么** 必须渲染 Select tags 控件，允许用户输入多个字符串值

#### 场景:string 类型参数渲染为文本输入框

- **当** paramSchema 中某参数的 type 为 `string`
- **那么** 必须渲染 Input 文本输入框

#### 场景:number 类型参数渲染为数字输入框

- **当** paramSchema 中某参数的 type 为 `number`
- **那么** 必须渲染 InputNumber 控件

#### 场景:boolean 类型参数渲染为开关

- **当** paramSchema 中某参数的 type 为 `boolean`
- **那么** 必须渲染 Switch 开关控件

#### 场景:未知 type 降级为文本输入

- **当** paramSchema 中某参数的 type 不在已知类型列表中
- **那么** 必须降级渲染为普通 Input 文本输入框

### 需求:McpConfig params 必须为通用键值结构

McpConfig 中的 `params` 字段必须为 `Record<string, any>` 通用结构，禁止在类型定义中硬编码特定字段名（如 `allowedProjects`）。

#### 场景:保存 Context 时 params 以通用结构存储

- **当** 管理员保存 Context 配置时
- **那么** 系统必须将各 MCP Server 的参数以 `{ [key]: value }` 格式存入 McpConfig.params

## 修改需求

### 需求:allowedProjects 注入逻辑保持兼容

`injectAllowedProjects` 函数必须继续从 `cfg.params.allowedProjects` 读取项目列表，数据结构不变。

#### 场景:params.allowedProjects 存在时注入 system prompt

- **当** McpConfig.params.allowedProjects 为非空数组
- **那么** 系统必须将项目列表注入 system prompt 的"项目范围限制"章节
