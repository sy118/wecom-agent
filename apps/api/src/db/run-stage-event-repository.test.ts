import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-run-stage-'))
process.env.DB_PATH = join(tempDir, 'run-stage-test.db')

const [{ db, initDb }, { RunStageEventRepository }, { BotResponseRunRepository }, { BotRepository }] = await Promise.all([
  import('../db/client.js'),
  import('../db/run-stage-event-repository.js'),
  import('../db/bot-response-run-repository.js'),
  import('../db/bot-repository.js'),
])

await initDb()

after(async () => {
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

test('RunStageEventRepository persists stage events in order', async () => {
  const bot = await BotRepository.create({
    name: 'run-stage-bot-1',
    wecomBotId: 'run-stage-wecom-1',
    wecomBotSecret: 'secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'test-model',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
  const created = await BotResponseRunRepository.create({
    botId: bot.id,
    chatKey: 'wecom:user:u1',
    chatId: 'u1',
    userId: 'u1',
    questionPreview: 'hello',
    provider: 'openai-compatible',
    feedbackAvailable: true,
  })

  await RunStageEventRepository.create({ runId: created.id, stage: 'queued', sequence: 1, startedAt: 1000 })
  await RunStageEventRepository.create({ runId: created.id, stage: 'model', sequence: 2, startedAt: 2000 })
  await RunStageEventRepository.end(created.id, 'model', 4000)

  const events = await RunStageEventRepository.findByRunId(created.id)
  assert.equal(events.length, 2)
  assert.equal(events[0].stage, 'queued')
  assert.equal(events[1].stage, 'model')
  assert.equal(events[1].durationMs, 2000)
  assert.equal(events[1].endedAt, 4000)
})

test('updateStallPoint persists stall_point and last_activity_at', async () => {
  const bot = await BotRepository.create({
    name: 'run-stage-bot-2',
    wecomBotId: 'run-stage-wecom-2',
    wecomBotSecret: 'secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'test-model',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
  const created = await BotResponseRunRepository.create({
    botId: bot.id,
    chatKey: 'wecom:user:u2',
    chatId: 'u2',
    userId: 'u2',
    questionPreview: 'hi',
    provider: 'openai-compatible',
    feedbackAvailable: true,
  })
  const updated = await BotResponseRunRepository.updateStallPoint(created.id, 'force-call-mcp')
  assert.equal(updated?.stallPoint, 'force-call-mcp')
  assert.ok(updated?.lastActivityAt)
  assert.ok(updated.lastActivityAt! >= updated.createdAt)
})
