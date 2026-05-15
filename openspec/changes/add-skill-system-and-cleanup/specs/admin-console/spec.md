## 新增需求

### 需求:Skill 管理页面
管理控制台必须提供 Bot 级 Skill 管理页面，支持查看、新建、编辑、启用、禁用和删除 Skill。

#### 场景:进入 Skill 管理
- **当** 管理员在 Bot 列表中点击某个 Bot 的 Skill 管理入口
- **那么** 页面必须跳转到该 Bot 的 Skill 管理页面，并展示该 Bot 的 Skill 列表

#### 场景:创建 Skill
- **当** 管理员填写 Skill 名称、描述、类型、参数 schema、manifest 和权限策略并提交
- **那么** 系统必须创建 Skill，并刷新列表显示新记录

#### 场景:编辑 Skill
- **当** 管理员编辑已存在 Skill 的参数 schema、manifest、权限策略或启用状态
- **那么** 系统必须保存修改，并提示正在运行的 Bot 需要重启后生效

### 需求:Context Skill 配置区
Context 创建和编辑表单必须提供 Skill 能力配置区，动态展示当前 Bot 已注册的 Skill，并支持配置启用状态、参数和 forceCall。

#### 场景:展示可用 Skill
- **当** 管理员打开 Context 表单
- **那么** 页面必须加载当前 Bot 的 Skill 列表，并为每个 Skill 展示开关、类型、参数表单和 forceCall 配置

#### 场景:根据参数 schema 渲染表单
- **当** Skill 声明了参数 schema
- **那么** Context 表单必须根据 schema 类型渲染对应输入控件，并将结果保存到 `skillConfigs.params`

#### 场景:没有 Skill 时提示
- **当** 当前 Bot 未注册任何 Skill
- **那么** Context Skill 配置区必须提示管理员先到 Skill 管理页添加 Skill

### 需求:Skill 审计查看
管理控制台必须提供 script Skill 审计记录查看能力，便于管理员排查脚本执行结果和失败原因。

#### 场景:查看审计列表
- **当** 管理员打开某个 Skill 的审计记录
- **那么** 页面必须展示执行时间、状态、耗时、Context、chatKey、输入摘要、输出摘要和错误摘要

#### 场景:审计脱敏显示
- **当** 审计记录包含 secret 参数
- **那么** 页面必须显示脱敏值，禁止展示明文密钥

## 修改需求

## 移除需求
