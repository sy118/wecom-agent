# 企业微信 AI 助手平台

企业微信 AI 助手平台是一套面向企业内部协作场景的多机器人管理与 Agent 运行平台。它将企业微信智能机器人接入、模型调用、上下文路由、MCP 工具、可安装技能包、Wiki 知识库、定时任务和会话监控集中到一个 Web 控制台中管理，帮助团队把不同职责的 AI 助手稳定部署到群聊或单聊中。

平台适合用于客服与售前问答、研发知识库检索、运营日报生成、流程提醒、内部制度答疑、会议与群聊知识沉淀等场景。每个机器人可以独立配置企业微信凭证和模型供应商，每个群聊或用户又可以绑定到不同上下文，从而让同一个平台同时承载多个业务角色，而不是只运行一个固定提示词的聊天机器人。

[插入图片：平台整体架构图。建议展示“企业微信群聊/用户 → 企业微信 Bot WebSocket → API/BotManager → AgentEngine → 模型供应商、MCP 工具、Skill 运行时、Wiki MCP Server、SQLite/libSQL 数据库 → Web 控制台”的调用关系；如果使用 Docker 部署，请标出 `api`、`web`、`wiki-mcp` 三个服务和共享的 `wiki-data`/`api-data` volume。]

## 核心价值

- 集中管理：通过 Web 控制台统一维护机器人、上下文、群聊绑定、MCP 服务、技能包、定时任务、Wiki 知识库和会话记录，减少手动改配置和重启服务的成本。
- 多角色隔离：同一平台可运行多个企业微信机器人；同一机器人也可按群聊或用户路由到不同上下文，分别配置系统提示词、会话 TTL、可用工具和知识范围。
- 工具与知识扩展：支持 SSE/stdio MCP 服务、提示词技能包、脚本技能包和 Wiki MCP 工具，让机器人可以读取文档、调用外部系统、执行受控脚本并沉淀新知识。
- 可观测与可运维：提供机器人启停、运行状态 SSE、会话查看与清除、技能包审计记录、Wiki 健康检查、定时任务下次运行时间等管理能力。
- 面向生产部署：采用 pnpm workspace monorepo、Express API、React 控制台和 Docker Compose 组织服务，数据库默认使用 SQLite/libSQL 文件，便于小团队私有化部署和迁移。

## 主要能力

- 机器人管理：为每个 Bot 独立配置企业微信 Bot ID、Bot Secret、WebSocket URL、模型供应商、视觉模式、流式回复模式和运行状态。
- 上下文路由：按 `chatKey` 将企业微信群聊或单聊绑定到指定 Context；Context 内维护系统提示词、会话过期时间、MCP 配置和 Skill 配置。
- 模型接入：支持 OpenAI-compatible、Anthropic 和 Dify 应用；Dify 模式会维护 conversationId，普通模型模式基于本地 Session 保存多轮上下文。
- 消息处理：支持文本、图片、引用消息、语音识别文本、混合消息、群聊 @ 前缀清理、图片解密与多模态输入；回复支持普通 Markdown 和企业微信流式更新。
- MCP 工具：支持配置 SSE 或 stdio 类型 MCP Server，可按上下文启用、传入参数 schema、设置固定调用或由模型按需调用。
- 技能包系统：支持上传包含 `SKILL.md` 的技能包文件夹，记录元数据、资源索引、权限策略和脚本审计；脚本权限可限制超时、输出大小、读写路径、环境变量和网络访问。
- Wiki 知识库：通过“知识库空间（Namespace）”管理本地 Markdown 文档，支持配置体检、上传、浏览、检索调试、草稿审核、运营看板、同步最新、健康检查，并通过 `wiki-mcp-server` 暴露检索和写入工具给机器人。
- 定时任务：通过 cron 表达式向指定群聊或用户发送提示词模板，适合日报、巡检、知识整理和固定流程提醒。
- 会话监控：按会话查看多轮消息、最后活跃时间、过期时间，并支持清除指定会话历史。

[插入图片：Web 控制台总览截图。建议截取登录后的主界面，画面中应能看到左侧导航和“机器人管理、MCP 服务器、技能包、定时任务、Wiki 知识库、会话监控”等入口；主内容区建议停留在机器人列表页，展示机器人名称、模型供应商、运行状态和启动/停止操作。]

## 技术栈

- Monorepo：pnpm workspace
- API 服务：Node.js 20、Express 5、JWT、libSQL/SQLite、node-cron
- Web 控制台：React 18、Vite、Ant Design、React Router、Axios
- Agent 运行时：LangChain、LangGraph、OpenAI-compatible/Anthropic Chat Model、Dify API Client
- 企业微信接入：企业微信智能机器人 WebSocket SDK，支持消息解析、图片解密、断线重连和流式回复
- 工具扩展：Model Context Protocol SDK、SSE/stdio MCP Client、受控 Script Skill 运行时
- Wiki 服务：独立 `wiki-mcp-server`，通过 SSE 暴露 Wiki 读写、搜索、列表和 Git Pull 工具
- 部署：Docker Compose，Web 容器使用 Nginx 托管静态资源并反向代理 API

## 项目结构

```text
wecom-agent/
├─ apps/
│  ├─ api/                    # Express API、数据库初始化、BotManager、定时任务调度、Wiki 管理接口
│  └─ web/                    # React + Vite 管理控制台
├─ packages/
│  ├─ core/                   # AgentEngine、WeComAdapter、MCP Client、Dify Client、Skill 运行时
│  ├─ types/                  # 前后端共享 TypeScript 类型
│  └─ wiki-mcp-server/        # Wiki MCP Server、Wiki 工具、Git 同步逻辑和 wiki-compiler Skill 模板
├─ examples/
│  └─ skills/                 # 可上传安装的示例 Skill 包
├─ openspec/                  # OpenSpec 规格与变更记录
├─ data/                      # 本地数据库和 Wiki 数据目录
├─ docker-compose.yml         # api + web + wiki-mcp 一体化部署
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
| `WIKI_ROOT` | Wiki 知识库根目录，API 与 wiki-mcp-server 必须指向同一目录 | `./data/wiki`，Docker 中为 `/data/wiki` | 否 |
| `WIKI_MCP_PORT` | Wiki MCP Server 端口 | `3001` | 否 |
| `WIKI_MCP_URL` | Wiki MCP 基础地址，API 健康检查使用；MCP SSE 地址在此基础上追加 `/sse` | `http://localhost:3001`，Docker 中为 `http://wiki-mcp:3001` | 否 |

## 控制台配置流程

[插入图片：机器人到上下文的配置流程截图。建议使用拼接图或连续截图，依次展示“新建/编辑机器人”弹窗、“上下文”页面中的系统提示词、MCP/Skill 启用区域，以及“绑定”页面中将已发现群聊或用户绑定到 Context 的操作；截图中请脱敏 Bot Secret、API Key、群 ID 和真实成员信息。]

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

[插入图片：企业微信实际对话效果截图。建议展示群聊中 @机器人提问、机器人基于上下文或 Wiki 给出 Markdown 回复、以及流式回复完成后的最终效果；如需展示图片或引用消息处理，可选择包含图片/引用消息的示例。请先脱敏群名称、成员头像、客户信息和内部业务数据。]

## 核心概念

| 概念 | 说明 |
| --- | --- |
| 机器人（Bot） | 一个企业微信机器人实例，包含企业微信凭证、模型配置和运行状态。 |
| 上下文（Context） | 机器人在某类会话中的行为配置，包含系统提示词、会话 TTL、MCP 与技能配置。 |
| Binding | 将具体企业微信群聊或用户的 `chatKey` 绑定到某个上下文。 |
| MCP 服务（MCP Server） | 可被 Agent 调用的外部工具服务，可在上下文中选择启用并传入参数。 |
| 技能包（Skill） | 平台内置扩展能力，可是纯提示词，也可是受权限策略约束的脚本工具。 |
| Session | 按会话保存的多轮消息历史，可在控制台查看和删除。 |
| Scheduled Task | 使用 cron 表达式定时向指定会话发送提示。 |

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装 workspace 依赖。 |
| `pnpm build` | 按 types、core、api、web 顺序构建全部包。 |
| `pnpm build:api` | 只构建 API 包。 |
| `pnpm build:web` | 只构建 Web 控制台。 |
| `pnpm build:wiki-mcp` | 只构建 Wiki MCP Server。 |
| `pnpm dev:api` | 以 watch 模式运行已构建的 API dist 文件。 |
| `pnpm dev:web` | 启动 Vite 开发服务器。 |
| `pnpm dev:wiki-mcp` | 以 watch 模式运行已构建的 Wiki MCP Server。 |
| `pnpm wiki-mcp` | 运行已构建的 Wiki MCP Server。 |
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

平台内置 Wiki 知识库系统，让机器人能够访问持续更新的领域文档，并帮助管理员持续运营知识质量。Wiki 由两部分共同工作：

[插入图片：Wiki 知识库工作流截图。建议展示知识库空间列表、文档树、搜索与预览、绑定到机器人/上下文、健康状态和知识草稿审核区域；如果空间有限，优先展示“知识库空间 → 文档搜索 → 绑定上下文 → 草稿合并”的闭环。]

- API 读取 `WIKI_ROOT`，用于 Web 控制台的知识库空间、文档浏览、搜索、上传、草稿审核和健康检查。
- `wiki-mcp-server` 读取同一个 `WIKI_ROOT`，通过 SSE 向机器人暴露 `wiki_read`、`wiki_search`、`wiki_write`、`wiki_append`、`wiki_list` 和 `wiki_git_pull` 工具。

Web 控制台的 Wiki 页面现在包含几块核心工作区：

- 配置体检中心：检查 `WIKI_ROOT`、Git、wiki-mcp、MCP 服务、知识库空间、上下文绑定和关联机器人运行状态，并提供修复入口。
- 文档与检索调试：浏览 Markdown 文件树，按关键词搜索正文，测试检索并查看检索词、命中数量、命中文档、摘要和耗时。
- 知识草稿审核：编辑草稿、选择追加/覆盖/仅创建合并策略、预览合并差异，再批准或驳回。
- 运营看板：查看知识库空间的文档数、绑定数、待审核草稿数、近 7 天检索次数、无命中次数、热门命中文档和热门无命中问题。

本地开发时建议把 `WIKI_ROOT` 写成绝对路径。`pnpm dev:api` 和 `pnpm dev:wiki-mcp` 分别在不同 workspace 包目录下运行，如果使用相对路径，两个进程可能会读到不同的 Wiki 目录，表现为控制台能看到文档但机器人没有命中，或者机器人提示没有可用 Wiki 工具。

### 环境变量

```env
WIKI_ROOT=E:/path/to/wecom-agent/apps/api/data/wiki
WIKI_MCP_PORT=3001
WIKI_MCP_URL=http://127.0.0.1:3001
WIKI_GIT_REMOTE=
```

说明：

- `WIKI_ROOT` 是 Wiki 根目录，建议初始化为 Git 仓库；知识库空间文件实际位于 `WIKI_ROOT/namespaces/<namespace-path>`。
- `WIKI_MCP_PORT` 是 wiki-mcp-server 监听端口。端口冲突时可改为 `3002` 等，但 `.env`、健康检查地址和 MCP 服务 URL 必须保持一致。
- `WIKI_MCP_URL` 是 API 使用的 Wiki MCP 基础地址，不要追加 `/sse`。在 Web 控制台的 MCP 服务 URL 中使用 `http://127.0.0.1:<port>/sse`。
- Docker Compose 会让 API 使用 `http://wiki-mcp:3001` 访问 Wiki MCP，容器内 Wiki 根目录为 `/data/wiki`。

### 快速上手

**1. 初始化 Wiki 目录**

```bash
mkdir -p /absolute/wiki/root/namespaces
cd /absolute/wiki/root
git init
git commit --allow-empty -m "init wiki"
```

Windows PowerShell 示例：

```powershell
New-Item -ItemType Directory -Force E:\path\to\wecom-agent\apps\api\data\wiki\namespaces
git -C E:\path\to\wecom-agent\apps\api\data\wiki init
git -C E:\path\to\wecom-agent\apps\api\data\wiki commit --allow-empty -m "init wiki"
```

**2. 启动 Wiki MCP 服务**

首次启动前先构建，因为本地 dev 脚本运行的是 `dist`：

```bash
pnpm build
pnpm dev:api
pnpm dev:web
pnpm dev:wiki-mcp
```

如果 `3001` 已有旧的 wiki-mcp 实例占用，可以把 `.env` 改为：

```env
WIKI_MCP_PORT=3002
WIKI_MCP_URL=http://127.0.0.1:3002
```

随后在 MCP 服务配置中使用 `http://127.0.0.1:3002/sse`。

**3. 在 Web 控制台创建知识库空间**

访问 Web 控制台 → Wiki 知识库 → 新建知识库，填写标识符（如 `product`）、展示名称（如“产品知识库”）和目录路径（如 `product`）。目录路径是相对 `WIKI_ROOT/namespaces` 的路径。

**4. 为机器人注册 Wiki MCP 服务**

Web 控制台 → MCP 服务器 → 新建，填写：
- 名称：`wiki-mcp`
- URL：本地开发使用 `http://127.0.0.1:3001/sse`；如果端口改为 `3002`，使用 `http://127.0.0.1:3002/sse`；Docker Compose 内部使用 `http://wiki-mcp:3001/sse`
- 传输类型：SSE
- 状态：启用

**5. 在上下文中绑定知识库空间**

Web 控制台 → 机器人 → 上下文 → 编辑，在 MCP 配置中启用 `wiki-mcp`，设置参数：

```json
{
  "namespace": "product",
  "retrievalPolicy": "autoSearch",
  "crossNs": false
}
```

常用检索策略：

- `manual`：只暴露工具，由模型按需主动调用。
- `autoSearch`：机器人收到问题后先用用户问题搜索 Wiki，再把命中摘要注入系统提示。
- `fixedPage`：固定读取某个页面，适合制度、SOP 或常驻上下文；可同时设置 `forceCallPage` 和 `maxChars`。

修改 MCP 服务 URL、启用状态或上下文的 MCP 配置后，需要重启对应机器人。机器人在启动时加载 MCP 工具，不重启可能仍然使用旧配置。

### 验证 Wiki 是否可用

1. 检查 wiki-mcp 健康状态：

   ```bash
   curl http://127.0.0.1:3001/health
   ```

   返回中的 `wikiRoot` 应该等于 `.env` 中的 `WIKI_ROOT`。

2. 检查 API 侧健康状态：

   ```bash
   curl http://localhost:3000/api/wiki/health
   ```

   `rootConfigured`、`rootExists` 和 `wikiMcp` 应为 `ok` 或可解释的 warning。

3. 在 Web 控制台 → Wiki 知识库 → 健康状态里执行测试检索。页面会展示检索词、命中数量、命中文档、摘要和耗时；测试词要使用文档中真实存在的关键词，通用词如“测试”可能没有命中，但不代表工具不可用。

4. 在企业微信里向已绑定上下文的机器人提问。若机器人回复“没有可用的 Wiki 检索工具”，按下面的排障清单检查。

5. 在 Web 控制台 → Wiki 知识库 → 运营中观察近 7 天检索次数、无命中问题和热门命中文档。无命中问题可一键转为知识草稿，补充答案后再审核合并。

### Wiki 排障

- 机器人提示没有 Wiki 工具：确认 MCP 服务器已启用，URL 是 `/sse` 结尾，上下文中已启用该 MCP 配置，并重启机器人。
- 控制台有文档但机器人搜不到：确认 API 与 wiki-mcp-server 的 `WIKI_ROOT` 是同一个绝对路径，并检查 `http://127.0.0.1:<port>/health` 返回的 `wikiRoot`。
- 本地 `localhost` 连接异常：优先把 MCP 服务 URL 写成 `http://127.0.0.1:<port>/sse`，避免 IPv4/IPv6 解析差异。
- 搜索结果为空：换用文档标题、文件名或正文里的真实关键词；`wiki_search` 是关键词检索，不会凭空召回语义相近但没有字面命中的内容。
- 修改端口后仍连旧服务：检查 `.env` 的 `WIKI_MCP_PORT`、`WIKI_MCP_URL`、Web 控制台的 MCP 服务 URL 是否一致，并停止旧端口上的 wiki-mcp 实例。

### Obsidian 集成

1. 用 Obsidian 打开 `WIKI_ROOT` 目录作为 Vault
2. 安装 [obsidian-git](https://github.com/denolehov/obsidian-git) 插件
3. 配置自动 commit + push 间隔（建议 5 分钟）
4. 在 Web 控制台点击“同步最新”，或等待 wiki-mcp-server 定时拉取

### 知识沉淀与审核

推荐把新知识先沉淀为待审核草稿，再由管理员合并到正式 Wiki 页面：

1. 在 Web 控制台 → Wiki 知识库 → 知识草稿中创建草稿，填写目标页面和 Markdown 内容；也可以从运营看板的无命中问题一键转草稿。
2. 审核前可编辑草稿，选择追加、覆盖或仅创建新页面，并查看合并前差异预览。
3. 审核通过后点击合并，系统会写入 `WIKI_ROOT/namespaces/<namespace>/<targetPath>` 并尝试提交 Git commit。
4. 对需要自动沉淀的场景，可以用定时任务让机器人汇总当天会话，并把结果发到管理员群，由管理员复制为草稿或在确认后使用 `wiki_write`/`wiki_append`。

定时任务示例：

```json
{
  "name": "每日 Wiki 编译",
  "cronExpr": "0 2 * * *",
  "promptTemplate": "请检查今天的对话，提炼有价值的知识，按 Markdown 输出待审核 Wiki 草稿，包含建议 namespace、目标页面、内容和来源依据。不要直接覆盖正式文档。",
  "targetChatKey": "wecom:group:your-admin-group-id"
}
```

### wiki-compiler 技能包

`examples/skills/wiki-compiler.zip` 是一个可安装的脚本技能包，在对话结束后自动提炼知识写入 Wiki。

在 Web 控制台 → 技能包 → 上传，选择 `wiki-compiler.zip` 安装，然后在上下文的技能包配置中启用。
