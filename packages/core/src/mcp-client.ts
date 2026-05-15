import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { loadMcpTools } from '@langchain/mcp-adapters'
import type { McpServerConfig } from '@wecom-platform/types'

export async function createMcpTools(mcpServers: McpServerConfig[]) {
  const allTools: Awaited<ReturnType<typeof loadMcpTools>> = []

  for (const server of mcpServers) {
    if (!server.enabled) continue
    try {
      let transport
      if (server.transportType === 'sse') {
        transport = new SSEClientTransport(new URL(server.url))
      } else {
        console.warn(`[MCP] Unsupported transport type: ${server.transportType} for ${server.name}`)
        continue
      }
      const client = new Client(
        { name: `wecom-platform-${server.name}`, version: '1.0.0' },
        { capabilities: {} }
      )
      await client.connect(transport)
      const tools = await loadMcpTools(server.name, client, { defaultToolTimeout: 30_000 })
      console.log(`[MCP] Loaded ${tools.length} tools from ${server.name}`)
      allTools.push(...tools)
    } catch (err) {
      // Single MCP failure does not block bot startup
      console.error(`[MCP] Failed to load tools from ${server.name}:`, err)
    }
  }

  return allTools
}
