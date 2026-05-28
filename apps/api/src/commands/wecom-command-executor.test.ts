import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-command-executor-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.DEFAULT_SESSION_TTL_MIN = '30'

const [
  { db, initDb },
  { BotRepository },
  {
    AuditLogRepository,
    CommandConfirmationRepository,
    ContextAccessRepository,
    WecomUserRepository,
  },
  { parseWecomCommand },
  { WecomCommandExecutor },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/wecom-access-repository.js'),
  import('./wecom-command-parser.js'),
  import('./wecom-command-executor.js'),
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

function runtime(botId: string, userId = 'zhangsan') {
  return {
    botId,
    chatKey: 'chat-1',
    chatId: 'chat-id',
    userId,
  }
}

test('WecomCommandExecutor returns role-filtered help and writes success audit', async () => {
  const bot = await createBot('help-bot')
  const executor = new WecomCommandExecutor()
  const result = await executor.execute(parseWecomCommand('/help')!, runtime(bot.id))

  assert.equal(result.ok, true)
  assert.match(result.message, /\/ctx current/)
  assert.doesNotMatch(result.message, /\/admin ctx grant/)

  const latest = (await AuditLogRepository.list(1))[0]
  assert.equal(latest.action, 'help')
  assert.equal(latest.result, 'success')
})

test('WecomCommandExecutor rejects unknown, argument errors, disabled users, and unauthorized commands', async () => {
  const bot = await createBot('reject-bot')
  const executor = new WecomCommandExecutor()

  const unknown = await executor.execute(parseWecomCommand('/wat')!, runtime(bot.id))
  assert.equal(unknown.status, 'unknown_command')

  const missingArg = await executor.execute(parseWecomCommand('/ctx use')!, runtime(bot.id))
  assert.equal(missingArg.status, 'argument_error')
  assert.match(missingArg.message, /\/ctx use <contextId\|contextName>/)

  const adminDenied = await executor.execute(parseWecomCommand('/admin ctx grant user-a ctx-a')!, runtime(bot.id))
  assert.equal(adminDenied.status, 'permission_denied')

  await WecomUserRepository.upsert({
    botId: bot.id,
    wecomUserId: 'disabled-user',
    role: 'admin',
    status: 'disabled',
  })
  const disabled = await executor.execute(parseWecomCommand('/help')!, runtime(bot.id, 'disabled-user'))
  assert.equal(disabled.status, 'permission_denied')

  const audits = await AuditLogRepository.list(10)
  assert.equal(audits.some((audit) => audit.action === 'command.unknown' && audit.result === 'failure'), true)
  assert.equal(audits.some((audit) => audit.action === 'ctx.use' && audit.result === 'failure'), true)
  assert.equal(audits.some((audit) => audit.action === 'admin.ctx.grant' && audit.result === 'denied'), true)
})

test('WecomCommandExecutor creates confirmation tokens for admin commands without applying changes', async () => {
  const bot = await createBot('confirm-bot')
  await WecomUserRepository.upsert({
    botId: bot.id,
    wecomUserId: 'admin-user',
    role: 'admin',
  })

  const executor = new WecomCommandExecutor()
  const result = await executor.execute(parseWecomCommand('/admin ctx grant user-a ctx-a')!, runtime(bot.id, 'admin-user'))

  assert.equal(result.status, 'confirmation_required')
  assert.match(result.message, /\/confirm [a-f0-9]+/)
  assert.equal((await ContextAccessRepository.listByUser(bot.id, 'user-a')).length, 0)

  const token = result.message.match(/\/confirm ([a-f0-9]+)/)?.[1]
  assert.ok(token)
  assert.equal((await CommandConfirmationRepository.findByToken(token!))?.commandKey, 'admin.ctx.grant')
})

test('WecomCommandExecutor handles expired confirmations', async () => {
  const bot = await createBot('expired-confirm-bot')
  await WecomUserRepository.upsert({
    botId: bot.id,
    wecomUserId: 'admin-user',
    role: 'admin',
  })
  const confirmation = await CommandConfirmationRepository.create({
    botId: bot.id,
    chatKey: 'chat-1',
    chatId: 'chat-id',
    wecomUserId: 'admin-user',
    commandKey: 'admin.ctx.grant',
    payload: { args: ['user-a', 'ctx-a'] },
    ttlMs: -1,
  })

  const executor = new WecomCommandExecutor()
  const result = await executor.execute(parseWecomCommand(`/confirm ${confirmation.token}`)!, runtime(bot.id, 'admin-user'))

  assert.equal(result.status, 'confirmation_error')
  assert.match(result.message, /已过期/)
  const latest = (await AuditLogRepository.list(1))[0]
  assert.equal(latest.action, 'confirm')
  assert.equal(latest.reason, 'expired')
})
