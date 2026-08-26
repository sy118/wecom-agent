import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { AuditLogRecordV2 } from '@wecom-platform/types'

function rowToAudit(row: Record<string, unknown>): AuditLogRecordV2 {
  return {
    id: row.id as string,
    tenantId: (row.tenant_id as string | null) ?? 'default',
    actorUserId: (row.actor_user_id as string | null) ?? null,
    action: row.action as string,
    targetType: (row.target_type as string | null) ?? null,
    targetId: (row.target_id as string | null) ?? null,
    result: (row.result as AuditLogRecordV2['result']) ?? 'success',
    reason: (row.reason as string | null) ?? null,
    payload: row.payload ? safeParse(row.payload as string) : {},
    createdAt: Number(row.created_at),
  }
}

function safeParse(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export interface AuditLogQuery {
  tenantId: string
  actorUserId?: string | null
  action?: string | null
  targetType?: string | null
  from?: number | null
  to?: number | null
  limit?: number
  offset?: number
}

export const AuditRepository = {
  async record(data: {
    tenantId: string
    actorUserId?: string | null
    action: string
    targetType?: string | null
    targetId?: string | null
    result?: AuditLogRecordV2['result']
    reason?: string | null
    payload?: Record<string, any>
    botId?: string | null
    chatKey?: string | null
  }): Promise<AuditLogRecordV2> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO audit_logs
              (id, bot_id, actor_user_id, chat_key, action, target_type, target_id,
               result, reason, payload, tenant_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId ?? null,
        data.actorUserId ?? null,
        data.chatKey ?? null,
        data.action,
        data.targetType ?? null,
        data.targetId ?? null,
        data.result ?? 'success',
        data.reason ?? null,
        data.payload ? JSON.stringify(data.payload) : '{}',
        data.tenantId,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<AuditLogRecordV2 | null> {
    const res = await db.execute({ sql: 'SELECT * FROM audit_logs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToAudit(res.rows[0]) : null
  },

  async query(query: AuditLogQuery): Promise<{ rows: AuditLogRecordV2[]; total: number }> {
    const where: string[] = ['tenant_id = ?']
    const args: Array<string | number | null> = [query.tenantId]
    if (query.actorUserId) { where.push('actor_user_id = ?'); args.push(query.actorUserId) }
    if (query.action) { where.push('action = ?'); args.push(query.action) }
    if (query.targetType) { where.push('target_type = ?'); args.push(query.targetType) }
    if (query.from) { where.push('created_at >= ?'); args.push(query.from) }
    if (query.to) { where.push('created_at <= ?'); args.push(query.to) }
    const whereSql = where.join(' AND ')
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const offset = Math.max(query.offset ?? 0, 0)
    const countRes = await db.execute({ sql: `SELECT COUNT(*) AS total FROM audit_logs WHERE ${whereSql}`, args })
    const res = await db.execute({
      sql: `SELECT * FROM audit_logs WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      args: [...args, limit, offset],
    })
    return { rows: res.rows.map(rowToAudit), total: Number(countRes.rows[0]?.total ?? 0) }
  },
}
