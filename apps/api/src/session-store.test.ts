import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-session-store-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.DEFAULT_SESSION_TTL_MIN = '30'

const [
  { db, initDb },
  { BotRepository },
  { SessionStore },
] = await Promise.all([
  import('./db/client.js'),
  import('./db/bot-repository.js'),
  import('./session-store.js'),
])

before(async () => {
  await initDb()
})

after(async () => {
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function createBot(name: string) {
  return BotRepository.create({
    name,
    wecomBotId: `${name}-wecom-id`,
    wecomBotSecret: 'wecom-secret',
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

test('SessionStore isolates sessions by contextId for one chatKey', async () => {
  const bot = await createBot('session-bot')
  const store = new SessionStore(db as any, bot.id)
  try {
    const chatKey = 'wecom:group:session-isolation'
    const first = await store.getOrCreate(chatKey, 'context-a', 30)
    await store.addMessage(chatKey, { role: 'human', content: 'hello a', timestamp: Date.now() })
    await store.setDifyConversationId(chatKey, 'conversation-a')

    const second = await store.getOrCreate(chatKey, 'context-b', 30)
    assert.notEqual(second.id, first.id)
    assert.equal(second.contextId, 'context-b')
    assert.deepEqual(second.messages, [])
    assert.equal(second.difyConversationId, undefined)

    await store.addMessage(chatKey, { role: 'human', content: 'hello b', timestamp: Date.now() })
    await store.setDifyConversationId(chatKey, 'conversation-b')

    const reloadedSecond = await store.getOrCreate(chatKey, 'context-b', 30)
    assert.equal(reloadedSecond.id, second.id)
    assert.equal(reloadedSecond.messages.length, 1)
    assert.equal(reloadedSecond.difyConversationId, 'conversation-b')

    const reloadedFirst = await store.getOrCreate(chatKey, 'context-a', 30)
    assert.equal(reloadedFirst.id, first.id)
    assert.equal(reloadedFirst.messages.length, 1)
    assert.equal(reloadedFirst.difyConversationId, 'conversation-a')
  } finally {
    store.destroy()
  }
})
