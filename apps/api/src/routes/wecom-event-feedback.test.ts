import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'
import { simpleGit } from 'simple-git'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-event-feedback-'))
const wikiRoot = join(tempDir, 'wiki')
process.env.DB_PATH = join(tempDir, 'event-feedback-test.db')
process.env.WIKI_ROOT = wikiRoot
process.env.WIKI_MCP_URL = 'http://127.0.0.1:1'

const [
  { db, initDb },
  { BotRepository },
  { ContextRepository },
  { BotResponseRunRepository },
  { WikiRetrievalLogRepository },
  { WikiFeedbackRepository },
  { WecomEventRepository },
  { handleIncomingWecomEvent },
  { wikiRouter },
  { wecomEventsRouter },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/context-repository.js'),
  import('../db/bot-response-run-repository.js'),
  import('../db/wiki-retrieval-log-repository.js'),
  import('../db/wiki-feedback-repository.js'),
  import('../db/wecom-event-repository.js'),
  import('../services/wecom-event-service.js'),
  import('./wiki.js'),
  import('./wecom-events.js'),
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
  app.use('/api/wecom/events', express.raw({ type: '*/*', limit: '2mb' }), wecomEventsRouter)
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

test('WeCom feedback event links response run, drafts Wiki knowledge, and creates annotation answer', async () => {
  const ns = await requestJson('/api/wiki/namespaces', {
    method: 'POST',
    body: JSON.stringify({
      name: 'feedback-product',
      display_name: 'Feedback Product',
      path: 'feedback-product',
    }),
  })
  assert.equal(ns.response.status, 201)

  const bot = await BotRepository.create({
    name: 'feedback-bot',
    wecomBotId: 'aibot-1',
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
  const context = await ContextRepository.create({
    botId: bot.id,
    name: 'Feedback Context',
    systemPrompt: 'Use Wiki.',
    mcpConfigs: [{ mcpServerId: 'wiki-mcp', enabled: true, params: { namespace: 'feedback-product', retrievalPolicy: 'autoSearch' } }],
    skillConfigs: [],
    sessionTtlMin: 30,
    isDefault: true,
  })
  const run = await BotResponseRunRepository.create({
    feedbackId: 'feedback-id-1',
    botId: bot.id,
    contextId: context.id,
    sessionId: 'session-1',
    chatKey: 'wecom:group:chat-1',
    chatId: 'chat-1',
    userId: 'user-1',
    questionPreview: '退款规则是什么？',
    provider: 'openai-compatible',
    model: 'test-model',
  })
  await BotResponseRunRepository.markSent(run.id, '原回答：7 天内可退。')
  await WikiRetrievalLogRepository.create({
    botId: bot.id,
    contextId: context.id,
    chatKey: 'wecom:group:chat-1',
    responseRunId: run.id,
    namespace: 'feedback-product',
    policy: 'autoSearch',
    query: '退款规则是什么？',
    hitCount: 0,
    hitPaths: [],
    durationMs: 8,
  })

  const event = {
    msgId: 'event-feedback-1',
    eventType: 'feedback_event',
    aibotId: 'aibot-1',
    chatId: 'chat-1',
    chatKey: 'wecom:group:chat-1',
    chatType: 'group' as const,
    userId: 'user-1',
    corpid: null,
    responseUrl: null,
    createTime: 1700000000,
    eventPayload: {
      eventtype: 'feedback_event',
      feedback_event: { id: 'feedback-id-1', type: 2, content: '缺少特殊商品说明', inaccurate_reason_list: [2] },
    },
    rawBody: { msgtype: 'event' },
  }

  const first = await handleIncomingWecomEvent(event, { botId: bot.id, contexts: [context] })
  const duplicate = await handleIncomingWecomEvent(event, { botId: bot.id, contexts: [context] })
  assert.equal(first.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(first.feedbackItem?.responseRunId, run.id)
  assert.equal(first.feedbackItem?.classification, 'knowledge_gap')
  assert.equal((await WecomEventRepository.findByMsgId('event-feedback-1'))?.status, 'processed')

  const list = await requestJson('/api/wiki/feedback-product/feedback?reason=2')
  assert.equal(list.response.status, 200)
  assert.equal(list.body.items.length, 1)
  assert.equal(list.body.items[0].responseRun.id, run.id)

  const detail = await requestJson(`/api/wiki/feedback-product/feedback/${first.feedbackItem!.id}`)
  assert.equal(detail.response.status, 200)
  assert.equal(detail.body.evidence.retrievalLogs[0].responseRunId, run.id)

  const draft = await requestJson(`/api/wiki/feedback-product/feedback/${first.feedbackItem!.id}/draft`, {
    method: 'POST',
    body: JSON.stringify({ targetPath: 'feedback/refund.md' }),
  })
  assert.equal(draft.response.status, 201)
  assert.equal(draft.body.sourceRef, `feedback:${first.feedbackItem!.id};run:${run.id}`)

  const draftedList = await requestJson('/api/wiki/feedback-product/feedback?status=drafted')
  assert.equal(draftedList.response.status, 200)
  assert.equal(draftedList.body.items.length, 1)
  assert.equal(draftedList.body.items[0].draftId, draft.body.id)

  const draftedMetrics = await requestJson('/api/wiki/feedback-product/feedback/metrics')
  assert.equal(draftedMetrics.response.status, 200)
  assert.equal(draftedMetrics.body.metrics.drafted, 1)
  assert.equal(draftedMetrics.body.metrics.pending, 0)

  const approved = await requestJson(`/api/wiki/feedback-product/drafts/${draft.body.id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ reviewedBy: 'tester' }),
  })
  assert.equal(approved.response.status, 200)

  const resolved = await WikiFeedbackRepository.findById(first.feedbackItem!.id)
  assert.equal(resolved?.status, 'resolved')

  const resolvedMetrics = await requestJson('/api/wiki/feedback-product/feedback/metrics')
  assert.equal(resolvedMetrics.response.status, 200)
  assert.equal(resolvedMetrics.body.metrics.drafted, 0)
  assert.equal(resolvedMetrics.body.metrics.pending, 0)

  const annotation = await requestJson(`/api/wiki/feedback-product/annotation-answers/from-feedback/${first.feedbackItem!.id}`, {
    method: 'POST',
    body: JSON.stringify({ answer: '审核答案：特殊商品按页面说明执行。' }),
  })
  assert.equal(annotation.response.status, 201)
  assert.equal(annotation.body.sourceRef, first.feedbackItem!.id)

  const callback = await requestJson(`/api/wecom/events/${bot.id}`, {
    method: 'POST',
    body: JSON.stringify({
      msgid: 'event-enter-1',
      msgtype: 'event',
      aibotid: 'aibot-1',
      from: { userid: 'user-1' },
      event: { eventtype: 'enter_chat' },
    }),
  })
  assert.equal(callback.response.status, 200)
  assert.deepEqual(callback.body, {})
})
