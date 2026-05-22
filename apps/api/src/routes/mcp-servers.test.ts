import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-mcp-servers-'))
process.env.DB_PATH = join(tempDir, 'mcp-servers-test.db')

const [{ db, initDb }, { McpServerRepository }, { mcpServersRouter }] = await Promise.all([
  import('../db/client.js'),
  import('../db/mcp-server-repository.js'),
  import('./mcp-servers.js'),
])

let server: Server
let baseUrl = ''

before(async () => {
  await initDb()
  const app = express()
  app.use(express.json())
  app.use('/api/mcp-servers', mcpServersRouter)
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

test('McpServerRepository persists stdio and streamable-http fields', async () => {
  const stdio = await McpServerRepository.create({
    botId: null,
    name: 'jira',
    url: null,
    transportType: 'stdio',
    enabled: true,
    command: 'uvx',
    args: ['mcp-atlassian'],
    env: { JIRA_PERSONAL_TOKEN: '${JIRA_PERSONAL_TOKEN}' },
    headers: {},
  })

  assert.equal(stdio.url, null)
  assert.equal(stdio.command, 'uvx')
  assert.deepEqual(stdio.args, ['mcp-atlassian'])
  assert.deepEqual(stdio.env, { JIRA_PERSONAL_TOKEN: '${JIRA_PERSONAL_TOKEN}' })

  const streamable = await McpServerRepository.create({
    botId: null,
    name: 'yuque',
    url: 'http://127.0.0.1:4000/mcp',
    transportType: 'streamable-http',
    enabled: true,
    command: null,
    args: [],
    env: {},
    headers: { Authorization: 'Bearer ${YUQUE_MCP_TOKEN}' },
  })

  assert.equal(streamable.url, 'http://127.0.0.1:4000/mcp')
  assert.deepEqual(streamable.headers, { Authorization: 'Bearer ${YUQUE_MCP_TOKEN}' })
})

test('MCP server API validates and normalizes transport-specific payloads', async () => {
  const invalidStdio = await requestJson('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify({ name: 'bad-stdio', transportType: 'stdio', enabled: true }),
  })
  assert.equal(invalidStdio.response.status, 400)

  const invalidHeaders = await requestJson('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'bad-yuque',
      transportType: 'streamable-http',
      enabled: true,
      url: 'http://127.0.0.1:4000/mcp',
      headers: { Authorization: 123 },
    }),
  })
  assert.equal(invalidHeaders.response.status, 400)

  const duplicatedParamKey = await requestJson('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'bad-param-schema',
      transportType: 'sse',
      enabled: true,
      url: 'http://127.0.0.1:4000/sse',
      paramSchema: [
        { key: 'project', label: '项目', type: 'string' },
        { key: 'project', label: '项目副本', type: 'string' },
      ],
    }),
  })
  assert.equal(duplicatedParamKey.response.status, 400)
  assert.match(duplicatedParamKey.body.error, /duplicated/)

  const created = await requestJson('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify({
      name: 'api-yuque',
      transportType: 'streamable-http',
      enabled: true,
      url: 'http://127.0.0.1:4000/mcp',
      command: 'ignored',
      args: ['ignored'],
      env: { IGNORED: 'ignored' },
      headers: { Authorization: 'Bearer ${YUQUE_MCP_TOKEN}' },
      paramSchema: [
        { key: 'namespace', label: '知识库', type: 'string', description: '默认知识库' },
      ],
    }),
  })

  assert.equal(created.response.status, 201)
  assert.equal(created.body.command, null)
  assert.deepEqual(created.body.args, [])
  assert.deepEqual(created.body.env, {})
  assert.deepEqual(created.body.headers, { Authorization: 'Bearer ${YUQUE_MCP_TOKEN}' })
  assert.deepEqual(created.body.paramSchema, [
    { key: 'namespace', label: '知识库', type: 'string', description: '默认知识库' },
  ])
})
