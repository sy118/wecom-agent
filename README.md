# 企业微信 AI 助手平台

企业微信 AI 助手平台是一套面向企业内部协作场景的多机器人管理与 Agent 运行平台。它把企业微信智能机器人、模型服务、上下文配置、MCP 工具、技能包、Wiki 知识库、用户反馈、定时任务和会话监控统一放进一个 Web 控制台，让团队可以更稳定地把 AI 助手部署到群聊和单聊中。

它适合用于内部制度问答、客服与售前辅助、研发知识检索、运营日报、流程提醒、会议纪要沉淀、知识库持续维护等场景。每个机器人可以独立配置企业微信凭证和模型供应商，不同群聊或用户也可以绑定到不同上下文，从而让同一个平台承载多个业务角色。

## 核心价值

- 集中管理：在一个控制台维护机器人、上下文、群聊绑定、MCP 服务、技能包、定时任务、Wiki 知识库和会话记录。
- 多角色协作：同一平台可运行多个企业微信机器人，同一机器人也可按群聊或用户切换不同上下文。
- 知识可运营：支持 Markdown Wiki、检索调试、知识草稿审核、反馈转草稿、无命中问题分析和运营指标。
- 工具可扩展：支持 SSE、stdio、Streamable HTTP 类型 MCP Server，也支持可上传的 Skill 技能包。
- 可观测可维护：支持机器人启停、运行状态、会话监控、反馈事件记录、技能审计、Wiki 健康检查和定时任务管理。

## 主要功能

### 机器人管理

- 配置企业微信 Bot ID、Bot Secret、WebSocket URL。
- 接入 OpenAI-compatible、Anthropic 或 Dify 应用。
- 支持普通回复、渐进式回复和打字机式流式回复。
- 支持文本、图片、引用消息、语音识别文本和混合消息。

### 上下文与群聊绑定

- 为不同业务场景配置独立系统提示词、会话 TTL、MCP 工具和 Skill 技能。
- 将企业微信群聊或单聊绑定到指定 Context。
- 机器人运行中会自动发现未绑定会话，便于管理员后续绑定。

### MCP 工具与 Skill 技能包

- 支持 `sse`、`stdio`、`streamable-http` 三类 MCP 传输方式。
- 可为 MCP Server 配置参数 schema、请求头、环境变量和启用状态。
- 支持上传包含 `SKILL.md` 的技能包，技能可以是提示词增强，也可以是受权限策略约束的脚本工具。
- 支持脚本执行审计、超时控制、输出大小限制、环境变量白名单和读写路径限制。

### Wiki 知识库

- 以 namespace 管理本地 Markdown 知识库。
- 支持文档浏览、搜索、预览、上传、Git 同步和健康检查。
- 支持检索测试、热门命中文档、无命中问题、待审核草稿和反馈运营指标。
- 支持从用户负反馈创建 Wiki 草稿，审核后再合并到正式文档。
- 通过独立 `wiki-mcp-server` 将 `wiki_read`、`wiki_search`、`wiki_write` 等工具暴露给机器人。

### 用户反馈闭环

- 接收企业微信智能机器人反馈事件。
- 关联机器人回复、用户问题、检索证据和负反馈原因。
- 支持将反馈标记为知识缺失、检索问题、模型/工具问题或忽略。
- 支持从反馈创建知识草稿或标注答案，帮助团队把一次差评变成下一次更好的回答。

### 定时任务与会话监控

- 使用 cron 表达式向指定群聊或用户定时发送提示。
- 可用于日报、巡检、提醒、知识整理等固定流程。
- 支持查看活跃会话、消息历史、过期时间，并可手动清理会话。

## 技术栈

- Monorepo：pnpm workspace
- API：Node.js、Express、libSQL/SQLite、JWT、node-cron
- Web：React、Vite、Ant Design、React Router、Axios
- Agent：LangChain、LangGraph、OpenAI-compatible、Anthropic、Dify
- 企业微信：企业微信智能机器人 WebSocket SDK
- 工具扩展：Model Context Protocol SDK、SSE、stdio、Streamable HTTP
- Wiki 服务：独立 `wiki-mcp-server`
- 部署：Docker Compose，包含 `api`、`web`、`wiki-mcp` 三个服务

## 项目结构

```text
wecom-agent/
├─ apps/
│  ├─ api/                    # Express API、数据库、BotManager、定时任务、Wiki 接口
│  └─ web/                    # React + Vite 管理控制台
├─ packages/
│  ├─ core/                   # AgentEngine、WeComAdapter、MCP Client、Dify Client、Skill 运行时
│  ├─ types/                  # 前后端共享类型
│  └─ wiki-mcp-server/        # Wiki MCP Server、Wiki 工具和 Git 同步逻辑
├─ examples/
│  └─ skills/                 # 示例 Skill 包
├─ openspec/                  # OpenSpec 规格与变更记录
├─ data/                      # 本地数据库和 Wiki 数据目录
├─ docker-compose.yml
├─ package.json
└─ pnpm-workspace.yaml
```

## 环境要求

- Node.js 20+
- pnpm 9+
- Docker / Docker Compose，可选，部署时使用
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

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

至少需要设置：

```env
ADMIN_PASSWORD=your-admin-password
JWT_SECRET=your-random-jwt-secret
DB_PATH=./data/wecom-platform.db
API_PORT=3000
API_HOST=127.0.0.1
WEB_PORT=8080
WEB_HOST=127.0.0.1
WIKI_ROOT=./data/wiki
WIKI_MCP_PORT=3001
WIKI_MCP_URL=http://localhost:3001
```

机器人凭证、模型 API Key、MCP 服务和 Skill 配置主要在 Web 控制台中维护。

### 3. 构建项目

```bash
pnpm build
```

当前 `dev:api` 和 `dev:wiki-mcp` 运行的是构建后的 `dist` 文件。首次启动前请先构建；修改 `types`、`core` 或 `api` 后，也需要重新构建相关包。

### 4. 启动本地服务

分别打开终端运行：

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

如需本地 Wiki MCP：

```bash
pnpm dev:wiki-mcp
```

默认访问地址：

- Web 控制台：http://127.0.0.1:8080
- API 服务：http://localhost:3000
- Wiki MCP 健康检查：http://127.0.0.1:3001/health

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

默认访问：

- Web 控制台：http://localhost:8080
- API 服务：容器内 `api:3000`
- Wiki MCP：容器内 `wiki-mcp:3001`

常用命令：

```bash
docker compose logs -f api
docker compose logs -f web
docker compose logs -f wiki-mcp
docker compose down
```

Docker 会使用 `api-data` 保存数据库，使用 `wiki-data` 保存 Wiki 文档。

## 控制台配置流程

1. 登录 Web 控制台。
2. 创建机器人，填写企业微信 Bot ID、Bot Secret、WebSocket URL 和模型配置。
3. 创建 MCP 服务，填写 URL、传输类型、请求头或环境变量。
4. 上传或启用需要的 Skill 技能包。
5. 创建上下文，配置系统提示词、会话 TTL、MCP 和 Skill。
6. 将企业微信群聊或单聊绑定到上下文。
7. 启动机器人，并在会话监控中观察消息处理情况。
8. 如需知识库，进入 Wiki 页面创建 namespace，上传文档或绑定本地目录。
9. 如需自动化，创建定时任务并填写 cron 表达式和目标会话。

## Wiki 知识库上手

建议将 `WIKI_ROOT` 配置为绝对路径，确保 API 和 `wiki-mcp-server` 读取同一个目录。

```env
WIKI_ROOT=E:/path/to/wecom-agent/apps/api/data/wiki
WIKI_MCP_PORT=3001
WIKI_MCP_URL=http://127.0.0.1:3001
```

使用步骤：

1. 启动 `api`、`web` 和 `wiki-mcp`。
2. 在 Wiki 页面创建知识库 namespace。
3. 在 MCP 服务器页面创建 `wiki-mcp`，URL 使用 `http://127.0.0.1:3001/sse`，传输类型选择 SSE。
4. 在上下文中启用该 MCP，并设置参数，例如：

```json
{
  "namespace": "product",
  "retrievalPolicy": "autoSearch",
  "crossNs": false
}
```

常见检索策略：

- `manual`：只暴露工具，由模型按需调用。
- `autoSearch`：收到问题后先搜索 Wiki，再把命中摘要注入提示词。
- `fixedPage`：固定读取某个页面，适合制度、SOP 或常驻说明。

## 环境变量速查

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Web 控制台管理员密码 | 无 |
| `JWT_SECRET` | JWT 签名密钥 | 无 |
| `DB_PATH` | SQLite/libSQL 数据库路径 | `./data/wecom-platform.db` |
| `API_PORT` | API 端口 | `3000` |
| `API_HOST` | 本地开发时 Web 代理连接的 API 地址 | `127.0.0.1` |
| `API_BASE_URL` | Web 本地开发代理目标，设置后优先使用 | 无 |
| `WEB_PORT` | Web 控制台端口 | `8080` |
| `WEB_HOST` | Web 本地开发监听地址 | `127.0.0.1` |
| `WIKI_ROOT` | Wiki 根目录 | `./data/wiki` |
| `WIKI_MCP_PORT` | Wiki MCP Server 端口 | `3001` |
| `WIKI_MCP_URL` | API 使用的 Wiki MCP 基础地址，不追加 `/sse` | `http://localhost:3001` |
| `SKILL_SCRIPTS_ENABLED` | 是否允许执行脚本型 Skill | `false` |
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
| `pnpm build:wiki-mcp` | 构建 Wiki MCP Server |
| `pnpm dev:api` | 运行 API dist |
| `pnpm dev:web` | 启动 Vite Web 开发服务 |
| `pnpm dev:wiki-mcp` | 运行 Wiki MCP Server dist |
| `pnpm wiki-mcp` | 启动已构建的 Wiki MCP Server |
| `pnpm test` | 构建并运行测试 |

## 排障

- Web 提示 API 连接失败：确认 `pnpm dev:api` 已启动，并检查 `API_HOST`、`API_PORT` 或 `API_BASE_URL`。
- `pnpm dev:api` 找不到 dist：先运行 `pnpm build` 或 `pnpm build:api`。
- 机器人无法连接企业微信：检查 Bot ID、Bot Secret、WebSocket URL，并查看 API 日志。
- MCP 工具不可用：确认 MCP Server 已启用、传输类型正确，并且上下文中启用了该 MCP。
- Streamable HTTP MCP 误配：`/mcp` 端点通常应选择 `streamable-http`，不要按 SSE 配置。
- Wiki 控制台有文档但机器人搜不到：确认 API 和 `wiki-mcp-server` 使用同一个 `WIKI_ROOT`。
- 反馈没有进入 Wiki 闭环：确认机器人回复时已生成反馈 ID，并且反馈事件能关联到对应回复记录。

## 安全提示

- 生产环境请使用强密码和随机 `JWT_SECRET`。
- 数据库文件、Docker volume、模型 API Key、企业微信凭证和 MCP 访问令牌都应限制访问权限。
- 脚本型 Skill 建议开启最小权限策略，限制超时、输出大小、读写路径、环境变量和网络访问。

## 更多介绍

如果你想先从产品价值和使用场景了解这个项目，可以阅读 [产品介绍.md](./产品介绍.md)。
