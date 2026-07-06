import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadMcpTools } from '@langchain/mcp-adapters'
import type { McpServerConfig } from '@wecom-platform/types'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { StructuredTool } from '@langchain/core/tools'

const variablePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000
const DEFAULT_LOAD_TOOLS_TIMEOUT_MS = 20_000
const DEFAULT_TOOL_TIMEOUT_MS = 180_000

export interface McpToolClient {
  serverId: string
  serverName: string
  tools: StructuredTool[]
  close: () => Promise<void>
}

export interface CreateMcpToolClientOptions {
  connectTimeoutMs?: number
  loadToolsTimeoutMs?: number
  toolTimeoutMs?: number
}

function configuredTimeout(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string, onTimeout?: () => void | Promise<void>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          void onTimeout?.()
          reject(new Error(`${label} timed out after ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function resolveTemplate(value: string): string {
  return value.replace(variablePattern, (_, variableName: string) => {
    const resolved = process.env[variableName]
    if (resolved === undefined) throw new Error(`Missing environment variable: ${variableName}`)
    return resolved
  })
}

function resolveStringRecord(record: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, resolveTemplate(value)]))
}

function processEnvironment(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  if (process.env.PATH !== undefined && env.PATH === undefined) env.PATH = process.env.PATH
  return env
}

export function createMcpTransport(server: McpServerConfig): Transport {
  if (server.transportType === 'sse') {
    if (!server.url) throw new Error('SSE MCP server url is required')
    return new SSEClientTransport(new URL(server.url))
  }

  if (server.transportType === 'stdio') {
    if (!server.command) throw new Error('stdio MCP server command is required')
    return new StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: {
        ...processEnvironment(),
        ...resolveStringRecord(server.env),
      },
    })
  }

  if (!server.url) throw new Error('Streamable HTTP MCP server url is required')
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: resolveStringRecord(server.headers) },
  })
}

export function __testConfiguredTimeout(envKey: string, fallback: number): number {
  return configuredTimeout(envKey, fallback)
}

export async function createMcpToolClient(
  server: McpServerConfig,
  options: CreateMcpToolClientOptions = {}
): Promise<McpToolClient> {
  const transport = createMcpTransport(server)
  const client = new Client(
    { name: `wecom-platform-${server.name}`, version: '1.0.0' },
    { capabilities: {} }
  )
  const connectTimeoutMs = options.connectTimeoutMs ?? configuredTimeout('MCP_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS)
  const loadToolsTimeoutMs = options.loadToolsTimeoutMs ?? configuredTimeout('MCP_LOAD_TOOLS_TIMEOUT_MS', DEFAULT_LOAD_TOOLS_TIMEOUT_MS)
  const toolTimeoutMs = options.toolTimeoutMs ?? configuredTimeout('MCP_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS)

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await client.close().catch(() => {})
    try {
      await (transport as any).close?.()
    } catch {
      // Transport close is best-effort; client.close() is the primary cleanup path.
    }
  }

  try {
    await withTimeout(client.connect(transport), connectTimeoutMs, `MCP connect ${server.name}`, close)
    const tools = await withTimeout(
      loadMcpTools(server.name, client, { defaultToolTimeout: toolTimeoutMs }),
      loadToolsTimeoutMs,
      `MCP load tools ${server.name}`,
      close
    )
    console.log(`[MCP] Loaded ${tools.length} tools from ${server.name}`)
    return {
      serverId: server.id,
      serverName: server.name,
      tools,
      close,
    }
  } catch (err) {
    await close()
    throw err
  }
}

export async function createMcpTools(mcpServers: McpServerConfig[]) {
  const allTools: StructuredTool[] = []

  for (const server of mcpServers) {
    if (!server.enabled) continue
    try {
      const toolClient = await createMcpToolClient(server)
      allTools.push(...toolClient.tools)
    } catch (err) {
      // Single MCP failure does not block bot startup
      console.error(`[MCP] Failed to load tools from ${server.name}:`, err)
    }
  }

  return allTools
}
