## 新增需求

### 需求:wiki-compiler Skill 包结构
wiki-compiler 必须是一个合法的 Skill bundle（zip 包），包含 `SKILL.md`（技能说明）、`index.js`（入口脚本）、`package.json`。作为模板提供，用户安装后可按需修改。

#### 场景:Skill bundle 结构验证
- **当** 上传 wiki-compiler.zip 到 Bot 的 Skills 页面
- **那么** 通过现有 `validateSkillBundle` 验证，成功安装到数据库

---

### 需求:wiki-compiler 输入输出协议
wiki-compiler 脚本必须通过 stdin 接收 JSON 输入，通过 stdout 输出 JSON 结果，遵循现有 Script Skill 协议。

输入格式：
```json
{
  "conversation": [{ "role": "user|assistant", "content": "..." }],
  "namespace": "product",
  "wiki_mcp_url": "http://localhost:3001/sse"
}
```

输出格式：
```json
{
  "updated_pages": ["faq/refund.md"],
  "summary": "提炼了 2 条退款相关知识"
}
```

#### 场景:有新知识时写入 Wiki
- **当** 脚本分析对话后判断存在新的领域知识
- **那么** 调用 wiki_append 将知识追加到对应页面，输出更新的页面列表

#### 场景:无新知识时跳过
- **当** 对话内容为闲聊或已有知识的重复
- **那么** 输出 `{ "updated_pages": [], "summary": "无新知识" }`，不写入 Wiki

---

### 需求:wiki-compiler 安全约束
wiki-compiler 脚本必须遵循现有 Script Skill 安全机制：`scriptsEnabled` 策略控制、超时限制（默认 60 秒）、输出字节上限、审计日志记录。

#### 场景:超时保护
- **当** 脚本执行超过配置的超时时间
- **那么** 进程被强制终止，审计日志记录 `status: "timeout"`

#### 场景:审计日志
- **当** 脚本执行完成（成功或失败）
- **那么** 在 `skill_audit_logs` 表中记录执行结果，`input_preview` 包含对话摘要，`output_preview` 包含更新的页面列表

---

### 需求:Scheduled Task 定时编译配置
系统必须支持通过 Scheduled Task 定时触发 wiki-compiler 逻辑。提供配置示例：每天 02:00 触发，系统提示指导 LLM 编译当日知识，结果发送到管理员群。

#### 场景:定时编译任务配置
- **当** 用户在 Scheduled Tasks 页面创建任务，cron 为 `0 2 * * *`，系统提示包含 Wiki 编译指令
- **那么** 每天 02:00 触发 AgentEngine，LLM 调用 wiki_write 工具更新 Wiki，结果消息发送到配置的 target chat
