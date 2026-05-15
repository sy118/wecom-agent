## 新增需求

### 需求:Wiki 文件上传 API
系统必须提供文件上传 API，支持将 Markdown 文件上传到指定 namespace 目录。复用现有 multer 上传机制，限制文件类型为 `.md`，单次最多 50 个文件，单文件最大 5MB。

#### 场景:上传 Markdown 文件
- **当** `POST /api/wiki/:namespace/upload` 携带 multipart 文件数据
- **那么** 将文件写入 `{WIKI_ROOT}/{namespace_path}/{filename}`，自动创建中间目录，执行 git commit，返回上传成功的文件列表

#### 场景:非 Markdown 文件被拒绝
- **当** 上传文件扩展名不为 `.md`
- **那么** 返回 400 错误 `"仅支持 .md 文件"`

#### 场景:namespace 不存在
- **当** URL 中的 namespace 在数据库中不存在
- **那么** 返回 404 错误

---

### 需求:Wiki 文件目录浏览 API
系统必须提供文件目录浏览 API，返回指定 namespace 的文件树结构。

#### 场景:获取文件树
- **当** `GET /api/wiki/:namespace/files` 请求到达
- **那么** 返回该 namespace 目录下的完整文件树，每个节点包含 `name`、`path`、`type`（file/dir）、`size`（文件大小，字节）

#### 场景:获取文件内容
- **当** `GET /api/wiki/:namespace/files/*filepath` 请求到达
- **那么** 返回指定文件的文本内容，Content-Type 为 `text/plain`

---

### 需求:手动触发 Git Pull API
系统必须提供手动触发 git pull 的 API 端点。

#### 场景:触发 git pull
- **当** `POST /api/wiki/git-pull` 请求到达
- **那么** 在 `WIKI_ROOT` 执行 `git pull`，返回执行结果摘要

---

### 需求:Wiki 文件管理 Web 页面
Wiki 管理页面必须在 namespace 详情视图中提供文件管理功能。

#### 场景:浏览文件树
- **当** 用户点击某个 namespace 进入详情
- **那么** 展示该 namespace 的文件目录树，支持展开/折叠目录节点

#### 场景:上传文件
- **当** 用户在 namespace 详情页点击"上传文件"并选择 .md 文件
- **那么** 调用上传 API，显示上传进度，成功后刷新文件树

#### 场景:手动触发 Git Pull
- **当** 用户点击"同步最新（Git Pull）"按钮
- **那么** 调用 git-pull API，显示执行结果（更新了哪些文件）
