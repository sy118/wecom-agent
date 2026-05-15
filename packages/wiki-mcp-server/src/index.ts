import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import { existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'
import { initGit, isGitRepo } from './git-sync.js'
import {
  wikiRead,
  wikiSearch,
  wikiWrite,
  wikiAppend,
  wikiList,
  wikiGitPull,
} from './wiki-tools.js'

const WIKI_ROOT = resolve(process.env.WIKI_ROOT ?? '')
const WIKI_MCP_PORT = Number(process.env.WIKI_MCP_PORT ?? 3001)

if (!process.env.WIKI_ROOT) {
  console.error('[wiki-mcp] WIKI_ROOT 环境变量未设置，服务无法启动')
  process.exit(1)
}

if (!existsSync(WIKI_ROOT)) {
  console.log(`[wiki-mcp] WIKI_ROOT 不存在，自动创建: ${WIKI_ROOT}`)
  mkdirSync(WIKI_ROOT, { recursive: true })
}

isGitRepo(WIKI_ROOT).then((isGit) => {
  if (!isGit) {
    console.warn(`[wiki-mcp] 警告: ${WIKI_ROOT} 不是 Git 仓库，git 相关工具将返回错误`)
  } else {
    initGit(WIKI_ROOT)
    console.log(`[wiki-mcp] Git 仓库已初始化: ${WIKI_ROOT}`)
  }
})

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'wiki-mcp-server',
    version: '1.0.0',
  })

  server.tool(
    'wiki_read',
    '读取指定 Wiki 页面的 Markdown 内容',
    {
      path: z.string().describe('页面路径（相对于 namespace 目录，.md 扩展名可选）'),
      namespace: z.string().optional().describe('Wiki namespace，未提供时读取根目录'),
      max_chars: z.number().optional().describe('最大返回字符数'),
    },
    async ({ path, namespace, max_chars }) => {
      const content = await wikiRead(WIKI_ROOT, path, namespace, max_chars)
      return { content: [{ type: 'text', text: content }] }
    }
  )

  server.tool(
    'wiki_search',
    '在指定 namespace 内搜索包含关键字的 Wiki 页面',
    {
      query: z.string().describe('搜索关键字'),
      namespace: z.string().optional().describe('搜索范围 namespace，未提供时搜索根目录'),
      cross_ns: z.boolean().optional().describe('是否跨所有 namespace 搜索'),
    },
    async ({ query, namespace, cross_ns }) => {
      const results = await wikiSearch(WIKI_ROOT, query, namespace, cross_ns)
      const text = results.length === 0
        ? '未找到匹配页面'
        : results.map((r) => `[${r.namespace}] ${r.title} (${r.path})\n${r.excerpt}`).join('\n\n')
      return { content: [{ type: 'text', text }] }
    }
  )

  server.tool(
    'wiki_write',
    '写入或覆盖指定 Wiki 页面，自动 git commit',
    {
      path: z.string().describe('页面路径（相对于 namespace 目录）'),
      content: z.string().describe('Markdown 内容'),
      namespace: z.string().optional().describe('目标 namespace'),
    },
    async ({ path, content, namespace }) => {
      const result = await wikiWrite(WIKI_ROOT, path, content, namespace)
      return { content: [{ type: 'text', text: result }] }
    }
  )

  server.tool(
    'wiki_append',
    '在指定 Wiki 页面末尾追加内容，页面不存在时自动创建',
    {
      path: z.string().describe('页面路径（相对于 namespace 目录）'),
      content: z.string().describe('要追加的 Markdown 内容'),
      namespace: z.string().optional().describe('目标 namespace'),
    },
    async ({ path, content, namespace }) => {
      const result = await wikiAppend(WIKI_ROOT, path, content, namespace)
      return { content: [{ type: 'text', text: result }] }
    }
  )

  server.tool(
    'wiki_list',
    '列出指定 namespace 的目录树，未提供 namespace 时列出所有 namespace',
    {
      namespace: z.string().optional().describe('目标 namespace，未提供时列出所有 namespace'),
    },
    async ({ namespace }) => {
      const tree = await wikiList(WIKI_ROOT, namespace)
      return { content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }] }
    }
  )

  server.tool(
    'wiki_git_pull',
    '拉取 Wiki Git 仓库的最新内容',
    {},
    async () => {
      const result = await wikiGitPull()
      return { content: [{ type: 'text', text: result }] }
    }
  )

  return server
}

const app = express()

// SSE transport map: sessionId → transport
const transports = new Map<string, SSEServerTransport>()

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res)
  transports.set(transport.sessionId, transport)

  res.on('close', () => {
    transports.delete(transport.sessionId)
  })

  const server = createMcpServer()
  await server.connect(transport)
})

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string
  const transport = transports.get(sessionId)
  if (!transport) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  await transport.handlePostMessage(req, res)
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', wikiRoot: WIKI_ROOT })
})

app.listen(WIKI_MCP_PORT, '0.0.0.0', () => {
  console.log(`[wiki-mcp] MCP SSE Server 运行在 http://0.0.0.0:${WIKI_MCP_PORT}/sse`)
  console.log(`[wiki-mcp] WIKI_ROOT: ${WIKI_ROOT}`)
})
