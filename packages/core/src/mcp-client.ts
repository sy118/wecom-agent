import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadMcpTools } from '@langchain/mcp-adapters'
import type { McpServerConfig } from '@wecom-platform/types'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

const variablePattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

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
  return Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
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

export async function createMcpTools(mcpServers: McpServerConfig[]) {
  const allTools: Awaited<ReturnType<typeof loadMcpTools>> = []

  for (const server of mcpServers) {
    if (!server.enabled) continue
    try {
      const transport = createMcpTransport(server)
      const client = new Client(
        { name: `wecom-platform-${server.name}`, version: '1.0.0' },
        { capabilities: {} }
      )
      await client.connect(transport)
      const tools = await loadMcpTools(server.name, client, { defaultToolTimeout: 60_000 })
      console.log(`[MCP] Loaded ${tools.length} tools from ${server.name}`)
      allTools.push(...tools)
    } catch (err) {
      // Single MCP failure does not block bot startup
      console.error(`[MCP] Failed to load tools from ${server.name}:`, err)
    }
  }

  return allTools
}
