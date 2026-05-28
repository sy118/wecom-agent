import { randomBytes, randomUUID } from 'crypto'
import { db } from './client.js'
import type {
  ActiveContext,
  ActiveContextScope,
  AuditLogRecord,
  AuditResult,
  CommandConfirmation,
  CommandPermission,
  ContextAccessGrant,
  ContextAccessLevel,
  WecomUserIdentity,
  WecomUserRole,
  WecomUserStatus,
} from '@wecom-platform/types'

function boolValue(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

function rowToWecomUser(row: Record<string, unknown>): WecomUserIdentity {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    wecomUserId: row.wecom_user_id as string,
    displayName: (row.display_name as string | null) ?? null,
    role: row.role as WecomUserRole,
    status: row.status as WecomUserStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToContextAccess(row: Record<string, unknown>): ContextAccessGrant {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    contextId: row.context_id as string,
    wecomUserId: row.wecom_user_id as string,
    accessLevel: row.access_level as ContextAccessLevel,
    grantedBy: (row.granted_by as string | null) ?? null,
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
    status: row.status as 'active' | 'revoked',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToActiveContext(row: Record<string, unknown>): ActiveContext {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    chatKey: row.chat_key as string,
    wecomUserId: (row.wecom_user_id as string | null) ?? null,
    scope: row.scope as ActiveContextScope,
    contextId: row.context_id as string,
    activatedBy: row.activated_by as string,
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToCommandPermission(row: Record<string, unknown>): CommandPermission {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    commandKey: row.command_key as string,
    role: row.role as WecomUserRole,
    enabled: boolValue(row.enabled),
    requireConfirm: boolValue(row.require_confirm),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToConfirmation(row: Record<string, unknown>): CommandConfirmation {
  return {
    id: row.id as string,
    token: row.token as string,
    botId: row.bot_id as string,
    chatKey: row.chat_key as string,
    chatId: row.chat_id as string,
    wecomUserId: row.wecom_user_id as string,
    commandKey: row.command_key as string,
    payload: parseJsonObject(row.payload),
    expiresAt: Number(row.expires_at),
    consumedAt: row.consumed_at === null || row.consumed_at === undefined ? null : Number(row.consumed_at),
    createdAt: Number(row.created_at),
  }
}

function rowToAudit(row: Record<string, unknown>): AuditLogRecord {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    actorUserId: (row.actor_user_id as string | null) ?? null,
    chatKey: (row.chat_key as string | null) ?? null,
    action: row.action as string,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    result: row.result as AuditResult,
    reason: (row.reason as string | null) ?? null,
    payload: parseJsonObject(row.payload),
    createdAt: Number(row.created_at),
  }
}

export const WecomUserRepository = {
  async findByWecomUserId(botId: string | null, wecomUserId: string): Promise<WecomUserIdentity | null> {
    const botSpecific = botId
      ? await db.execute({ sql: 'SELECT * FROM wecom_users WHERE bot_id = ? AND wecom_user_id = ? LIMIT 1', args: [botId, wecomUserId] })
      : { rows: [] }
    if (botSpecific.rows[0]) return rowToWecomUser(botSpecific.rows[0])
    const global = await db.execute({ sql: 'SELECT * FROM wecom_users WHERE bot_id IS NULL AND wecom_user_id = ? LIMIT 1', args: [wecomUserId] })
    return global.rows[0] ? rowToWecomUser(global.rows[0]) : null
  },

  async list(botId?: string | null): Promise<WecomUserIdentity[]> {
    const res = botId
      ? await db.execute({ sql: 'SELECT * FROM wecom_users WHERE bot_id = ? OR bot_id IS NULL ORDER BY updated_at DESC', args: [botId] })
      : await db.execute('SELECT * FROM wecom_users ORDER BY updated_at DESC')
    return res.rows.map(rowToWecomUser)
  },

  async upsert(data: {
    botId?: string | null
    wecomUserId: string
    displayName?: string | null
    role?: WecomUserRole
    status?: WecomUserStatus
  }): Promise<WecomUserIdentity> {
    const now = Date.now()
    const existing = await this.findByWecomUserId(data.botId ?? null, data.wecomUserId)
    if (existing && (existing.botId ?? null) === (data.botId ?? null)) {
      await db.execute({
        sql: `UPDATE wecom_users SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?`,
        args: [data.displayName ?? existing.displayName, data.role ?? existing.role, data.status ?? existing.status, now, existing.id],
      })
      return (await this.findByWecomUserId(data.botId ?? null, data.wecomUserId))!
    }
    const id = randomUUID()
    await db.execute({
      sql: `INSERT INTO wecom_users (id, bot_id, wecom_user_id, display_name, role, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, data.botId ?? null, data.wecomUserId, data.displayName ?? null, data.role ?? 'user', data.status ?? 'active', now, now],
    })
    return (await this.findByWecomUserId(data.botId ?? null, data.wecomUserId))!
  },

  async setStatus(id: string, status: WecomUserStatus): Promise<WecomUserIdentity | null> {
    await db.execute({ sql: 'UPDATE wecom_users SET status = ?, updated_at = ? WHERE id = ?', args: [status, Date.now(), id] })
    const res = await db.execute({ sql: 'SELECT * FROM wecom_users WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToWecomUser(res.rows[0]) : null
  },

  async deleteByWecomUserId(botId: string, wecomUserId: string): Promise<WecomUserIdentity | null> {
    const existing = await this.findByWecomUserId(botId, wecomUserId)
    if (!existing || existing.botId !== botId) return null
    await db.execute({
      sql: 'DELETE FROM wecom_users WHERE bot_id = ? AND wecom_user_id = ?',
      args: [botId, wecomUserId],
    })
    return existing
  },
}

export const ContextAccessRepository = {
  async grant(data: {
    botId: string
    contextId: string
    wecomUserId: string
    accessLevel?: ContextAccessLevel
    grantedBy?: string | null
    expiresAt?: number | null
  }): Promise<ContextAccessGrant> {
    const now = Date.now()
    const existing = await db.execute({
      sql: 'SELECT * FROM context_access_grants WHERE bot_id = ? AND context_id = ? AND wecom_user_id = ? LIMIT 1',
      args: [data.botId, data.contextId, data.wecomUserId],
    })
    if (existing.rows[0]) {
      await db.execute({
        sql: `UPDATE context_access_grants
              SET access_level = ?, granted_by = ?, expires_at = ?, status = 'active', updated_at = ?
              WHERE id = ?`,
        args: [data.accessLevel ?? 'use', data.grantedBy ?? null, data.expiresAt ?? null, now, existing.rows[0].id as string],
      })
      return (await this.findById(existing.rows[0].id as string))!
    }
    const id = randomUUID()
    await db.execute({
      sql: `INSERT INTO context_access_grants
              (id, bot_id, context_id, wecom_user_id, access_level, granted_by, expires_at, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      args: [id, data.botId, data.contextId, data.wecomUserId, data.accessLevel ?? 'use', data.grantedBy ?? null, data.expiresAt ?? null, now, now],
    })
    return (await this.findById(id))!
  },

  async deleteGrant(botId: string, contextId: string, wecomUserId: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM context_access_grants WHERE bot_id = ? AND context_id = ? AND wecom_user_id = ?',
      args: [botId, contextId, wecomUserId],
    })
  },

  async deleteByUser(botId: string, wecomUserId: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM context_access_grants WHERE bot_id = ? AND wecom_user_id = ?',
      args: [botId, wecomUserId],
    })
  },

  async findById(id: string): Promise<ContextAccessGrant | null> {
    const res = await db.execute({ sql: 'SELECT * FROM context_access_grants WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToContextAccess(res.rows[0]) : null
  },

  async listByUser(botId: string, wecomUserId: string): Promise<ContextAccessGrant[]> {
    const now = Date.now()
    const res = await db.execute({
      sql: `SELECT * FROM context_access_grants
            WHERE bot_id = ? AND wecom_user_id = ? AND status = 'active'
              AND (expires_at IS NULL OR expires_at > ?)
            ORDER BY updated_at DESC`,
      args: [botId, wecomUserId, now],
    })
    return res.rows.map(rowToContextAccess)
  },

  async listByBot(botId: string): Promise<ContextAccessGrant[]> {
    const res = await db.execute({
      sql: `SELECT * FROM context_access_grants
            WHERE bot_id = ?
            ORDER BY updated_at DESC`,
      args: [botId],
    })
    return res.rows.map(rowToContextAccess)
  },

  async hasAccess(botId: string, wecomUserId: string, contextId: string): Promise<boolean> {
    const user = await WecomUserRepository.findByWecomUserId(botId, wecomUserId)
    if (user?.status === 'active' && user.role === 'admin') return true
    const now = Date.now()
    const res = await db.execute({
      sql: `SELECT id FROM context_access_grants
            WHERE bot_id = ? AND wecom_user_id = ? AND context_id = ? AND status = 'active'
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [botId, wecomUserId, contextId, now],
    })
    return res.rows.length > 0
  },
}

export const ActiveContextRepository = {
  async findForChat(botId: string, chatKey: string): Promise<ActiveContext | null> {
    const now = Date.now()
    const res = await db.execute({
      sql: `SELECT * FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = 'chat'
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [botId, chatKey, now],
    })
    return res.rows[0] ? rowToActiveContext(res.rows[0]) : null
  },

  async findForUser(botId: string, chatKey: string, wecomUserId: string): Promise<ActiveContext | null> {
    const now = Date.now()
    const res = await db.execute({
      sql: `SELECT * FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = 'user_in_chat' AND wecom_user_id = ?
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [botId, chatKey, wecomUserId, now],
    })
    if (res.rows[0]) return rowToActiveContext(res.rows[0])
    const chatRes = await db.execute({
      sql: `SELECT * FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = 'chat'
              AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [botId, chatKey, now],
    })
    return chatRes.rows[0] ? rowToActiveContext(chatRes.rows[0]) : null
  },

  async set(data: {
    botId: string
    chatKey: string
    wecomUserId?: string | null
    scope?: ActiveContextScope
    contextId: string
    activatedBy: string
    expiresAt?: number | null
  }): Promise<ActiveContext> {
    const now = Date.now()
    const scope = data.scope ?? 'user_in_chat'
    const existing = await db.execute({
      sql: `SELECT id FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = ? AND COALESCE(wecom_user_id, '') = COALESCE(?, '')
            LIMIT 1`,
      args: [data.botId, data.chatKey, scope, data.wecomUserId ?? null],
    })
    if (existing.rows[0]) {
      await db.execute({
        sql: `UPDATE active_contexts
              SET context_id = ?, activated_by = ?, expires_at = ?, updated_at = ?
              WHERE id = ?`,
        args: [data.contextId, data.activatedBy, data.expiresAt ?? null, now, existing.rows[0].id as string],
      })
      return (await this.findById(existing.rows[0].id as string))!
    }
    const id = randomUUID()
    await db.execute({
      sql: `INSERT INTO active_contexts
              (id, bot_id, chat_key, wecom_user_id, scope, context_id, activated_by, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, data.botId, data.chatKey, data.wecomUserId ?? null, scope, data.contextId, data.activatedBy, data.expiresAt ?? null, now, now],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<ActiveContext | null> {
    const res = await db.execute({ sql: 'SELECT * FROM active_contexts WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToActiveContext(res.rows[0]) : null
  },

  async clear(botId: string, chatKey: string, wecomUserId: string): Promise<void> {
    await db.execute({
      sql: `DELETE FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = 'user_in_chat' AND wecom_user_id = ?`,
      args: [botId, chatKey, wecomUserId],
    })
  },

  async clearChat(botId: string, chatKey: string): Promise<void> {
    await db.execute({
      sql: `DELETE FROM active_contexts
            WHERE bot_id = ? AND chat_key = ? AND scope = 'chat'`,
      args: [botId, chatKey],
    })
  },

  async clearForUser(botId: string, wecomUserId: string): Promise<void> {
    await db.execute({
      sql: `DELETE FROM active_contexts
            WHERE bot_id = ? AND scope = 'user_in_chat' AND wecom_user_id = ?`,
      args: [botId, wecomUserId],
    })
  },

  async deleteExpired(now = Date.now()): Promise<void> {
    await db.execute({ sql: 'DELETE FROM active_contexts WHERE expires_at IS NOT NULL AND expires_at <= ?', args: [now] })
  },
}

const defaultCommandRoles: Record<string, WecomUserRole[]> = {
  help: ['user', 'manager', 'admin'],
  'ctx.current': ['user', 'manager', 'admin'],
  'ctx.list': ['user', 'manager', 'admin'],
  'ctx.use': ['user', 'manager', 'admin'],
  'ctx.reset': ['user', 'manager', 'admin'],
  'task.status': ['user', 'manager', 'admin'],
  'task.result': ['user', 'manager', 'admin'],
  'image.generate': ['user', 'manager', 'admin'],
  confirm: ['user', 'manager', 'admin'],
}

export const CommandPermissionRepository = {
  async list(botId?: string | null): Promise<CommandPermission[]> {
    const res = botId
      ? await db.execute({ sql: 'SELECT * FROM command_permissions WHERE bot_id = ? OR bot_id IS NULL ORDER BY command_key ASC', args: [botId] })
      : await db.execute('SELECT * FROM command_permissions ORDER BY command_key ASC')
    return res.rows.map(rowToCommandPermission)
  },

  async set(data: {
    botId?: string | null
    commandKey: string
    role: WecomUserRole
    enabled: boolean
    requireConfirm?: boolean
  }): Promise<CommandPermission> {
    const now = Date.now()
    const existing = await db.execute({
      sql: `SELECT * FROM command_permissions
            WHERE COALESCE(bot_id, '') = COALESCE(?, '') AND command_key = ? AND role = ?
            LIMIT 1`,
      args: [data.botId ?? null, data.commandKey, data.role],
    })
    if (existing.rows[0]) {
      await db.execute({
        sql: 'UPDATE command_permissions SET enabled = ?, require_confirm = ?, updated_at = ? WHERE id = ?',
        args: [data.enabled ? 1 : 0, data.requireConfirm ? 1 : 0, now, existing.rows[0].id as string],
      })
      return (await this.findById(existing.rows[0].id as string))!
    }
    const id = randomUUID()
    await db.execute({
      sql: `INSERT INTO command_permissions
              (id, bot_id, command_key, role, enabled, require_confirm, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, data.botId ?? null, data.commandKey, data.role, data.enabled ? 1 : 0, data.requireConfirm ? 1 : 0, now, now],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<CommandPermission | null> {
    const res = await db.execute({ sql: 'SELECT * FROM command_permissions WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToCommandPermission(res.rows[0]) : null
  },

  async delete(id: string): Promise<CommandPermission | null> {
    const existing = await this.findById(id)
    if (!existing) return null
    await db.execute({ sql: 'DELETE FROM command_permissions WHERE id = ?', args: [id] })
    return existing
  },

  async check(botId: string, commandKey: string, role: WecomUserRole): Promise<{ allowed: boolean; requireConfirm: boolean }> {
    const res = await db.execute({
      sql: `SELECT * FROM command_permissions
            WHERE (bot_id = ? OR bot_id IS NULL) AND command_key = ? AND role = ?
            ORDER BY bot_id IS NULL ASC
            LIMIT 1`,
      args: [botId, commandKey, role],
    })
    if (res.rows[0]) {
      const permission = rowToCommandPermission(res.rows[0])
      return { allowed: permission.enabled, requireConfirm: permission.requireConfirm }
    }
    const allowed = defaultCommandRoles[commandKey]?.includes(role) ?? role === 'admin'
    return { allowed, requireConfirm: commandKey.startsWith('admin.') }
  },
}

export const CommandConfirmationRepository = {
  async create(data: {
    botId: string
    chatKey: string
    chatId: string
    wecomUserId: string
    commandKey: string
    payload: Record<string, any>
    ttlMs?: number
  }): Promise<CommandConfirmation> {
    const id = randomUUID()
    const token = randomBytes(6).toString('hex')
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO command_confirmations
              (id, token, bot_id, chat_key, chat_id, wecom_user_id, command_key, payload, expires_at, consumed_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      args: [id, token, data.botId, data.chatKey, data.chatId, data.wecomUserId, data.commandKey, JSON.stringify(data.payload), now + (data.ttlMs ?? 5 * 60_000), now],
    })
    return (await this.findByToken(token))!
  },

  async findByToken(token: string): Promise<CommandConfirmation | null> {
    const res = await db.execute({ sql: 'SELECT * FROM command_confirmations WHERE token = ?', args: [token] })
    return res.rows[0] ? rowToConfirmation(res.rows[0]) : null
  },

  async consume(token: string, wecomUserId: string): Promise<{ confirmation: CommandConfirmation | null; error?: string }> {
    const confirmation = await this.findByToken(token)
    if (!confirmation) return { confirmation: null, error: 'not_found' }
    if (confirmation.wecomUserId !== wecomUserId) return { confirmation, error: 'actor_mismatch' }
    if (confirmation.consumedAt) return { confirmation, error: 'consumed' }
    if (confirmation.expiresAt <= Date.now()) return { confirmation, error: 'expired' }
    await db.execute({ sql: 'UPDATE command_confirmations SET consumed_at = ? WHERE id = ?', args: [Date.now(), confirmation.id] })
    return { confirmation: (await this.findByToken(token))! }
  },

  async deletePendingByUser(botId: string, wecomUserId: string): Promise<void> {
    await db.execute({
      sql: 'DELETE FROM command_confirmations WHERE bot_id = ? AND wecom_user_id = ? AND consumed_at IS NULL',
      args: [botId, wecomUserId],
    })
  },
}

export const AuditLogRepository = {
  async create(data: {
    botId?: string | null
    actorUserId?: string | null
    chatKey?: string | null
    action: string
    targetType?: string | null
    targetId?: string | null
    result: AuditResult
    reason?: string | null
    payload?: Record<string, any>
  }): Promise<AuditLogRecord> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO audit_logs
              (id, bot_id, actor_user_id, chat_key, action, target_type, target_id, result, reason, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId ?? null,
        data.actorUserId ?? null,
        data.chatKey ?? null,
        data.action,
        data.targetType ?? null,
        data.targetId ?? null,
        data.result,
        data.reason ?? null,
        JSON.stringify(data.payload ?? {}),
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<AuditLogRecord | null> {
    const res = await db.execute({ sql: 'SELECT * FROM audit_logs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToAudit(res.rows[0]) : null
  },

  async list(limit = 200): Promise<AuditLogRecord[]> {
    const res = await db.execute({ sql: 'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', args: [limit] })
    return res.rows.map(rowToAudit)
  },

  async listByBot(botId: string, limit = 200): Promise<AuditLogRecord[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM audit_logs WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [botId, limit],
    })
    return res.rows.map(rowToAudit)
  },
}
