import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-media-repo-'))
process.env.DB_PATH = join(tempDir, 'media-repo-test.db')

const [{ db, initDb }, { WecomMediaRepository }, { BotRepository }] = await Promise.all([
  import('../db/client.js'),
  import('../db/wecom-media-repository.js'),
  import('../db/bot-repository.js'),
])

await initDb()

after(async () => {
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

test('WecomMediaRepository create -> pending -> ready -> expired lifecycle', async () => {
  const media = await WecomMediaRepository.create({
    kind: 'image',
    storage: 'local',
    storageKey: 'wecom_abc123',
    sourceMessageId: 'msg-1',
    sessionId: 'session-1',
    expiresAt: Date.now() + 240_000,
  })
  assert.equal(media.status, 'pending')
  assert.equal(media.kind, 'image')

  const found = await WecomMediaRepository.findById(media.id)
  assert.equal(found?.sourceMessageId, 'msg-1')

  await WecomMediaRepository.markReady(media.id, { mime: 'image/jpeg', sizeBytes: 123, sha256: 'sha', storageKey: 'wecom_abc123.jpg' })
  const ready = await WecomMediaRepository.findById(media.id)
  assert.equal(ready?.status, 'ready')
  assert.equal(ready?.mime, 'image/jpeg')
  assert.equal(ready?.expiresAt, null)

  await WecomMediaRepository.markExpired(media.id)
  const expired = await WecomMediaRepository.findById(media.id)
  assert.equal(expired?.status, 'expired')
})

test('WecomMediaRepository find by source message / session and link session', async () => {
  const media = await WecomMediaRepository.create({
    kind: 'file',
    storage: 'local',
    storageKey: 'wecom_file_1',
    sourceMessageId: 'msg-2',
    expiresAt: Date.now() + 240_000,
  })
  const bySource = await WecomMediaRepository.findBySourceMessage('msg-2')
  assert.equal(bySource?.id, media.id)

  await WecomMediaRepository.linkSessionBySourceMessage('msg-2', 'session-2')
  const linked = await WecomMediaRepository.findById(media.id)
  assert.equal(linked?.sessionId, 'session-2')

  const bySession = await WecomMediaRepository.findBySession('session-2')
  assert.equal(bySession.length, 1)
})

test('WecomMediaRepository pending expiry detection and reference counting', async () => {
  const media = await WecomMediaRepository.create({
    kind: 'video',
    storage: 'local',
    storageKey: 'wecom_video_1',
    sourceMessageId: 'msg-3',
    expiresAt: 1000, // already expired
  })
  const pendingExpired = await WecomMediaRepository.findPendingExpired(Date.now())
  assert.ok(pendingExpired.some((m) => m.id === media.id))

  assert.equal(await WecomMediaRepository.countReferences('wecom_video_1'), 0)
  const bot = await BotRepository.create({
    name: 'media-test-bot',
    wecomBotId: 'media-wecom-bot',
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
  await db.execute({
    sql: `INSERT INTO sessions (id, bot_id, chat_key, context_id, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ['s1', bot.id, 'wecom:user:u1', 'ctx-1', Date.now(), Date.now() + 60_000],
  })
  await db.execute({
    sql: `INSERT INTO session_messages (id, session_id, role, content, timestamp) VALUES (?, ?, 'human', ?, ?)`,
    args: ['sm-1', 's1', JSON.stringify([{ type: 'media', mediaId: 'wecom_video_1', kind: 'video' }]), Date.now()],
  })
  assert.equal(await WecomMediaRepository.countReferences('wecom_video_1'), 1)
})
