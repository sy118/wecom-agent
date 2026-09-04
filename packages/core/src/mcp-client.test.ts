import assert from 'node:assert/strict'
import test from 'node:test'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig } from '@wecom-platform/types'
import { __testConfiguredTimeout, createMcpTools, createMcpTransport, probeMcpServer } from './mcp-client.js'

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

test('MCP client reads MCP_TOOL_TIMEOUT_MS as default tool timeout override', () => {
  const previous = process.env.MCP_TOOL_TIMEOUT_MS
  process.env.MCP_TOOL_TIMEOUT_MS = '180000'

  try {
    assert.equal(__testConfiguredTimeout('MCP_TOOL_TIMEOUT_MS', 60_000), 180_000)
  } finally {
    if (previous === undefined) delete process.env.MCP_TOOL_TIMEOUT_MS
    else process.env.MCP_TOOL_TIMEOUT_MS = previous
  }
})

test('createMcpTransport creates SSE transport for SSE servers', () => {
  const transport = createMcpTransport(makeServer({ transportType: 'sse', url: 'http://127.0.0.1:65535/sse' }))

  assert.ok(transport instanceof SSEClientTransport)
})

test('createMcpTransport resolves SSE headers without exposing their values', () => {
  const previous = process.env.MCP_SSE_TOKEN
  process.env.MCP_SSE_TOKEN = 'sse-token'
  try {
    const transport = createMcpTransport(makeServer({
      transportType: 'sse',
      headers: { Authorization: 'Bearer ${MCP_SSE_TOKEN}' },
    }))
    const requestInit = (transport as unknown as { _requestInit?: RequestInit })._requestInit
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer sse-token')
  } finally {
    if (previous === undefined) delete process.env.MCP_SSE_TOKEN
    else process.env.MCP_SSE_TOKEN = previous
  }
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

test('probeMcpServer returns stage diagnostics and does not expose credentials', async () => {
  const result = await probeMcpServer(makeServer({
    id: 'probe-1',
    name: 'probe-secret',
    transportType: 'stdio',
    url: null,
    command: 'node',
    env: { TOKEN: '${MISSING_PROBE_TOKEN}' },
  }), { connectTimeoutMs: 100 })

  assert.equal(result.ok, false)
  assert.deepEqual(result.stages.map((stage) => stage.name), ['validate', 'connect', 'initialize', 'list-tools', 'close'])
  assert.equal(result.stages.find((stage) => stage.name === 'connect')?.status, 'failed')
  assert.equal(result.stages.some((stage) => stage.error?.includes('MISSING_PROBE_TOKEN')), true)
})
