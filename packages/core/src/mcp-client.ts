import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadMcpTools } from '@langchain/mcp-adapters'
import type { McpServerConfig, McpServerTransportType, McpProbeResult, McpProbeStageResult } from '@wecom-platform/types'
export type { McpProbeResult, McpProbeStageResult } from '@wecom-platform/types'
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

function sanitizeError(error: unknown, server?: McpServerConfig): string {
  const text = error instanceof Error ? error.message : String(error)
  let sanitized = text
    .replace(/(authorization|token|secret|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
  // Do not return literal configured credentials if an SDK includes request
  // headers, command arguments, or an endpoint in its error text.
  const sensitiveValues = new Set<string>()
  for (const value of Object.values(server?.headers ?? {})) {
    if (!value.includes('${') && value.length > 2) sensitiveValues.add(value)
  }
  for (const value of Object.values(server?.env ?? {})) {
    if (!value.includes('${') && value.length > 2) sensitiveValues.add(value)
    const match = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/)
    const resolved = match ? process.env[match[1]] : undefined
    if (resolved && resolved.length > 2) sensitiveValues.add(resolved)
  }
  for (const value of sensitiveValues) sanitized = sanitized.split(value).join('[redacted]')
  try {
    const parsed = new URL(sanitized)
    for (const key of parsed.searchParams.keys()) parsed.searchParams.set(key, '[redacted]')
    sanitized = parsed.toString()
  } catch {
    // Error text is not necessarily a URL.
  }
  return sanitized
}

export function createMcpTransport(server: McpServerConfig): Transport {
  if (server.transportType === 'sse') {
    if (!server.url) throw new Error('SSE MCP server url is required')
    return new SSEClientTransport(new URL(server.url), {
      requestInit: { headers: resolveStringRecord(server.headers) },
    })
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

export async function probeMcpServer(
  server: McpServerConfig,
  options: CreateMcpToolClientOptions = {}
): Promise<McpProbeResult> {
  const startedAt = Date.now()
  const stages: McpProbeStageResult[] = []
  let transport: Transport | undefined
  let client: Client | undefined
  let tools: StructuredTool[] = []
  let ok = true

  const stage = async <T>(name: McpProbeStageResult['name'], action: () => Promise<T> | T): Promise<T | undefined> => {
    const stageStartedAt = Date.now()
    try {
      const value = await action()
      stages.push({ name, status: 'success', durationMs: Date.now() - stageStartedAt })
      return value
    } catch (error) {
      ok = false
      stages.push({ name, status: 'failed', durationMs: Date.now() - stageStartedAt, error: sanitizeError(error, server) })
      return undefined
    }
  }

  await stage('validate', () => {
    if (!server.id || !server.name) throw new Error('MCP server id and name are required')
    if (!['sse', 'stdio', 'streamable-http'].includes(server.transportType)) throw new Error('Unsupported MCP transport type')
    if (server.transportType === 'stdio' ? !server.command : !server.url) throw new Error('MCP connection endpoint is required')
  })

  if (ok) {
    transport = await stage('connect', () => {
      const created = createMcpTransport(server)
      client = new Client({ name: `wecom-platform-probe-${server.name}`, version: '1.0.0' }, { capabilities: {} })
      return created
    })
    if (transport && client) {
      const timeoutMs = options.connectTimeoutMs ?? configuredTimeout('MCP_CONNECT_TIMEOUT_MS', DEFAULT_CONNECT_TIMEOUT_MS)
      await stage('initialize', () => withTimeout(client!.connect(transport!), timeoutMs, `MCP initialize ${server.name}`, async () => {
        await (transport as any)?.close?.().catch?.(() => {})
      }))
    } else {
      stages.push({ name: 'initialize', status: 'skipped', durationMs: 0 })
    }
  } else {
    stages.push({ name: 'connect', status: 'skipped', durationMs: 0 })
    stages.push({ name: 'initialize', status: 'skipped', durationMs: 0 })
  }

  if (ok && client) {
    const loaded = await stage('list-tools', async () => {
      const timeoutMs = options.loadToolsTimeoutMs ?? configuredTimeout('MCP_LOAD_TOOLS_TIMEOUT_MS', DEFAULT_LOAD_TOOLS_TIMEOUT_MS)
      return withTimeout(loadMcpTools(server.name, client!, { defaultToolTimeout: options.toolTimeoutMs ?? configuredTimeout('MCP_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS) }), timeoutMs, `MCP load tools ${server.name}`)
    })
    tools = loaded ?? []
  } else {
    stages.push({ name: 'list-tools', status: 'skipped', durationMs: 0 })
  }

  const closeStartedAt = Date.now()
  try {
    await client?.close().catch(() => {})
    await (transport as any)?.close?.().catch?.(() => {})
    stages.push({ name: 'close', status: 'success', durationMs: Date.now() - closeStartedAt })
  } catch (error) {
    ok = false
    stages.push({ name: 'close', status: 'failed', durationMs: Date.now() - closeStartedAt, error: sanitizeError(error, server) })
  }

  return {
    ok,
    serverId: server.id,
    serverName: server.name,
    transportType: server.transportType,
    totalDurationMs: Date.now() - startedAt,
    stages,
    toolCount: tools.length,
    toolNames: tools.map((tool) => tool.name),
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
