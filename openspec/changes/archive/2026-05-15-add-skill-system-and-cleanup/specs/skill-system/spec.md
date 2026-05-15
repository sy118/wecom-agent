## 新增需求

### 需求:Skill bundle 安装

系统必须支持管理员安装全局 Skill bundle。Skill bundle 是一个文件夹，顶层必须包含 `SKILL.md`，并可选包含 `scripts/`、`references/`、`assets/`。

#### 场景:上传有效 Skill 文件夹

- **当** 管理员上传一个包含顶层 `SKILL.md` 的文件夹
- **并且** `SKILL.md` frontmatter 包含有效 `name` 和 `description`
- **那么** 系统必须将文件夹安装到受控存储目录
- **并且** 系统必须持久化 Skill 名称、描述、bundle 路径、bundle hash、资源索引和启用状态

#### 场景:缺少 SKILL.md

- **当** 管理员上传的文件夹不包含顶层 `SKILL.md`
- **那么** API 必须返回 400 错误
- **并且** 不得创建 Skill 记录或写入部分 bundle

#### 场景:无效 frontmatter

- **当** `SKILL.md` 缺少 `name` 或 `description`
- **或** `name` 不满足小写字母、数字、短横线命名规则
- **那么** API 必须返回 400 错误并说明校验失败原因

#### 场景:路径穿越

- **当** 上传文件路径包含绝对路径、`..`、空路径或 Windows drive prefix
- **那么** API 必须拒绝上传
- **并且** 不得写入该文件

### 需求:Context 级 Skill 启用

系统必须支持在 Context 中配置 `skillConfigs`。每个配置项必须包含 `skillId`、`enabled`、`params`，并可选包含 `forceUse`。

#### 场景:启用全局 Skill

- **当** 管理员在 Context 表单中启用某个全局 Skill
- **那么** 系统必须将配置序列化保存到 `contexts.skill_configs`
- **并且** 读取 Context 时必须反序列化为 `skillConfigs`

#### 场景:引用不存在的 Skill

- **当** 提交的 `skillConfigs` 包含不存在的 `skillId`
- **那么** API 必须返回 400 错误，并说明无效的 `skillId`

#### 场景:Context 未启用 Skill

- **当** Context 的 `skillConfigs` 为空或所有配置项 `enabled=false`
- **那么** 消息处理时不得加载任何 Skill 指令或 Skill 脚本工具

### 需求:运行时 Skill 指令加载

系统必须在非 Dify provider 的消息处理过程中，根据 Context 启用的 Skill 生成本次 system prompt 的 Skill 指令部分。

#### 场景:注入可用 Skill 元数据

- **当** Context 启用了一个或多个 Skill
- **那么** 系统必须向本次 system prompt 注入每个 Skill 的名称和描述
- **并且** 注入内容必须提示用户可通过 `$skill-name` 显式使用 Skill

#### 场景:显式触发 Skill

- **当** 用户消息包含 `$skill-name`
- **那么** 系统必须读取该 Skill bundle 中的 `SKILL.md`
- **并且** 将 `SKILL.md` 正文追加到本次 system prompt

#### 场景:强制使用 Skill

- **当** Context 中某个 Skill 配置 `forceUse=true`
- **那么** 系统必须读取该 Skill bundle 中的 `SKILL.md`
- **并且** 即使用户未显式提及也必须将其追加到本次 system prompt

#### 场景:Dify provider 跳过 Skill

- **当** Bot provider 为 `dify`
- **那么** 系统必须忽略 `skillConfigs` 的运行时加载
- **并且** 直接走 Dify API 调用流程

### 需求:通用脚本执行工具

系统必须为启用了脚本执行权限的 Skill bundle 提供通用 `run_skill_script` 工具，用于受控执行 bundle 内脚本。

#### 场景:执行 bundle 内脚本

- **当** Agent 调用 `run_skill_script`，且 `skillName` 属于当前 Context 启用的 Skill
- **并且** `scriptPath` 位于该 Skill bundle 目录内
- **并且** 全局脚本开关和 Skill 权限策略均允许脚本执行
- **那么** 系统必须使用非 shell API 执行脚本
- **并且** 将 stdout/stderr 摘要返回给 Agent

#### 场景:脚本全局开关关闭

- **当** `SKILL_SCRIPTS_ENABLED` 未设置为 `true`
- **那么** 系统不得执行任何 bundle 脚本
- **并且** 必须返回 blocked 结果并写入审计记录

#### 场景:脚本路径越界

- **当** `scriptPath` 解析后不在 Skill bundle 目录内
- **那么** 系统必须拒绝执行
- **并且** 必须写入 blocked 审计记录

#### 场景:脚本超时

- **当** 脚本执行时间超过权限策略中的 `timeoutMs`
- **那么** 系统必须终止该次执行
- **并且** 写入 `timeout` 审计记录

#### 场景:输出超过限制

- **当** 脚本输出超过 `maxOutputBytes`
- **那么** 系统必须截断输出
- **并且** 不得向 Agent 返回超过限制的完整内容

### 需求:Skill 审计

系统必须为每次通用脚本工具调用写入审计记录。

#### 场景:执行成功写入审计

- **当** `run_skill_script` 成功执行
- **那么** 系统必须写入 status 为 `success` 的审计记录

#### 场景:执行失败写入审计

- **当** 脚本执行失败、超时或被权限策略阻止
- **那么** 系统必须写入 status 为 `error`、`timeout` 或 `blocked` 的审计记录

#### 场景:审计不得泄露密钥

- **当** 脚本输入、参数、输出或错误包含敏感字段或敏感值
- **那么** 审计记录必须脱敏并截断摘要

## 修改需求

### 需求:移除 manifest 型 Skill 语义

系统必须移除 manifest 型 Skill 创建语义，不得要求管理员在 UI 中手填 `type=prompt/script`、`manifest.prompt` 或 `manifest.script.entry` 来创建 Skill。

#### 场景:Skill 来源

- **当** 创建 Skill
- **那么** Skill 的名称、描述和资源来源必须来自上传 bundle 的 `SKILL.md` 与文件树
- **并且** API 不得依赖手写 manifest 来确定脚本入口

## 移除需求
