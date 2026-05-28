import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-api-data-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.DEFAULT_SESSION_TTL_MIN = '30'

const [
  { db, initDb },
  { BotRepository },
  { ContextRepository },
  {
    ActiveContextRepository,
    AuditLogRepository,
    CommandConfirmationRepository,
    CommandPermissionRepository,
    ContextAccessRepository,
    WecomUserRepository,
  },
  { GeneratedFileRepository, GenerationTaskRepository, ModelConfigRepository },
] = await Promise.all([
  import('./client.js'),
  import('./bot-repository.js'),
  import('./context-repository.js'),
  import('./wecom-access-repository.js'),
  import('./generation-repository.js'),
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

async function createContext(botId: string, name: string) {
  return ContextRepository.create({
    botId,
    name,
    systemPrompt: `Prompt for ${name}`,
    mcpConfigs: [],
    skillConfigs: [],
    sessionTtlMin: 30,
    isDefault: false,
  })
}

test('initDb creates new tables idempotently', async () => {
  await initDb()

  const res = await db.execute({
    sql: `SELECT name FROM sqlite_master
          WHERE type = 'table'
            AND name IN (
              'wecom_users',
              'context_access_grants',
              'active_contexts',
              'command_permissions',
              'command_confirmations',
              'audit_logs',
              'model_configs',
              'generation_tasks',
              'generated_files'
            )`,
    args: [],
  })
  const tableNames = new Set(res.rows.map((row) => row.name))

  assert.equal(tableNames.size, 9)
  assert.ok(tableNames.has('wecom_users'))
  assert.ok(tableNames.has('generated_files'))
})

test('WeCom access repositories enforce scoped permissions and lifecycle rules', async () => {
  const bot = await createBot('access-bot')
  const firstContext = await createContext(bot.id, 'First')
  const secondContext = await createContext(bot.id, 'Second')

  const user = await WecomUserRepository.upsert({
    botId: bot.id,
    wecomUserId: 'zhangsan',
    displayName: 'Zhang San',
    role: 'user',
  })
  const updatedUser = await WecomUserRepository.upsert({
    botId: bot.id,
    wecomUserId: 'zhangsan',
    displayName: 'Zhang Manager',
    role: 'manager',
  })
  assert.equal(updatedUser.id, user.id)
  assert.equal(updatedUser.role, 'manager')

  const grant = await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: firstContext.id,
    wecomUserId: 'zhangsan',
    grantedBy: 'admin',
  })
  assert.equal(await ContextAccessRepository.hasAccess(bot.id, 'zhangsan', firstContext.id), true)

  await ContextAccessRepository.deleteGrant(bot.id, firstContext.id, 'zhangsan')
  assert.equal(await ContextAccessRepository.hasAccess(bot.id, 'zhangsan', firstContext.id), false)

  const regrant = await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: firstContext.id,
    wecomUserId: 'zhangsan',
    accessLevel: 'manage',
  })
  assert.notEqual(regrant.id, grant.id)
  assert.equal(regrant.status, 'active')
  assert.equal(regrant.accessLevel, 'manage')

  await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: secondContext.id,
    wecomUserId: 'zhangsan',
    expiresAt: Date.now() - 1000,
  })
  assert.equal(await ContextAccessRepository.hasAccess(bot.id, 'zhangsan', secondContext.id), false)
  assert.deepEqual((await ContextAccessRepository.listByUser(bot.id, 'zhangsan')).map((item) => item.contextId), [firstContext.id])

  const active = await ActiveContextRepository.set({
    botId: bot.id,
    chatKey: 'chat-1',
    wecomUserId: 'zhangsan',
    contextId: firstContext.id,
    activatedBy: 'zhangsan',
  })
  const updatedActive = await ActiveContextRepository.set({
    botId: bot.id,
    chatKey: 'chat-1',
    wecomUserId: 'zhangsan',
    contextId: secondContext.id,
    activatedBy: 'zhangsan',
  })
  assert.equal(updatedActive.id, active.id)
  assert.equal((await ActiveContextRepository.findForUser(bot.id, 'chat-1', 'zhangsan'))?.contextId, secondContext.id)

  await ActiveContextRepository.clear(bot.id, 'chat-1', 'zhangsan')
  assert.equal(await ActiveContextRepository.findForUser(bot.id, 'chat-1', 'zhangsan'), null)

  const permission = await CommandPermissionRepository.set({
    botId: bot.id,
    commandKey: 'ctx.use',
    role: 'manager',
    enabled: false,
  })
  const updatedPermission = await CommandPermissionRepository.set({
    botId: bot.id,
    commandKey: 'ctx.use',
    role: 'manager',
    enabled: true,
    requireConfirm: true,
  })
  assert.equal(updatedPermission.id, permission.id)
  assert.deepEqual(await CommandPermissionRepository.check(bot.id, 'ctx.use', 'manager'), {
    allowed: true,
    requireConfirm: true,
  })

  const confirmation = await CommandConfirmationRepository.create({
    botId: bot.id,
    chatKey: 'chat-1',
    chatId: 'chat-id',
    wecomUserId: 'zhangsan',
    commandKey: 'ctx.use',
    payload: { contextId: firstContext.id },
  })
  assert.equal((await CommandConfirmationRepository.consume(confirmation.token, 'other-user')).error, 'actor_mismatch')
  assert.equal((await CommandConfirmationRepository.consume(confirmation.token, 'zhangsan')).confirmation?.consumedAt !== null, true)
  assert.equal((await CommandConfirmationRepository.consume(confirmation.token, 'zhangsan')).error, 'consumed')

  const audit = await AuditLogRepository.create({
    botId: bot.id,
    actorUserId: 'zhangsan',
    chatKey: 'chat-1',
    action: 'ctx.use',
    targetType: 'context',
    targetId: firstContext.id,
    result: 'success',
    payload: { source: 'test' },
  })
  assert.equal(audit.result, 'success')
  assert.equal((await AuditLogRepository.list(1))[0].id, audit.id)
})

test('generation repositories track model configs, tasks, files, ownership, and expiry', async () => {
  const bot = await createBot('generation-bot')
  const context = await createContext(bot.id, 'Creative')

  await ModelConfigRepository.create({
    name: 'Global image model',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    enabled: true,
  })
  const botModel = await ModelConfigRepository.create({
    botId: bot.id,
    name: 'Bot image model',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    baseUrl: 'https://image.example.invalid/v1',
    apiKey: 'secret',
    defaultParams: { size: '1024x1024' },
    enabled: true,
    timeoutMs: 120000,
    quotaPerUserDaily: 5,
    maxConcurrent: 2,
  })
  assert.equal((await ModelConfigRepository.findEnabledByCapability(bot.id, 'image_generation'))?.id, botModel.id)

  const updatedModel = await ModelConfigRepository.update(botModel.id, {
    enabled: false,
    defaultParams: { size: '512x512' },
  })
  assert.equal(updatedModel?.enabled, false)
  assert.equal(updatedModel?.defaultParams.size, '512x512')

  const task = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'image',
    ownerUserId: 'zhangsan',
    chatKey: 'chat-1',
    chatId: 'chat-id',
    contextId: context.id,
    modelId: botModel.id,
    inputPayload: { prompt: 'a diagram' },
    previewSummary: 'a diagram',
  })
  assert.equal(task.status, 'pending')
  assert.equal(task.previewSummary, 'a diagram')
  assert.equal((await GenerationTaskRepository.listByOwner(bot.id, 'other-user')).length, 0)
  assert.equal((await GenerationTaskRepository.listRunnable(10, ['image'])).some((item) => item.id === task.id), true)

  const running = await GenerationTaskRepository.markRunning(task.id)
  assert.equal(running?.status, 'running')
  assert.ok(running?.startedAt)

  const file = await GeneratedFileRepository.create({
    taskId: task.id,
    botId: bot.id,
    ownerUserId: 'zhangsan',
    chatKey: 'chat-1',
    fileType: 'image',
    storagePath: '/tmp/result.png',
    mimeType: 'image/png',
    sizeBytes: 128,
    expiresAt: Date.now() + 60_000,
  })
  assert.equal((await GeneratedFileRepository.findByAccessToken(file.accessToken))?.id, file.id)
  assert.equal((await GeneratedFileRepository.listByTask(task.id))[0].id, file.id)

  const withFile = await GenerationTaskRepository.appendOutputFile(task.id, file.id)
  assert.deepEqual(withFile?.outputFileIds, [file.id])

  const succeeded = await GenerationTaskRepository.markSucceeded(task.id, [file.id], 0.12)
  assert.equal(succeeded?.status, 'succeeded')
  assert.equal(succeeded?.cost, 0.12)

  assert.equal(await GenerationTaskRepository.canAccess(task.id, 'zhangsan', 'user'), true)
  assert.equal(await GenerationTaskRepository.canAccess(task.id, 'lisi', 'user'), false)
  assert.equal(await GenerationTaskRepository.canAccess(task.id, 'lisi', 'manager'), true)
  assert.equal(await GeneratedFileRepository.canAccess(file.id, 'lisi', 'user'), false)
  assert.equal(await GeneratedFileRepository.canAccess(file.id, 'lisi', 'admin'), true)

  const failedTask = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'ppt',
    ownerUserId: 'zhangsan',
    chatKey: 'chat-1',
    chatId: 'chat-id',
    inputPayload: { title: 'Quarterly review' },
  })
  const failed = await GenerationTaskRepository.markFailed(failedTask.id, 'model unavailable')
  assert.equal(failed?.status, 'failed')
  assert.equal(failed?.error, 'model unavailable')

  const expiredFile = await GeneratedFileRepository.create({
    botId: bot.id,
    ownerUserId: 'zhangsan',
    chatKey: 'chat-1',
    fileType: 'image',
    storagePath: '/tmp/expired.png',
    accessToken: 'expired-token',
    expiresAt: Date.now() - 1000,
  })
  assert.equal(await GeneratedFileRepository.findByAccessToken('expired-token'), null)
  assert.equal((await GeneratedFileRepository.listExpired()).some((item) => item.id === expiredFile.id), true)
  assert.equal(await GeneratedFileRepository.deleteExpired(), 1)
  assert.equal(await GeneratedFileRepository.findById(expiredFile.id), null)
})
