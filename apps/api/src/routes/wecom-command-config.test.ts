import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-command-config-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.DEFAULT_SESSION_TTL_MIN = '30'

const [
  { db, initDb },
  { BotRepository },
  { ContextRepository },
  { ActiveContextRepository, CommandConfirmationRepository, CommandPermissionRepository, ContextAccessRepository, WecomUserRepository },
  { wecomCommandConfigRouter },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/context-repository.js'),
  import('../db/wecom-access-repository.js'),
  import('./wecom-command-config.js'),
])

let server: Server
let baseUrl = ''

before(async () => {
  await initDb()
  const app = express()
  app.use(express.json())
  app.use('/api/bots/:botId/wecom-command-config', wecomCommandConfigRouter)
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

test('WeCom command config API manages users and context ACL', async () => {
  const bot = await createBot('access-api-bot')
  const context = await createContext(bot.id, 'Support')

  const createdUser = await requestJson(`/api/bots/${bot.id}/wecom-command-config/users`, {
    method: 'POST',
    body: JSON.stringify({ wecomUserId: 'user-a', displayName: 'User A', role: 'manager' }),
  })
  assert.equal(createdUser.response.status, 201)
  assert.equal(createdUser.body.role, 'manager')

  const disabledUser = await requestJson(`/api/bots/${bot.id}/wecom-command-config/users/user-a`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'disabled' }),
  })
  assert.equal(disabledUser.response.status, 200)
  assert.equal(disabledUser.body.status, 'disabled')

  const listedUsers = await requestJson(`/api/bots/${bot.id}/wecom-command-config/users`)
  assert.equal(listedUsers.body.some((user: any) => user.wecomUserId === 'user-a'), true)

  const grant = await requestJson(`/api/bots/${bot.id}/wecom-command-config/context-access`, {
    method: 'POST',
    body: JSON.stringify({ wecomUserId: 'user-a', contextId: context.id, accessLevel: 'use' }),
  })
  assert.equal(grant.response.status, 201)
  assert.equal(await ContextAccessRepository.hasAccess(bot.id, 'user-a', context.id), true)

  const grants = await requestJson(`/api/bots/${bot.id}/wecom-command-config/context-access?wecomUserId=user-a`)
  assert.equal(grants.body.length, 1)

  const deletedGrant = await requestJson(`/api/bots/${bot.id}/wecom-command-config/context-access/user-a/${context.id}`, {
    method: 'DELETE',
  })
  assert.equal(deletedGrant.response.status, 204)
  assert.equal(await ContextAccessRepository.hasAccess(bot.id, 'user-a', context.id), false)
  assert.equal((await ContextAccessRepository.listByBot(bot.id)).some((item) => item.wecomUserId === 'user-a' && item.contextId === context.id), false)

  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'delete-me', role: 'user' })
  await ContextAccessRepository.grant({ botId: bot.id, wecomUserId: 'delete-me', contextId: context.id })
  await ActiveContextRepository.set({
    botId: bot.id,
    chatKey: 'wecom:user:delete-me',
    wecomUserId: 'delete-me',
    contextId: context.id,
    activatedBy: 'delete-me',
  })
  const pending = await CommandConfirmationRepository.create({
    botId: bot.id,
    chatKey: 'wecom:user:delete-me',
    chatId: 'delete-me',
    wecomUserId: 'delete-me',
    commandKey: 'ctx.use',
    payload: { contextId: context.id },
  })

  const deleted = await requestJson(`/api/bots/${bot.id}/wecom-command-config/users/delete-me`, {
    method: 'DELETE',
  })
  assert.equal(deleted.response.status, 204)
  assert.equal(await WecomUserRepository.findByWecomUserId(bot.id, 'delete-me'), null)
  assert.equal((await ContextAccessRepository.listByUser(bot.id, 'delete-me')).length, 0)
  assert.equal(await ActiveContextRepository.findForUser(bot.id, 'wecom:user:delete-me', 'delete-me'), null)
  assert.equal(await CommandConfirmationRepository.findByToken(pending.token), null)
})

test('WeCom command config API manages command permissions, feature switches, confirmations, and audit logs', async () => {
  const bot = await createBot('command-api-bot')

  const switches = await requestJson(`/api/bots/${bot.id}/wecom-command-config/feature-switches`, {
    method: 'PUT',
    body: JSON.stringify({
      contextSwitchEnabled: false,
      imageGenerationEnabled: false,
      adminCommandsEnabled: false,
    }),
  })
  assert.equal(switches.response.status, 200)
  assert.equal((await CommandPermissionRepository.check(bot.id, 'ctx.use', 'user')).allowed, false)
  assert.equal((await CommandPermissionRepository.check(bot.id, 'image.generate', 'manager')).allowed, false)
  assert.equal((await CommandPermissionRepository.check(bot.id, 'admin.ctx.grant', 'admin')).allowed, false)

  const permission = await requestJson(`/api/bots/${bot.id}/wecom-command-config/command-permissions`, {
    method: 'PUT',
    body: JSON.stringify({ commandKey: 'ctx.use', role: 'manager', enabled: true, requireConfirm: true }),
  })
  assert.equal(permission.response.status, 200)
  assert.deepEqual(await CommandPermissionRepository.check(bot.id, 'ctx.use', 'manager'), {
    allowed: true,
    requireConfirm: true,
  })

  const confirmation = await requestJson(`/api/bots/${bot.id}/wecom-command-config/confirmations`, {
    method: 'POST',
    body: JSON.stringify({
      chatKey: 'chat-1',
      chatId: 'chat-id',
      wecomUserId: 'manager-user',
      commandKey: 'ctx.use',
      payload: { contextId: 'ctx-a' },
    }),
  })
  assert.equal(confirmation.response.status, 201)

  const consumed = await requestJson(`/api/bots/${bot.id}/wecom-command-config/confirmations/${confirmation.body.token}/consume`, {
    method: 'POST',
    body: JSON.stringify({ wecomUserId: 'manager-user' }),
  })
  assert.equal(consumed.response.status, 200)
  assert.equal(consumed.body.confirmation.consumedAt !== null, true)

  const auditLogs = await requestJson(`/api/bots/${bot.id}/wecom-command-config/audit-logs`)
  assert.equal(auditLogs.response.status, 200)
  assert.equal(auditLogs.body.some((item: any) => item.action === 'admin.command.set'), true)
  assert.equal(auditLogs.body.some((item: any) => item.action === 'admin.feature_switches.update'), true)

  const metrics = await requestJson(`/api/bots/${bot.id}/wecom-command-config/metrics`)
  assert.equal(metrics.response.status, 200)
  assert.equal(metrics.body.commands.total > 0, true)
})

test('WeCom command config API manages image model configs without exposing api keys', async () => {
  const bot = await createBot('model-api-bot')
  const created = await requestJson(`/api/bots/${bot.id}/wecom-command-config/model-configs`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Image model',
      provider: 'openai-compatible-image',
      modelName: 'gpt-image2',
      capability: 'image_generation',
      baseUrl: 'https://image.example.invalid/v1',
      apiKey: 'secret',
      defaultParams: { size: '1024x1024' },
      timeoutMs: 120000,
      quotaPerUserDaily: 5,
      maxConcurrent: 2,
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.apiKey, '******')

  const listed = await requestJson(`/api/bots/${bot.id}/wecom-command-config/model-configs?capability=image_generation`)
  assert.equal(listed.body.length, 1)
  assert.equal(listed.body[0].apiKey, '******')

  const updated = await requestJson(`/api/bots/${bot.id}/wecom-command-config/model-configs/${created.body.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled: false, apiKey: '******' }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.enabled, false)
  assert.equal(updated.body.apiKey, '******')
})
