import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { ApprovalRequest, ApprovalStatus } from '@wecom-platform/types'

function rowToApproval(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: row.id as string,
    runId: (row.run_id as string | null) ?? null,
    tenantId: row.tenant_id as string,
    botId: (row.bot_id as string | null) ?? null,
    toolName: row.tool_name as string,
    scope: (row.scope as string | null) ?? null,
    status: row.status as ApprovalStatus,
    requesterUserId: (row.requester_user_id as string | null) ?? null,
    approverUserId: (row.approver_user_id as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    decidedAt: (row.decided_at as number | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export const ApprovalRepository = {
  async create(data: {
    runId?: string | null
    tenantId: string
    botId?: string | null
    toolName: string
    scope?: string | null
    requesterUserId?: string | null
  }): Promise<ApprovalRequest> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO approval_requests
              (id, run_id, tenant_id, bot_id, tool_name, scope, status, requester_user_id,
               approver_user_id, reason, decided_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?)`,
      args: [
        id,
        data.runId ?? null,
        data.tenantId,
        data.botId ?? null,
        data.toolName,
        data.scope ?? null,
        data.requesterUserId ?? null,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<ApprovalRequest | null> {
    const res = await db.execute({ sql: 'SELECT * FROM approval_requests WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToApproval(res.rows[0]) : null
  },

  async findByTenant(tenantId: string, status?: ApprovalStatus | 'all', limit = 100): Promise<ApprovalRequest[]> {
    if (status && status !== 'all') {
      const res = await db.execute({
        sql: 'SELECT * FROM approval_requests WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
        args: [tenantId, status, limit],
      })
      return res.rows.map(rowToApproval)
    }
    const res = await db.execute({
      sql: 'SELECT * FROM approval_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [tenantId, limit],
    })
    return res.rows.map(rowToApproval)
  },

  async findPendingByTool(tenantId: string, toolName: string): Promise<ApprovalRequest[]> {
    const res = await db.execute({
      sql: `SELECT * FROM approval_requests
            WHERE tenant_id = ? AND tool_name = ? AND status = 'pending'
            ORDER BY created_at ASC`,
      args: [tenantId, toolName],
    })
    return res.rows.map(rowToApproval)
  },

  async decide(
    id: string,
    data: { status: 'approved' | 'rejected'; approverUserId: string; reason?: string | null }
  ): Promise<ApprovalRequest | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE approval_requests
            SET status = ?, approver_user_id = ?, reason = ?, decided_at = ?, updated_at = ?
            WHERE id = ? AND status = 'pending'`,
      args: [data.status, data.approverUserId, data.reason ?? null, now, now, id],
    })
    return this.findById(id)
  },

  async expirePending(now = Date.now()): Promise<void> {
    await db.execute({
      sql: `UPDATE approval_requests SET status = 'expired', updated_at = ? WHERE status = 'pending' AND updated_at < ?`,
      args: [now, now - 24 * 60 * 60 * 1000],
    })
  },
}
