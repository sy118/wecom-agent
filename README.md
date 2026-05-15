# 企业微信 AI 助手平台

一个面向企业微信机器人的内部 AI 助手平台。项目支持多机器人、多上下文路由、Web 可视化管理、MCP 工具接入、技能扩展、定时任务和会话监控，适合在团队内部部署多个不同职责的企业微信 AI 助手。

## 主要能力

- 多机器人管理：每个机器人独立配置企业微信凭证、模型供应商、MCP 服务、技能和运行状态。
- 多上下文路由：为不同群聊或用户绑定不同系统提示词、工具能力和会话策略。
- 模型接入：支持 OpenAI-compatible、Anthropic 和 Dify 应用。
- MCP 工具：可为机器人配置 SSE 或 stdio 类型的 MCP 服务，并按上下文启用、传参或强制调用。
- 技能系统：支持 prompt 技能和脚本技能，包含参数 schema、权限策略和审计记录。
- 企业微信消息处理：支持文本、图片、引用消息、语音识别文本、混合消息和流式回复。
- 会话管理：按 chatKey 维护多轮会话，支持 TTL、Dify conversationId 和后台会话查看。
- 定时任务：通过 cron 表达式向指定会话定时发送任务提示。
- Web 控制台：提供登录、机器人、上下文、群聊绑定、MCP、技能、定时任务和会话监控页面。

## 技术栈

- Monorepo：pnpm workspace
- API 服务：Node.js 20、Express 5、JWT、libSQL/SQLite
- Web 控制台：React 18、Vite、Ant Design、React Router、Axios
- 核心运行时：LangChain、LangGraph、企业微信机器人 SDK、MCP SDK
- 部署：Docker Compose、Nginx 静态站点反向代理 API

## 项目结构

```text
wecom-agent/
├─ apps/
│  ├─ api/                 # Express API、数据库初始化、BotManager、定时任务调度
│  └─ web/                 # React + Vite 管理控制台
├─ packages/
│  ├─ core/                # AgentEngine、WeComAdapter、MCP、Dify、技能运行时
│  └─ types/               # 前后端共享 TypeScript 类型
├─ openspec/               # OpenSpec 规格与变更记录
├─ data/                   # 本地数据库目录
├─ docker-compose.yml      # API + Web 一体化部署
├─ pnpm-workspace.yaml
└─ .env.example
```

## 环境要求

- Node.js 20+
- pnpm 9+
- Docker / Docker Compose，可选，仅部署时需要
- 企业微信智能机器人凭证：Bot ID、Bot Secret、WebSocket URL
- 至少一种模型服务凭证：OpenAI-compatible、Anthropic 或 Dify

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 准备环境变量

```bash
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

至少需要填写：

```env
ADMIN_PASSWORD=your-admin-password-here
JWT_SECRET=your-random-jwt-secret-here
DB_PATH=./data/wecom-platform.db
API_PORT=3000
WEB_PORT=8080
```

机器人、模型、MCP 和技能配置主要在 Web 控制台中维护，不再依赖旧版单机器人环境变量。

### 3. 构建项目

```bash
pnpm build
```

当前 `dev:api` 会运行 `apps/api/dist/index.js`，因此首次本地启动前需要先构建。修改 API、core 或 types 的 TypeScript 源码后，也需要重新构建对应包。

### 4. 启动本地开发服务

打开两个终端：

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

访问：

- Web 控制台：http://localhost:5173
- API 服务：http://localhost:3000

Web 开发服务会把 `/api` 请求代理到 `http://localhost:3000`。登录密码为 `.env` 中的 `ADMIN_PASSWORD`。

## Docker 部署

```bash
cp .env.example .env
```

编辑 `.env` 后启动：

```bash
docker compose up -d --build
```

默认访问地址：

- Web 控制台：http://localhost:8080
- API 服务：http://localhost:3000

常用运维命令：

```bash
docker compose logs -f api
docker compose logs -f web
docker compose down
```

API 容器中的数据库默认保存到 Docker volume `api-data`，容器内路径为 `/data/wecom-platform.db`。

## 环境变量

| 变量 | 说明 | 默认值 | 必填 |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Web 控制台管理员登录密码 | 无 | 是 |
| `JWT_SECRET` | JWT 签名密钥，建议使用随机长字符串 | 无 | 是 |
| `DB_PATH` | SQLite/libSQL 数据库文件路径 | `./data/wecom-platform.db`，Docker 中为 `/data/wecom-platform.db` | 否 |
| `API_PORT` | API 服务端口 | `3000` | 否 |
| `WEB_PORT` | Docker 部署时 Web 对外端口 | `8080` | 否 |

## 控制台配置流程

1. 登录 Web 控制台。
2. 创建机器人，填写企业微信 Bot ID、Bot Secret、WebSocket URL。
3. 选择模型供应商：
   - `openai-compatible`：填写 API Key、Base URL 和模型名。
   - `anthropic`：填写 Anthropic API Key、Base URL 和模型名。
   - `dify`：填写 Dify Base URL、API Key 和可选 App ID。
4. 按需创建 MCP 服务，配置服务地址、传输类型和参数 schema。
5. 按需创建技能，配置 prompt 或脚本 manifest、参数 schema 与权限策略。
6. 创建上下文，编写系统提示词，并选择该上下文可用的 MCP 服务和技能。
7. 将企业微信群聊或用户绑定到上下文。运行中的机器人会自动发现未绑定会话，控制台可直接绑定。
8. 启动机器人，观察状态和会话监控。
9. 如需自动触发任务，创建定时任务并填写 cron 表达式、目标会话和提示模板。

## 核心概念

| 概念 | 说明 |
| --- | --- |
| Bot | 一个企业微信机器人实例，包含企业微信凭证、模型配置和运行状态。 |
| Context | 机器人在某类会话中的行为配置，包含系统提示词、会话 TTL、MCP 与技能配置。 |
| Binding | 将具体企业微信群聊或用户的 `chatKey` 绑定到某个上下文。 |
| MCP Server | 可被 Agent 调用的外部工具服务，可在上下文中选择启用并传入参数。 |
| Skill | 平台内置扩展能力，可是纯 prompt，也可是受权限策略约束的脚本工具。 |
| Session | 按会话保存的多轮消息历史，可在控制台查看和删除。 |
| Scheduled Task | 使用 cron 表达式定时向指定会话发送提示。 |

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖。 |
| `pnpm build` | 按 types、core、api、web 顺序构建全部包。 |
| `pnpm build:api` | 只构建 API 包。 |
| `pnpm build:web` | 只构建 Web 控制台。 |
| `pnpm dev:api` | 以 watch 模式运行已构建的 API dist 文件。 |
| `pnpm dev:web` | 启动 Vite 开发服务器。 |
| `pnpm test` | 构建后运行 core 包中的 Node 测试。 |

## 数据与安全

- 数据库默认使用本地 SQLite/libSQL 文件，API 启动时会自动建表和迁移缺失字段。
- 机器人密钥、模型 API Key、Dify API Key 等敏感信息存储在数据库中，生产环境请限制数据库文件和 Docker volume 的访问权限。
- Web 控制台使用管理员密码换取 24 小时有效的 JWT。
- 技能系统会根据 schema 和敏感字段名对密钥类参数做脱敏展示。
- 脚本技能应配置最小权限策略，例如超时时间、输出大小、可读写路径、环境变量白名单和网络访问开关。

## API 概览

所有业务接口除登录外均需要 `Authorization: Bearer <token>`。

| 路径 | 说明 |
| --- | --- |
| `POST /api/auth/login` | 管理员登录，返回 JWT。 |
| `/api/bots` | 机器人 CRUD、启动、停止和状态 SSE。 |
| `/api/bots/:botId/contexts` | 上下文配置 CRUD。 |
| `/api/bots/:botId/bindings` | 会话绑定、已发现会话查询。 |
| `/api/bots/:botId/mcp-servers` | MCP 服务配置 CRUD。 |
| `/api/bots/:botId/skills` | 技能 CRUD 和审计记录查询。 |
| `/api/bots/:botId/scheduled-tasks` | 定时任务 CRUD。 |
| `/api/sessions` | 活跃会话查询和删除。 |

## 排障

- API 启动时报 `ADMIN_PASSWORD not configured`：检查 `.env` 是否存在且 `ADMIN_PASSWORD` 已填写。
- 登录后接口返回 401：JWT 过期或 `JWT_SECRET` 变更，重新登录即可。
- `pnpm dev:api` 找不到 dist：先执行 `pnpm build` 或 `pnpm build:api`。
- 修改源码后行为没有变化：API dev 脚本运行的是构建产物，需要重新构建对应包。
- Web 请求 API 失败：确认 `pnpm dev:api` 已启动，且 Vite 代理目标 `http://localhost:3000` 可访问。
- Docker Web 能打开但 API 不通：查看 `docker compose logs -f api`，并确认 `.env` 中的必要变量已设置。
- 机器人无法连接企业微信：检查 Bot ID、Bot Secret、WebSocket URL 是否正确，查看 API 日志中的连接或重连信息。
- MCP 工具不可用：确认 MCP 服务启用、URL/transport 正确，并且上下文中已启用对应 MCP 配置。

## 开发说明

- 共享类型优先放在 `packages/types`，业务运行时逻辑优先放在 `packages/core`。
- API 路由位于 `apps/api/src/routes`，数据库访问封装位于 `apps/api/src/db`。
- Web 页面位于 `apps/web/src/pages`，统一 API 客户端位于 `apps/web/src/api`。
- 如果变更涉及 types 或 core，通常需要先构建依赖包，再构建 API/Web。
- 项目包含 OpenSpec 规格和历史变更记录，较大的功能变更建议先补充或更新对应规格。

## Wiki 知识库

平台内置 Wiki 知识库系统，让 Bot 能够访问持续更新的领域文档。

### 环境变量

```env
WIKI_ROOT=/data/wiki          # Wiki 根目录（必须是 Git 仓库）
WIKI_MCP_PORT=3001            # Wiki MCP Server 端口，默认 3001
WIKI_GIT_REMOTE=              # 可选，Git 远端地址（用于 git pull 同步）
```

### 快速上手

**1. 初始化 Wiki 目录**

```bash
mkdir -p /data/wiki/namespaces
cd /data/wiki
git init
git commit --allow-empty -m "init wiki"
```

**2. 启动 Wiki MCP Server**

```bash
WIKI_ROOT=/data/wiki pnpm wiki-mcp
# 或使用 Docker Compose（已内置 wiki-mcp 服务）
```

**3. 在 Web Console 创建 Namespace**

访问 Web Console → Wiki 知识库 → 新建 Namespace，填写标识符（如 `product`）和目录路径。

**4. 在 Bot 中注册 Wiki MCP Server**

Web Console → MCP 服务器 → 新建，填写：
- 名称：`wiki-mcp`
- URL：`http://localhost:3001/sse`
- 传输类型：SSE

**5. 在 Context 中绑定 Namespace**

Web Console → 机器人 → 上下文 → 编辑，在 MCP 配置中启用 `wiki-mcp`，设置 params：

```json
{ "namespace": "product" }
```

Bot 回答时会自动在系统提示中注入 Wiki namespace 信息，LLM 可主动调用 `wiki_read`、`wiki_search` 等工具查询知识库。

### Obsidian 集成

1. 用 Obsidian 打开 `WIKI_ROOT` 目录作为 Vault
2. 安装 [obsidian-git](https://github.com/denolehov/obsidian-git) 插件
3. 配置自动 commit + push 间隔（建议 5 分钟）
4. 在 Web Console 点击"同步最新（Git Pull）"或等待 wiki-mcp-server 定时拉取

### 定时编译示例

在 Web Console → 定时任务 → 新建，配置：

```json
{
  "name": "每日 Wiki 编译",
  "cronExpr": "0 2 * * *",
  "promptTemplate": "请检查今天的对话，提炼有价值的知识，使用 wiki_write 工具更新 Wiki 知识库（namespace: product）。完成后汇报更新了哪些页面。",
  "targetChatKey": "wecom:group:your-admin-group-id"
}
```

### wiki-compiler Skill

`examples/skills/wiki-compiler.zip` 是一个可安装的 Script Skill，在对话结束后自动提炼知识写入 Wiki。

在 Web Console → Skills → 上传，选择 `wiki-compiler.zip` 安装，然后在 Context 的 Skill 配置中启用。
