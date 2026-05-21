import assert from 'node:assert/strict'
import test from 'node:test'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig } from '@wecom-platform/types'
import { createMcpTools, createMcpTransport } from './mcp-client.js'

function makeServer(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: 'server-1',
    botId: null,
    name: 'server',
    url: 'http://127.0.0.1:65535/sse',
    transportType: 'sse',
    enabled: true,
    args: [],
    env: {},
    headers: {},
    ...overrides,
  }
}

test('createMcpTransport creates SSE transport for SSE servers', () => {
  const transport = createMcpTransport(makeServer({ transportType: 'sse', url: 'http://127.0.0.1:65535/sse' }))

  assert.ok(transport instanceof SSEClientTransport)
})

test('createMcpTransport creates Streamable HTTP transport for /mcp servers', () => {
  const transport = createMcpTransport(makeServer({ transportType: 'streamable-http', url: 'http://127.0.0.1:65535/mcp' }))

  assert.ok(transport instanceof StreamableHTTPClientTransport)
})

test('createMcpTransport resolves stdio env and keeps API process env available', () => {
  const previousPath = process.env.PATH
  const previousToken = process.env.MCP_TEST_TOKEN
  process.env.PATH = previousPath ?? '/usr/bin'
  process.env.MCP_TEST_TOKEN = 'resolved-token'

  try {
    const transport = createMcpTransport(makeServer({
      transportType: 'stdio',
      url: null,
      command: 'node',
      env: { TOKEN: '${MCP_TEST_TOKEN}' },
    }))
    const serverParams = (transport as unknown as { _serverParams: { env: Record<string, string> } })._serverParams

    assert.ok(transport instanceof StdioClientTransport)
    assert.equal(serverParams.env.PATH, process.env.PATH)
    assert.equal(serverParams.env.TOKEN, 'resolved-token')
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousToken === undefined) delete process.env.MCP_TEST_TOKEN
    else process.env.MCP_TEST_TOKEN = previousToken
  }
})
test('createMcpTools skips missing stdio env variable without blocking other servers', async () => {
  const tools = await createMcpTools([
    makeServer({
      id: 'stdio-1',
      name: 'stdio-missing-env',
      url: null,
      transportType: 'stdio',
      command: 'node',
      env: { TOKEN: '${MISSING_MCP_TEST_TOKEN}' },
    }),
    makeServer({
      id: 'disabled-1',
      name: 'disabled',
      enabled: false,
    }),
  ])

  assert.deepEqual(tools, [])
})

test('createMcpTools treats streamable-http /mcp URL as non-SSE transport', async () => {
  const tools = await createMcpTools([
    makeServer({
      id: 'streamable-1',
      name: 'streamable',
      url: 'http://127.0.0.1:65535/mcp',
      transportType: 'streamable-http',
      headers: { Authorization: 'Bearer literal-token' },
    }),
  ])

  assert.deepEqual(tools, [])
})
