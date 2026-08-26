import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-media-maint-'))
process.env.DB_PATH = join(tempDir, 'maint-test.db')
process.env.WECOM_MEDIA_ROOT = join(tempDir, 'media')
process.env.WECOM_MEDIA_RETENTION_MS = '0'
process.env.WECOM_MEDIA_QUOTA_BYTES = String(1024 * 1024)
process.env.WECOM_MEDIA_RETRY_WINDOW_MS = '240000'

const [{ db, initDb }, { BotRepository }, { WecomMediaRepository }, maintenance] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/wecom-media-repository.js'),
  import('../services/media-maintenance-service.js'),
])
const { migrateHistoricalMedia, cleanupExpiredMedia, __testIsWecomUrl } = maintenance as typeof maintenance & {
  __testIsWecomUrl: (url: string) => boolean
}

await initDb()

after(async () => {
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function seedBotAndSession(sessionId: string) {
  const bot = await BotRepository.create({
    name: `maint-${sessionId}`,
    wecomBotId: `wecom-${sessionId}`,
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
    args: [sessionId, bot.id, `wecom:user:${sessionId}`, 'ctx-1', Date.now(), Date.now() + 60_000],
  })
  return bot
}

function fakeService() {
  return {
    enqueue: async () => ({ mediaId: 'wecom_fake_123', dataUrl: null, status: 'pending' }),
  } as unknown as import('../services/media-download-service.js').MediaDownloadService
}

test('isWecomUrl detects WeCom image hosts and skips data URLs', () => {
  assert.equal(__testIsWecomUrl('https://wework.qpic.cn/wwpic/abc'), true)
  assert.equal(__testIsWecomUrl('data:image/jpeg;base64,xxx'), false)
  assert.equal(__testIsWecomUrl(''), false)
})

test('migrateHistoricalMedia marks expired URLs and replaces fresh URLs with media refs', async () => {
  await seedBotAndSession('maint-session-1')
  await db.execute({
    sql: `INSERT INTO session_messages (id, session_id, role, content, timestamp) VALUES (?, ?, 'human', ?, ?)`,
    args: [
      'maint-msg-old',
      'maint-session-1',
      JSON.stringify([
        { type: 'text', text: '[图片]' },
        { type: 'image', url: 'https://wework.qpic.cn/wwpic/old-expired' },
      ]),
      Date.now() - 10 * 60 * 1000,
    ],
  })
  await db.execute({
    sql: `INSERT INTO session_messages (id, session_id, role, content, timestamp) VALUES (?, ?, 'human', ?, ?)`,
    args: [
      'maint-msg-fresh',
      'maint-session-1',
      JSON.stringify([{ type: 'image', url: 'https://wework.qpic.cn/wwpic/fresh' }]),
      Date.now(),
    ],
  })

  const report = await migrateHistoricalMedia(fakeService())
  assert.equal(report.scanned, 2)
  assert.equal(report.expired, 1)
  assert.equal(report.migrated, 1)

  const oldRow = (await db.execute({ sql: 'SELECT content FROM session_messages WHERE id = ?', args: ['maint-msg-old'] })).rows[0]
  const oldItems = JSON.parse(oldRow.content as string)
  assert.equal(oldItems[1].type, 'media')
  assert.equal(oldItems[1].status, 'expired')

  const freshRow = (await db.execute({ sql: 'SELECT content FROM session_messages WHERE id = ?', args: ['maint-msg-fresh'] })).rows[0]
  const freshItems = JSON.parse(freshRow.content as string)
  assert.equal(freshItems[0].type, 'media')
  assert.equal(freshItems[0].kind, 'image')
})

test('cleanupExpiredMedia marks pending expired and deletes unreferenced ready media', async () => {
  const media = await WecomMediaRepository.create({
    kind: 'image',
    storage: 'local',
    storageKey: 'wecom_cleanup_1',
    expiresAt: 1000,
  })
  await WecomMediaRepository.markReady(media.id, { mime: 'image/jpeg', sizeBytes: 10, sha256: 'sha', storageKey: 'wecom_cleanup_1.jpg' })
  const pending = await WecomMediaRepository.create({
    kind: 'file',
    storage: 'local',
    storageKey: 'wecom_cleanup_pending',
    expiresAt: 1000,
  })

  const report = await cleanupExpiredMedia()
  assert.equal(report.expired, 1)
  assert.equal(report.deleted, 1)
  assert.equal((await WecomMediaRepository.findById(pending.id))?.status, 'expired')
  assert.equal(await WecomMediaRepository.findById(media.id), null)
})
