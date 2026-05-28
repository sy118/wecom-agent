import { Router } from 'express'
import { ContextRepository } from '../db/context-repository.js'
import { ModelConfigRepository } from '../db/generation-repository.js'
import { getWecomCommandMetrics } from '../services/wecom-command-metrics.js'
import {
  ActiveContextRepository,
  AuditLogRepository,
  CommandConfirmationRepository,
  CommandPermissionRepository,
  ContextAccessRepository,
  WecomUserRepository,
} from '../db/wecom-access-repository.js'
import type { WecomUserRole, WecomUserStatus } from '@wecom-platform/types'

export const wecomCommandConfigRouter: Router = Router({ mergeParams: true })

const ROLES: WecomUserRole[] = ['user', 'manager', 'admin']
const USER_STATUSES: WecomUserStatus[] = ['active', 'disabled']
const ADMIN_COMMANDS = ['admin.ctx.grant', 'admin.ctx.revoke', 'admin.user.upsert', 'admin.command.set']
const CONTEXT_SWITCH_COMMANDS = ['ctx.use']
const IMAGE_COMMANDS = ['image.generate']

function asRole(value: unknown): WecomUserRole | null {
  return ROLES.includes(value as WecomUserRole) ? value as WecomUserRole : null
}

function asStatus(value: unknown): WecomUserStatus | null {
  return USER_STATUSES.includes(value as WecomUserStatus) ? value as WecomUserStatus : null
}

function parseBoolean(value: unknown): boolean | null {
  if (value === true || value === false) return value
  return null
}

async function requireContext(botId: string, contextId: string): Promise<boolean> {
  const context = await ContextRepository.findById(contextId)
  return Boolean(context && context.botId === botId)
}

wecomCommandConfigRouter.get('/users', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await WecomUserRepository.list(botId))
})

wecomCommandConfigRouter.post('/users', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const role = asRole(req.body.role ?? 'user')
  const status = asStatus(req.body.status ?? 'active')
  const wecomUserId = String(req.body.wecomUserId ?? '').trim()
  if (!wecomUserId) { res.status(400).json({ error: 'wecomUserId is required' }); return }
  if (!role) { res.status(400).json({ error: 'role must be user, manager, or admin' }); return }
  if (!status) { res.status(400).json({ error: 'status must be active or disabled' }); return }

  const user = await WecomUserRepository.upsert({
    botId,
    wecomUserId,
    displayName: req.body.displayName ?? null,
    role,
    status,
  })
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.user.upsert',
    targetType: 'wecom_user',
    targetId: wecomUserId,
    result: 'success',
    payload: { role, status },
  })
  res.status(201).json(user)
})

wecomCommandConfigRouter.patch('/users/:wecomUserId', async (req, res) => {
  const { botId, wecomUserId } = req.params as { botId: string; wecomUserId: string }
  const existing = await WecomUserRepository.findByWecomUserId(botId, wecomUserId)
  if (!existing || existing.botId !== botId) { res.status(404).json({ error: 'WeCom user not found' }); return }

  const role = req.body.role === undefined ? existing.role : asRole(req.body.role)
  const status = req.body.status === undefined ? existing.status : asStatus(req.body.status)
  if (!role) { res.status(400).json({ error: 'role must be user, manager, or admin' }); return }
  if (!status) { res.status(400).json({ error: 'status must be active or disabled' }); return }

  const user = await WecomUserRepository.upsert({
    botId,
    wecomUserId,
    displayName: req.body.displayName ?? existing.displayName,
    role,
    status,
  })
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.user.upsert',
    targetType: 'wecom_user',
    targetId: wecomUserId,
    result: 'success',
    payload: { role, status },
  })
  res.json(user)
})

wecomCommandConfigRouter.delete('/users/:wecomUserId', async (req, res) => {
  const { botId, wecomUserId } = req.params as { botId: string; wecomUserId: string }
  const existing = await WecomUserRepository.findByWecomUserId(botId, wecomUserId)
  if (!existing || existing.botId !== botId) { res.status(404).json({ error: 'WeCom user not found' }); return }

  await ContextAccessRepository.deleteByUser(botId, wecomUserId)
  await ActiveContextRepository.clearForUser(botId, wecomUserId)
  await CommandConfirmationRepository.deletePendingByUser(botId, wecomUserId)
  await WecomUserRepository.deleteByWecomUserId(botId, wecomUserId)
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.user.delete',
    targetType: 'wecom_user',
    targetId: wecomUserId,
    result: 'success',
    payload: { role: existing.role, status: existing.status },
  })
  res.status(204).send()
})

wecomCommandConfigRouter.get('/context-access', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const wecomUserId = typeof req.query.wecomUserId === 'string' ? req.query.wecomUserId : null
  res.json(wecomUserId
    ? await ContextAccessRepository.listByUser(botId, wecomUserId)
    : await ContextAccessRepository.listByBot(botId))
})

wecomCommandConfigRouter.post('/context-access', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const wecomUserId = String(req.body.wecomUserId ?? '').trim()
  const contextId = String(req.body.contextId ?? '').trim()
  if (!wecomUserId) { res.status(400).json({ error: 'wecomUserId is required' }); return }
  if (!contextId) { res.status(400).json({ error: 'contextId is required' }); return }
  if (!await requireContext(botId, contextId)) { res.status(400).json({ error: 'contextId is invalid for this bot' }); return }

  const accessLevel = req.body.accessLevel === 'manage' ? 'manage' : 'use'
  const expiresAt = req.body.expiresAt === undefined || req.body.expiresAt === null ? null : Number(req.body.expiresAt)
  if (expiresAt !== null && !Number.isFinite(expiresAt)) { res.status(400).json({ error: 'expiresAt must be a timestamp' }); return }
  const grant = await ContextAccessRepository.grant({
    botId,
    contextId,
    wecomUserId,
    accessLevel,
    grantedBy: 'admin',
    expiresAt,
  })
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.ctx.grant',
    targetType: 'context',
    targetId: contextId,
    result: 'success',
    payload: { wecomUserId, accessLevel, expiresAt },
  })
  res.status(201).json(grant)
})

wecomCommandConfigRouter.delete('/context-access/:wecomUserId/:contextId', async (req, res) => {
  const { botId, wecomUserId, contextId } = req.params as { botId: string; wecomUserId: string; contextId: string }
  await ContextAccessRepository.deleteGrant(botId, contextId, wecomUserId)
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.ctx.delete',
    targetType: 'context',
    targetId: contextId,
    result: 'success',
    payload: { wecomUserId },
  })
  res.status(204).send()
})

wecomCommandConfigRouter.get('/command-permissions', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await CommandPermissionRepository.list(botId))
})

wecomCommandConfigRouter.put('/command-permissions', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const commandKey = String(req.body.commandKey ?? '').trim()
  const role = asRole(req.body.role)
  const enabled = parseBoolean(req.body.enabled)
  const requireConfirm = req.body.requireConfirm === undefined ? false : parseBoolean(req.body.requireConfirm)
  if (!commandKey) { res.status(400).json({ error: 'commandKey is required' }); return }
  if (!role) { res.status(400).json({ error: 'role must be user, manager, or admin' }); return }
  if (enabled === null) { res.status(400).json({ error: 'enabled must be boolean' }); return }
  if (requireConfirm === null) { res.status(400).json({ error: 'requireConfirm must be boolean' }); return }

  const permission = await CommandPermissionRepository.set({
    botId,
    commandKey,
    role,
    enabled,
    requireConfirm,
  })
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.command.set',
    targetType: 'command_permission',
    targetId: commandKey,
    result: 'success',
    payload: { role, enabled, requireConfirm },
  })
  res.json(permission)
})

wecomCommandConfigRouter.delete('/command-permissions/:id', async (req, res) => {
  const botId = String((req.params as any).botId)
  const permission = await CommandPermissionRepository.findById(req.params.id)
  if (!permission || permission.botId !== botId) {
    res.status(404).json({ error: 'Command permission not found' })
    return
  }
  await CommandPermissionRepository.delete(permission.id)
  await AuditLogRepository.create({
    botId,
    actorUserId: null,
    action: 'admin.command.delete',
    targetType: 'command_permission',
    targetId: permission.id,
    result: 'success',
    payload: {
      commandKey: permission.commandKey,
      role: permission.role,
    },
  })
  res.status(204).end()
})

wecomCommandConfigRouter.get('/feature-switches', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const contextSwitch = await CommandPermissionRepository.check(botId, 'ctx.use', 'user')
  const imageGeneration = await CommandPermissionRepository.check(botId, 'image.generate', 'user')
  const adminCommands = await CommandPermissionRepository.check(botId, 'admin.ctx.grant', 'admin')
  res.json({
    contextSwitchEnabled: contextSwitch.allowed,
    imageGenerationEnabled: imageGeneration.allowed,
    adminCommandsEnabled: adminCommands.allowed,
  })
})

wecomCommandConfigRouter.put('/feature-switches', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const contextSwitchEnabled = parseBoolean(req.body.contextSwitchEnabled)
  const imageGenerationEnabled = parseBoolean(req.body.imageGenerationEnabled)
  const adminCommandsEnabled = parseBoolean(req.body.adminCommandsEnabled)
  if (contextSwitchEnabled === null || imageGenerationEnabled === null || adminCommandsEnabled === null) {
    res.status(400).json({ error: 'feature switches must be boolean' })
    return
  }

  for (const role of ROLES) {
    for (const commandKey of CONTEXT_SWITCH_COMMANDS) {
      await CommandPermissionRepository.set({ botId, commandKey, role, enabled: contextSwitchEnabled })
    }
    for (const commandKey of IMAGE_COMMANDS) {
      await CommandPermissionRepository.set({ botId, commandKey, role, enabled: imageGenerationEnabled })
    }
  }
  for (const commandKey of ADMIN_COMMANDS) {
    await CommandPermissionRepository.set({ botId, commandKey, role: 'admin', enabled: adminCommandsEnabled, requireConfirm: true })
  }
  await AuditLogRepository.create({
    botId,
    actorUserId: 'admin',
    action: 'admin.feature_switches.update',
    targetType: 'command_permission',
    result: 'success',
    payload: { contextSwitchEnabled, imageGenerationEnabled, adminCommandsEnabled },
  })
  res.json({ contextSwitchEnabled, imageGenerationEnabled, adminCommandsEnabled })
})

wecomCommandConfigRouter.post('/confirmations', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const chatKey = String(req.body.chatKey ?? '').trim()
  const chatId = String(req.body.chatId ?? '').trim()
  const wecomUserId = String(req.body.wecomUserId ?? '').trim()
  const commandKey = String(req.body.commandKey ?? '').trim()
  if (!chatKey || !chatId || !wecomUserId || !commandKey) {
    res.status(400).json({ error: 'chatKey, chatId, wecomUserId, and commandKey are required' })
    return
  }
  const confirmation = await CommandConfirmationRepository.create({
    botId,
    chatKey,
    chatId,
    wecomUserId,
    commandKey,
    payload: req.body.payload ?? {},
    ttlMs: req.body.ttlMs,
  })
  res.status(201).json(confirmation)
})

wecomCommandConfigRouter.post('/confirmations/:token/consume', async (req, res) => {
  const consumed = await CommandConfirmationRepository.consume(req.params.token, String(req.body.wecomUserId ?? ''))
  if (consumed.error) { res.status(400).json(consumed); return }
  res.json(consumed)
})

wecomCommandConfigRouter.get('/audit-logs', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const limit = Number(req.query.limit ?? 100)
  res.json(await AuditLogRepository.listByBot(botId, Number.isFinite(limit) ? limit : 100))
})

wecomCommandConfigRouter.get('/metrics', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await getWecomCommandMetrics(botId))
})

wecomCommandConfigRouter.get('/model-configs', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const capability = typeof req.query.capability === 'string' ? req.query.capability as any : undefined
  const configs = await ModelConfigRepository.list(botId, capability)
  res.json(configs.map(maskModelSecret))
})

wecomCommandConfigRouter.post('/model-configs', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const name = String(req.body.name ?? '').trim()
  const provider = String(req.body.provider ?? 'openai-compatible-image').trim() as any
  const modelName = String(req.body.modelName ?? '').trim()
  const capability = String(req.body.capability ?? 'image_generation').trim() as any
  if (!name || !modelName) { res.status(400).json({ error: 'name and modelName are required' }); return }
  const config = await ModelConfigRepository.create({
    botId,
    name,
    provider,
    modelName,
    capability,
    baseUrl: req.body.baseUrl ?? null,
    apiKey: req.body.apiKey ?? null,
    defaultParams: req.body.defaultParams ?? {},
    enabled: req.body.enabled !== false,
    timeoutMs: req.body.timeoutMs ?? null,
    quotaPerUserDaily: req.body.quotaPerUserDaily ?? null,
    maxConcurrent: req.body.maxConcurrent ?? null,
  })
  res.status(201).json(maskModelSecret(config))
})

wecomCommandConfigRouter.patch('/model-configs/:id', async (req, res) => {
  const botId = String((req.params as any).botId)
  const existing = await ModelConfigRepository.findById(req.params.id)
  if (!existing || (existing.botId !== null && existing.botId !== botId)) {
    res.status(404).json({ error: 'Model config not found' })
    return
  }
  const data = { ...req.body }
  delete data.botId
  delete data.id
  if (data.apiKey === '******') delete data.apiKey
  const updated = await ModelConfigRepository.update(req.params.id, {
    ...data,
    defaultParams: data.defaultParams ?? undefined,
  })
  if (!updated) { res.status(404).json({ error: 'Model config not found' }); return }
  res.json(maskModelSecret(updated))
})

wecomCommandConfigRouter.delete('/model-configs/:id', async (req, res) => {
  const botId = String((req.params as any).botId)
  const existing = await ModelConfigRepository.findById(req.params.id)
  if (!existing || existing.botId !== botId) {
    res.status(404).json({ error: 'Model config not found' })
    return
  }
  await ModelConfigRepository.delete(req.params.id)
  res.status(204).end()
})

function maskModelSecret<T extends { apiKey: string | null }>(model: T): T {
  return { ...model, apiKey: model.apiKey ? '******' : null }
}
