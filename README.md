# WeChat Work AI Platform

企业微信 AI 运维助手平台——多机器人、多上下文、可视化配置的内网部署方案。

## 架构

```
wecom-agent/
├── apps/
│   ├── api/          # Express 5 API 服务 + Bot 运行时
│   └── web/          # React 18 + Vite + Ant Design 管理控制台
├── packages/
│   ├── core/         # 共享业务逻辑（Agent、MCP、WecomAdapter、SessionStore）
│   └── types/        # 共享 TypeScript 类型
├── docker-compose.yml
└── .env.example
```

## 核心功能

- **多机器人管理**：每个机器人独立凭证、LLM 配置和 MCP 工具
- **多上下文路由**：不同群/用户绑定不同系统提示词和项目范围
- **多轮对话**：内存会话，30 分钟 TTL，保留最近 20 条消息
- **并发安全**：per-chatKey 串行消息队列，防止并发处理混乱
- **可视化管理**：内网 Web 控制台，JWT 认证，实时状态推送

## 快速开始

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动 API（端口 3000）
pnpm dev:api

# 启动 Web（端口 5173）
pnpm dev:web
```

### Docker 部署

```bash
# 复制并填写配置
cp .env.example .env

# 启动所有服务
docker-compose up -d
```

访问 `http://your-server:8080` 打开管理控制台。

## 环境变量

| 变量名 | 说明 | 必填 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理控制台登录密码 | 是 |
| `JWT_SECRET` | JWT 签名密钥 | 是 |
| `DB_PATH` | SQLite 数据库路径 | 否（默认 `/data/wecom-platform.db`） |
| `API_PORT` | API 服务端口 | 否（默认 `3000`） |
| `WEB_PORT` | Web 管理台端口 | 否（默认 `8080`） |

机器人配置（企业微信凭证、LLM 配置、MCP 服务器）通过管理控制台 Web UI 进行配置，无需环境变量。
