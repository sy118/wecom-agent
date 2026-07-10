# 企业微信 AI 助手平台

企业微信 AI 助手平台是一套面向企业内部协作场景的多机器人管理与 Agent 运行平台。它把企业微信智能机器人、模型服务、上下文配置、MCP 工具、技能包、用户反馈事件、定时任务和会话监控统一放进一个 Web 控制台。

## 主要能力

- 多机器人管理：每个机器人独立配置企业微信凭证、模型供应商和回复模式。
- 上下文与绑定：为不同群聊或用户配置独立系统提示、会话 TTL、MCP 工具和 Skill 能力。
- MCP 与 Skill：支持 `sse`、`stdio`、`streamable-http` MCP Server，以及可上传的 Skill bundle。
- 定时任务：通过 cron 向指定群聊或用户发送自动化 Agent 任务结果。
- 会话监控：查看活跃会话、历史消息和过期时间。
- 企业微信事件：接收并记录智能机器人事件与用户反馈。

## 技术栈

- Monorepo: pnpm workspace
- API: Node.js, Express, libSQL/SQLite, JWT, node-cron
- Web: React, Vite, Ant Design, React Router, Axios
- Agent: LangChain, LangGraph, OpenAI-compatible, Anthropic, Dify
- 工具扩展: Model Context Protocol SDK, SSE, stdio, Streamable HTTP
- 部署: Docker Compose，单个 `registry.cn-hangzhou.aliyuncs.com/serein_ai/wecom-agent` 镜像内由 Express 同时托管 API 和 Web 静态资源

## 项目结构

```text
wecom-agent/
├─ apps/
│  ├─ api/                    # Express API、数据库、BotManager、定时任务
│  └─ web/                    # React + Vite 管理控制台
├─ packages/
│  ├─ core/                   # AgentEngine、WeComAdapter、MCP Client、Dify Client、Skill 运行时
│  └─ types/                  # 前后端共享类型
├─ examples/
│  └─ skills/                 # 示例 Skill 包
├─ openspec/                  # OpenSpec 规格与变更记录
├─ data/                      # 本地数据库目录
├─ docker-compose.yml
├─ package.json
└─ pnpm-workspace.yaml
```

## 快速开始

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm dev:api
pnpm dev:web
```

本地默认访问：

- Web 控制台: http://127.0.0.1:5173
- API 服务: http://localhost:3000

至少需要设置：

```env
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=your-random-jwt-secret
DB_PATH=./data/wecom-platform.db
API_PORT=3000
API_HOST=127.0.0.1
WEB_PORT=5173
WEB_HOST=127.0.0.1
```

机器人凭证、模型 API Key、MCP 服务和 Skill 配置主要在 Web 控制台中维护。

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

Compose 会构建并运行镜像 `registry.cn-hangzhou.aliyuncs.com/serein_ai/wecom-agent:${DOCKER_TAG:-latest}`，默认访问：

- Web 控制台: http://localhost:5173
- 容器内 API: `app:3000`

常用命令：

```bash
docker compose logs -f app
docker compose down
```

Docker 使用 `api-data` volume 保存 SQLite 数据库。

推送到阿里云 Container Registry：

```bash
docker login --username=15187401260 registry.cn-hangzhou.aliyuncs.com
docker compose --env-file .env.example build
docker push registry.cn-hangzhou.aliyuncs.com/serein_ai/wecom-agent:${DOCKER_TAG:-latest}
```

如果在阿里云 ECS 的 VPC 内推送，可将 `DOCKER_IMAGE` 改为 `registry-vpc.cn-hangzhou.aliyuncs.com/serein_ai/wecom-agent`，并登录对应 registry 域名。

如果 MCP 服务和本应用部署在同一台 Linux 服务器，并且 MCP 只监听宿主机 `127.0.0.1`，可使用 host 网络部署文件：

```bash
docker compose down
docker compose -f docker-compose.host.yml --env-file .env up -d --build
```

使用该模式时，MCP URL 可以填写 `http://127.0.0.1:1347/api/mcp`，Web 控制台仍通过 `WEB_PORT` 暴露，默认 `5173`。

### OceanBase MCP

Compose 会启动独立的 `oceanbase-mcp` 服务，并让 API 通过内部地址 `http://oceanbase-mcp:8000/mcp` 使用 `streamable-http` 连接。启动时会自动创建 OceanBase MCP Server；如果数据库中已有名称包含 `OceanBase` 的旧 SSE 配置，会保留原 ID 并修正为内部 Streamable HTTP 地址，因此已有 Context 引用不会失效。

OceanBase sidecar 默认使用同一 ACR 仓库的 `oceanbase-mcp-0.0.4` tag。CI 中如需单独构建该镜像，Dockerfile 路径使用 `docker/oceanbase-mcp/Dockerfile`，构建上下文仍为项目根目录。

在服务器 `.env` 中填写：

```env
OCEANBASE_MCP_AUTO_REGISTER=true
OCEANBASE_MCP_ENABLE_MEMORY=0
OCEANBASE_MCP_TOKEN=
OB_HOST=your-oceanbase-host
OB_PORT=2883
OB_USER="your-user@tenant#cluster"
OB_PASSWORD="your-oceanbase-password"
OB_DATABASE=your-database
```

用户名或密码含 `#`、`!` 等字符时必须使用双引号，避免 `.env` 将 `#` 后面的内容当作注释。OceanBase MCP 默认只在 Compose 内部网络暴露，不需要开放宿主机 8000 端口。

启动并检查：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f oceanbase-mcp app
```

成功时，应用日志会出现类似 `[MCP] Loaded ... tools from OceanBase MCP`。管理员仍需在对应 Context 的“MCP 能力配置”中启用 OceanBase MCP，系统不会自动给所有机器人授予数据库工具权限。

## 控制台配置流程

1. 登录 Web 控制台。
2. 创建机器人，填写企业微信 Bot ID、Bot Secret、WebSocket URL 和模型配置。
3. 创建 MCP Server，填写 URL、传输类型、请求头或环境变量。
4. 上传或启用需要的 Skill 包。
5. 创建上下文，配置系统提示词、会话 TTL、MCP 和 Skill。
6. 将企业微信群聊或单聊绑定到上下文。
7. 启动机器人，并在会话监控中观察消息处理情况。
8. 如需自动化，创建定时任务并填写 cron 表达式和目标会话。

## 环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Web 控制台管理员密码 | 无 |
| `JWT_SECRET` | JWT 签名密钥 | 无 |
| `DB_PATH` | SQLite/libSQL 数据库路径 | `./data/wecom-platform.db` |
| `API_PORT` | API 端口 | `3000` |
| `API_HOST` | 本地开发时 Web 代理连接的 API 地址 | `127.0.0.1` |
| `API_BASE_URL` | Web 本地开发代理目标，设置后优先使用 | 无 |
| `WEB_PORT` | Web 控制台端口 | `5173` |
| `WEB_HOST` | Web 本地开发监听地址 | `127.0.0.1` |
| `SKILL_SCRIPTS_ENABLED` | 是否允许执行脚本型 Skill | `false` |
| `NODE_IMAGE` | Docker 构建使用的 Node 基础镜像 | `ca7kangnvcl9wf.xuanyuan.run/library/node:20-alpine` |
| `DOCKER_IMAGE` | 应用镜像仓库地址 | `registry.cn-hangzhou.aliyuncs.com/serein_ai/wecom-agent` |
| `DOCKER_TAG` | 应用镜像版本号 | `latest` |
| `BOT_AUTO_START_CONCURRENCY` | 服务启动时自动启动 Bot 的并发上限 | `3` |
| `BOT_MESSAGE_CONCURRENCY` | Bot 跨会话消息处理并发上限 | `4` |
| `BOT_QUEUE_BACKPRESSURE_LIMIT` | 单会话队列积压上限 | `10` |
| `GENERATION_TASK_CONCURRENCY` | 生成任务后台执行并发 | `2` |
| `AGENT_TIMEOUT_MS` | Agent 单次回复超时，可选 | `120000` |
| `MCP_CONNECT_TIMEOUT_MS` | MCP 连接超时，可选 | `15000` |
| `MCP_LOAD_TOOLS_TIMEOUT_MS` | MCP 工具加载超时，可选 | `20000` |
| `MCP_TOOL_TIMEOUT_MS` | MCP 工具调用超时，可选 | `60000` |

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm build` | 构建全部包 |
| `pnpm build:api` | 构建 API |
| `pnpm build:web` | 构建 Web 控制台 |
| `pnpm dev:api` | 运行 API dist |
| `pnpm dev:web` | 启动 Vite Web 开发服务 |
| `pnpm test` | 构建并运行测试 |

## 排障

- Web 提示 API 连接失败：确认 `pnpm dev:api` 已启动，并检查 `API_HOST`、`API_PORT` 或 `API_BASE_URL`。
- `pnpm dev:api` 找不到 dist：先运行 `pnpm build` 或 `pnpm build:api`。
- 机器人无法连接企业微信：检查 Bot ID、Bot Secret、WebSocket URL，并查看 API 日志。
- MCP 工具不可用：确认 MCP Server 已启用、传输类型正确，并且上下文中启用了该 MCP。
- Streamable HTTP MCP 误配：`/mcp` 端点通常应选择 `streamable-http`，不要按 SSE 配置。

## 安全提示

- 生产环境请使用强密码和随机 `JWT_SECRET`。
- 数据库文件、Docker volume、模型 API Key、企业微信凭证和 MCP 访问令牌都应限制访问权限。
- 脚本型 Skill 建议开启最小权限策略，限制超时、输出大小、读写路径、环境变量和网络访问。
