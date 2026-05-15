## 新增需求

### 需求:MCP Server 启动配置
wiki-mcp-server 必须通过环境变量 `WIKI_ROOT` 获取 Wiki 根目录路径。启动时必须验证该目录存在且为 Git 仓库（含 `.git` 目录）。`WIKI_MCP_PORT` 环境变量配置监听端口，默认 `3001`。

#### 场景:WIKI_ROOT 未配置
- **当** 启动时 `WIKI_ROOT` 环境变量未设置或为空
- **那么** 进程必须输出明确错误信息并以非零退出码退出，不启动 SSE 服务

#### 场景:WIKI_ROOT 不是 Git 仓库
- **当** `WIKI_ROOT` 指向的目录不含 `.git` 子目录
- **那么** 进程必须输出警告但仍可启动，git 相关工具返回错误而不崩溃

#### 场景:正常启动
- **当** `WIKI_ROOT` 有效且端口可用
- **那么** SSE MCP Server 在 `http://0.0.0.0:{WIKI_MCP_PORT}/sse` 监听，输出启动日志

---

### 需求:wiki_read 工具
系统必须提供 `wiki_read(path, namespace?)` 工具，读取指定 Wiki 页面的 Markdown 内容。`path` 为相对于 namespace 目录的文件路径（含 `.md` 扩展名可选）。`namespace` 为可选参数，未提供时读取 `WIKI_ROOT` 根目录下的文件。`max_chars` 可选参数限制返回字符数，默认不限制。

#### 场景:读取存在的页面
- **当** 调用 `wiki_read("products/overview", "product")`
- **那么** 返回 `{WIKI_ROOT}/namespaces/product/products/overview.md` 的文本内容

#### 场景:页面不存在
- **当** 指定路径的文件不存在
- **那么** 返回错误信息 `"页面不存在: {path}"`，不抛出异常

#### 场景:路径遍历攻击防护
- **当** path 包含 `..` 或绝对路径
- **那么** 必须拒绝请求并返回错误 `"非法路径"`

---

### 需求:wiki_search 工具
系统必须提供 `wiki_search(query, namespace?, cross_ns?)` 工具，在指定 namespace 内搜索包含 query 关键字的页面。搜索范围：文件名 + 文件内容（大小写不敏感）。`cross_ns=true` 时跨所有 namespace 搜索。返回匹配页面列表，每项包含 `path`、`namespace`、`title`（一级标题或文件名）、`excerpt`（匹配行上下文，最多 200 字符）。

#### 场景:namespace 内关键字搜索
- **当** 调用 `wiki_search("退款政策", "product")`
- **那么** 返回 `{WIKI_ROOT}/namespaces/product/` 下所有包含"退款政策"的文件列表

#### 场景:跨 namespace 搜索
- **当** 调用 `wiki_search("公司简介", cross_ns=true)`
- **那么** 返回所有 namespace 下匹配的文件列表，每项标注所属 namespace

#### 场景:无匹配结果
- **当** 搜索词在指定范围内无匹配
- **那么** 返回空数组 `[]`，不返回错误

---

### 需求:wiki_write 工具
系统必须提供 `wiki_write(path, content, namespace?)` 工具，写入或覆盖指定 Wiki 页面。写入后必须自动执行 `git add` + `git commit`，commit message 格式为 `wiki: update {namespace}/{path}`。写入操作必须串行化（内部队列），防止并发 git 冲突。

#### 场景:写入新页面
- **当** 调用 `wiki_write("faq/refund", "# 退款政策\n...", "product")`
- **那么** 创建文件 `{WIKI_ROOT}/namespaces/product/faq/refund.md`，自动创建中间目录，执行 git commit

#### 场景:更新已有页面
- **当** 目标文件已存在
- **那么** 覆盖文件内容并执行 git commit

#### 场景:并发写入串行化
- **当** 多个工具调用同时触发 wiki_write
- **那么** 写入操作必须排队依次执行，不得并发执行 git 操作

---

### 需求:wiki_append 工具
系统必须提供 `wiki_append(path, content, namespace?)` 工具，在指定页面末尾追加内容（自动添加换行分隔）。页面不存在时自动创建。追加后执行 git commit，commit message 格式为 `wiki: append {namespace}/{path}`。

#### 场景:追加到已有页面
- **当** 调用 `wiki_append("faq/refund", "## 新增场景\n...", "product")`
- **那么** 在文件末尾追加内容，保留原有内容，执行 git commit

#### 场景:页面不存在时自动创建
- **当** 目标文件不存在
- **那么** 创建文件并写入内容，行为等同于 wiki_write

---

### 需求:wiki_list 工具
系统必须提供 `wiki_list(namespace?)` 工具，返回指定 namespace 的目录树结构。每个节点包含 `name`、`path`、`type`（file/dir）、`children`（目录节点）。

#### 场景:列出 namespace 目录树
- **当** 调用 `wiki_list("product")`
- **那么** 返回 `{WIKI_ROOT}/namespaces/product/` 的完整目录树，仅包含 `.md` 文件

#### 场景:列出所有 namespace
- **当** 调用 `wiki_list()` 不传 namespace
- **那么** 返回所有 namespace 的顶层目录列表

---

### 需求:wiki_git_pull 工具
系统必须提供 `wiki_git_pull()` 工具，在 `WIKI_ROOT` 执行 `git pull`，拉取远端最新内容。返回 pull 结果摘要（新增/修改文件数）。

#### 场景:成功拉取
- **当** 调用 `wiki_git_pull()` 且远端有新提交
- **那么** 执行 git pull，返回 `"已更新 {n} 个文件"` 摘要

#### 场景:无远端配置
- **当** Git 仓库未配置 remote
- **那么** 返回错误信息 `"未配置 Git remote，跳过 pull"`，不抛出异常
