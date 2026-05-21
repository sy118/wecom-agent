import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'
import { simpleGit } from 'simple-git'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-api-wiki-'))
const parentRepoRoot = join(tempDir, 'repo')
const wikiRoot = join(parentRepoRoot, 'apps', 'api', 'data', 'wiki')
process.env.DB_PATH = join(tempDir, 'wiki-test.db')
process.env.WIKI_ROOT = wikiRoot
process.env.WIKI_MCP_URL = 'http://127.0.0.1:1'

const [
  { db, initDb },
  { BotRepository },
  { ContextRepository },
  { McpServerRepository },
  { WikiRetrievalLogRepository },
  { wikiRouter },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/context-repository.js'),
  import('../db/mcp-server-repository.js'),
  import('../db/wiki-retrieval-log-repository.js'),
  import('./wiki.js'),
])

let server: Server
let baseUrl = ''

before(async () => {
  await mkdir(parentRepoRoot, { recursive: true })
  const parentGit = simpleGit(parentRepoRoot)
  await parentGit.init()
  await parentGit.addConfig('user.email', 'test@example.invalid')
  await parentGit.addConfig('user.name', 'Test User')
  await writeFile(join(parentRepoRoot, '.gitignore'), 'data/\n')
  await parentGit.add('.gitignore')
  await parentGit.commit('init parent repo')

  await mkdir(wikiRoot, { recursive: true })
  await writeFile(join(wikiRoot, 'README.md'), '# Wiki\n')

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
  assert.equal(health.body.pendingDraftCount, 0)

  await WikiRetrievalLogRepository.create({
    botId: bot.id,
    contextId: ctx.id,
    chatKey: 'wecom:group:test',
    namespace: 'product',
    policy: 'autoSearch',
    query: 'refund policy',
    hitCount: 1,
    hitPaths: ['faq/refund.md'],
    durationMs: 12,
  })
  await WikiRetrievalLogRepository.create({
    botId: bot.id,
    contextId: ctx.id,
    chatKey: 'wecom:group:test',
    namespace: 'product',
    policy: 'autoSearch',
    query: 'missing answer',
    hitCount: 0,
    hitPaths: [],
    durationMs: 9,
  })

  const logs = await requestJson('/api/wiki/product/retrieval-logs')
  assert.equal(logs.response.status, 200)
  assert.equal(logs.body.logs.length >= 2, true)

  const misses = await requestJson('/api/wiki/product/misses')
  assert.equal(misses.response.status, 200)
  assert.equal(misses.body.misses.some((item: any) => item.query === 'missing answer' && item.count === 1), true)

  const metrics = await requestJson('/api/wiki/product/metrics')
  assert.equal(metrics.response.status, 200)
  assert.equal(metrics.body.retrievalCount >= 2, true)
  assert.equal(metrics.body.missCount >= 1, true)
  assert.equal(metrics.body.hotDocuments.some((item: any) => item.path === 'faq/refund.md'), true)

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
  assert.equal(draft.body.mergeStrategy, 'append')

  const edited = await requestJson(`/api/wiki/product/drafts/${draft.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      targetPath: 'faq/new-answer.md',
      content: '## New answer\n\nAn edited reviewed answer.',
      mergeStrategy: 'replace',
    }),
  })
  assert.equal(edited.response.status, 200)
  assert.equal(edited.body.mergeStrategy, 'replace')
  assert.match(edited.body.content, /edited/)

  const diff = await requestJson(`/api/wiki/product/drafts/${draft.body.id}/diff?strategy=replace`)
  assert.equal(diff.response.status, 200)
  assert.equal(diff.body.targetExists, false)
  assert.equal(diff.body.strategy, 'replace')

  const approved = await requestJson(`/api/wiki/product/drafts/${draft.body.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewedBy: 'tester', mergeStrategy: 'replace' }) })
  assert.equal(approved.response.status, 200)
  assert.equal(approved.body.status, 'merged')

  const approvedFile = await requestJson('/api/wiki/product/files/faq/new-answer.md')
  assert.equal(approvedFile.response.status, 200)
  assert.match(approvedFile.body.content, /edited reviewed answer/)
  const wikiGit = simpleGit(wikiRoot)
  assert.equal(normalize(await wikiGit.revparse(['--show-toplevel'])), normalize(wikiRoot))

  const createOnlyDraft = await requestJson('/api/wiki/product/drafts', {
    method: 'POST',
    body: JSON.stringify({
      targetPath: 'faq/new-answer.md',
      content: 'Should not overwrite',
      sourceType: 'test',
      mergeStrategy: 'createOnly',
    }),
  })
  const rejectedCreateOnly = await requestJson(`/api/wiki/product/drafts/${createOnlyDraft.body.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ mergeStrategy: 'createOnly' }),
  })
  assert.equal(rejectedCreateOnly.response.status, 409)
})
