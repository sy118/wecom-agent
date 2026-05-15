## 上下文

当前平台主路径是 pnpm monorepo：`apps/api` 负责 API、数据库和 Bot 运行时，`apps/web` 负责管理控制台，`packages/core` 承载 AgentEngine、MCP client、WeComAdapter、DifyClient 等共享运行逻辑，`packages/types` 承载跨包类型。

MCP 是全局工具服务资产，Context 级通过 `mcpConfigs` 启用和配置参数，BotInstance 启动时构建全局 MCP `toolPool`，每次消息处理时按 Context 过滤 tools 并传给 AgentEngine。Skill 也采用同样的产品模型：全局安装、Context 级启用。Skill 的真实形态是一个文件夹能力包：`SKILL.md` 是入口说明，`scripts/`、`references/`、`assets/` 是可选资源。

## 目标 / 非目标

**目标：**

- 清理旧版单 Bot 入口、重复模块和未使用依赖，让仓库只保留当前平台主路径。
- 支持管理员上传包含 `SKILL.md` 的 Skill 文件夹，并安装为全局 Skill。
- 从 `SKILL.md` frontmatter 解析 `name` 和 `description`，将其作为触发和展示元数据。
- 支持 Context 级启用 Skill，并允许配置参数和 `forceUse`。
- 运行时先注入可用 Skill 元数据；仅在显式 `$skill-name` 或 `forceUse` 时加载完整 `SKILL.md`。
- 支持通过通用 `run_skill_script` 工具执行 bundle 内脚本，并提供默认关闭、超时、输出限制、并发限制、环境白名单、路径限制和审计。
- 管理控制台提供全局 Skill 文件夹上传、`SKILL.md` 预览、资源索引、启停、删除、Context 引用和审计查看。

**非目标：**

- 第一版不做远程 Skill marketplace、签名验证、自动升级和版本依赖解析。
- 第一版不做 zip 解压上传；优先支持浏览器文件夹上传。后续可在相同 bundle 校验器上增加 zip 输入。
- 不支持任意 shell 命令字符串执行；脚本只能从已安装 Skill bundle 内按受控 runtime 执行。
- 不把 Skill 伪装成 MCP Server。MCP 仍负责外部工具服务连接，Skill 负责本地能力包和可读资源。
- 不对 Dify provider 注入本地 Skill tools。Dify provider 仍由 Dify 工作流内部处理工具和知识。

## 决策

### 1. Skill 是文件夹 bundle，而不是数据库 manifest

Skill 目录结构：

```text
skill-name/
  SKILL.md
  agents/openai.yaml
  scripts/
  references/
  assets/
```

`SKILL.md` 必填，并且 frontmatter 必须包含：

```yaml
---
name: my-skill
description: When to use this skill and what it provides.
---
```

数据库只保存安装结果：名称、描述、bundle 路径、bundle hash、资源索引、权限策略和启用状态。管理员不能在 UI 中手填脚本入口来创建 Skill；入口来自上传的目录。

### 2. 渐进式加载

运行时分三层：

1. Metadata：所有 Context 启用的 Skill 的 `name`、`description` 总是可以进入本次 system prompt。
2. `SKILL.md`：当用户消息包含 `$skill-name`、包含 Skill 名称，或 Context 配置 `forceUse=true` 时加载。
3. Resources：`SKILL.md` 可以说明何时读取 `references/` 或使用 `assets/`；第一版由模型根据注入说明决定是否调用通用脚本工具。

这样既保留 Skill 的“可发现”能力，也避免每次消息都把所有 Skill 全量说明塞进 prompt。

### 3. 通用脚本工具

不再为每个脚本 Skill 生成单独 tool。只要当前 Context 启用了至少一个包含 `scripts/` 的 Skill，平台就向 AgentEngine 注入一个 `run_skill_script` StructuredTool。

工具输入：

```json
{
  "skillName": "my-skill",
  "scriptPath": "scripts/do_work.js",
  "args": ["--flag"],
  "stdin": "{\"query\":\"...\"}"
}
```

执行规则：

- `skillName` 必须匹配当前 Context 启用的 Skill。
- `scriptPath` 必须解析在该 Skill bundle 目录内，并建议位于 `scripts/` 下。
- runtime 根据扩展名选择：`.js/.mjs/.cjs` 使用 Node，`.py` 使用 Python。
- 使用 `spawn` 且 `shell=false`，不拼接 shell 字符串。
- 环境变量只注入基础运行变量和 `allowedEnvKeys` 白名单。
- 应用 `timeoutMs`、`maxOutputBytes`、`maxConcurrentRuns`。
- 每次执行写入审计日志，摘要脱敏并截断。

### 4. 数据模型

`skills` 表保留历史兼容列，但新模型使用：

- `id`
- `bot_id`（兼容历史数据；全局 Skill 可为空）
- `name`
- `description`
- `enabled`
- `bundle_path`
- `bundle_hash`
- `metadata_json`
- `resource_index_json`
- `permission_policy`
- `created_at`
- `updated_at`

`contexts.skill_configs`：

```json
[
  {
    "skillId": "skill-id",
    "enabled": true,
    "params": {},
    "forceUse": false
  }
]
```

`skill_audit_logs` 保留，用于记录 `run_skill_script` 的 success/error/timeout/blocked。

### 5. 上传和校验

Web 使用文件夹上传控件发送 multipart `files[]`。服务端校验：

- 必须存在顶层 `SKILL.md`。
- 文件路径必须是相对路径，不能包含 `..`、绝对路径、空路径或 Windows drive prefix。
- 限制文件数量、总大小和单文件大小。
- `name` 必须为小写字母、数字和短横线，长度小于 64。
- `description` 必须非空。
- 生成资源索引：scripts、references、assets、其他文件、总大小、总文件数。
- 安装到 `data/skills/global/{skillId}/current`。

### 6. 回滚策略

关闭 Skill 全局脚本开关后，bundle Skill 仍可作为提示说明存在，但不能执行脚本。删除或禁用 Skill 不影响 MCP 主路径。新增 DB 列和表不影响旧 Context。

## 风险 / 权衡

- 上传文件夹会带来路径和存储风险 -> 严格路径校验、大小限制、安装目录隔离。
- 脚本执行有安全风险 -> 默认关闭、非 shell 执行、bundle 内路径限制、超时/输出/并发限制和审计。
- 只支持文件夹上传会限制某些部署环境 -> 第一版先落地核心模型，zip 上传可复用相同校验器后续补齐。
- 运行时按显式触发加载 `SKILL.md` 可能漏用 Skill -> Context 提供 `forceUse` 作为确定性兜底，同时 system prompt 总是列出可用 Skill 元数据。
- 模型可能不会主动读取 reference 文件 -> 第一版先以 `SKILL.md` 注入和通用脚本工具为主，后续可增加受控 read-skill-resource 工具。

## Migration Plan

1. 保留已完成的代码清理结果。
2. 将 Skill 类型、DB、API 从 prompt/script manifest 模型迁移到 bundle 模型。
3. 新增 Skill bundle 上传、校验、安装和 `SKILL.md` 预览。
4. 将 BotInstance Skill 集成改为 metadata + triggered `SKILL.md` 注入和通用脚本工具。
5. 将管理端 Skill 页面改为文件夹上传和资源索引展示。
6. 更新 Context 页面配置字段为 `forceUse`，不再展示 Skill 类型和脚本入口配置。
7. 补充 bundle 校验、API、运行时脚本工具和 BotInstance 注入测试。
8. 运行 `pnpm build`、`pnpm test` 和 `openspec-cn validate add-skill-system-and-cleanup --strict`。
