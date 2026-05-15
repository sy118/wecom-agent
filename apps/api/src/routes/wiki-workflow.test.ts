import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'
import { simpleGit } from 'simple-git'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-api-wiki-'))
const wikiRoot = join(tempDir, 'wiki')
process.env.DB_PATH = join(tempDir, 'wiki-test.db')
process.env.WIKI_ROOT = wikiRoot
process.env.WIKI_MCP_URL = 'http://127.0.0.1:1'

const [
  { db, initDb },
  { BotRepository },
  { ContextRepository },
  { McpServerRepository },
  { wikiRouter },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/context-repository.js'),
  import('../db/mcp-server-repository.js'),
  import('./wiki.js'),
])

let server: Server
let baseUrl = ''

before(async () => {
  await mkdir(wikiRoot, { recursive: true })
  const git = simpleGit(wikiRoot)
  await git.init()
  await git.addConfig('user.email', 'test@example.invalid')
  await git.addConfig('user.name', 'Test User')
  await writeFile(join(wikiRoot, 'README.md'), '# Wiki\n')
  await git.add('.')
  await git.commit('init')

  await initDb()
  const app = express()
  app.use(express.json())
  app.use('/api/wiki', wikiRouter)
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

async function createBot(name: string) {
  return BotRepository.create({
    name,
    wecomBotId: `${name}-wecom`,
    wecomBotSecret: 'secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'test-model',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
}

test('Wiki API searches, previews, checks health, binds contexts, and reviews drafts', async () => {
  const createdNs = await requestJson('/api/wiki/namespaces', {
    method: 'POST',
    body: JSON.stringify({
      name: 'product',
      display_name: 'Product Wiki',
      path: 'product',
      description: 'Product knowledge',
    }),
  })
  assert.equal(createdNs.response.status, 201)

  const nsDir = join(wikiRoot, 'namespaces', 'product')
  await mkdir(join(nsDir, 'faq'), { recursive: true })
  await writeFile(join(nsDir, 'faq', 'refund.md'), '# Refund Policy\n\nRefunds are available within 7 days.\n')

  const search = await requestJson('/api/wiki/product/search?q=refund')
  assert.equal(search.response.status, 200)
  assert.equal(search.body.results.length, 1)
  assert.equal(search.body.results[0].path, 'faq\\refund.md')

  const filePath = encodeURI(search.body.results[0].path)
  const file = await requestJson(`/api/wiki/product/files/${filePath}`)
  assert.equal(file.response.status, 200)
  assert.match(file.body.content, /Refund Policy/)
  assert.equal(typeof file.body.updatedAt, 'number')

  const bot = await createBot('wiki-bot')
  const ctx = await ContextRepository.create({
    botId: bot.id,
    name: 'Knowledge Context',
    systemPrompt: 'Use knowledge.',
    mcpConfigs: [],
    skillConfigs: [],
    sessionTtlMin: 30,
    isDefault: false,
  })
  const disabledMcp = await McpServerRepository.create({
    botId: null,
    name: 'wiki-mcp-disabled',
    url: 'http://localhost:3001/sse',
    transportType: 'sse',
    enabled: false,
    paramSchema: [],
  })
  const disabledBinding = await requestJson('/api/wiki/product/bindings', {
    method: 'POST',
    body: JSON.stringify({
      botId: bot.id,
      contextId: ctx.id,
      mcpServerId: disabledMcp.id,
      policy: 'autoSearch',
    }),
  })
  assert.equal(disabledBinding.response.status, 400)
  assert.equal(disabledBinding.body.error, 'wiki-mcp server is disabled')

  const mcp = await McpServerRepository.create({
    botId: null,
    name: 'wiki-mcp',
    url: 'http://localhost:3001/sse',
    transportType: 'sse',
    enabled: true,
    paramSchema: [],
  })

  const binding = await requestJson('/api/wiki/product/bindings', {
    method: 'POST',
    body: JSON.stringify({
      botId: bot.id,
      contextId: ctx.id,
      mcpServerId: mcp.id,
      policy: 'autoSearch',
    }),
  })
  assert.equal(binding.response.status, 201)
  assert.equal(binding.body.mcpConfigs[0].params.namespace, 'product')
  assert.equal(binding.body.mcpConfigs[0].params.retrievalPolicy, 'autoSearch')

  const bindings = await requestJson('/api/wiki/product/bindings')
  assert.equal(bindings.response.status, 200)
  assert.equal(bindings.body.length, 1)
  assert.equal(bindings.body[0].contextName, 'Knowledge Context')

  const health = await requestJson('/api/wiki/product/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.body.fileCount, 1)
  assert.equal(health.body.bindingCount, 1)

  const draft = await requestJson('/api/wiki/product/drafts', {
    method: 'POST',
    body: JSON.stringify({
      targetPath: 'faq/new-answer.md',
      content: '## New answer\n\nA reviewed answer.',
      sourceType: 'test',
      sourceRef: 'case-1',
    }),
  })
  assert.equal(draft.response.status, 201)
  assert.equal(draft.body.status, 'pending')

  const approved = await requestJson(`/api/wiki/product/drafts/${draft.body.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewedBy: 'tester' }) })
  assert.equal(approved.response.status, 200)
  assert.equal(approved.body.status, 'merged')

  const approvedFile = await requestJson('/api/wiki/product/files/faq/new-answer.md')
  assert.equal(approvedFile.response.status, 200)
  assert.match(approvedFile.body.content, /A reviewed answer/)
})
