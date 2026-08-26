import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { WecomMcpToolMetadata } from '@wecom-platform/types'

function boolValue(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

function rowToTool(row: Record<string, unknown>): WecomMcpToolMetadata {
  return {
    module: row.module as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    scope: (row.scope as string | null) ?? null,
    write: boolValue(row.write_flag),
    approvalRequired: boolValue(row.approval_required),
    enabled: boolValue(row.enabled),
    tenantId: row.tenant_id as string,
    expiresAt: (row.expires_at as number | null) ?? null,
  }
}

export const WecomMcpToolRepository = {
  async upsert(data: {
    module: string
    name: string
    description?: string | null
    scope?: string | null
    write: boolean
    approvalRequired?: boolean
    enabled?: boolean
    tenantId: string
    expiresAt?: number | null
  }): Promise<WecomMcpToolMetadata> {
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wecom_mcp_tools
              (id, module, name, description, scope, write_flag, approval_required, enabled,
               tenant_id, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant_id, module, name) DO UPDATE SET
              description = excluded.description,
              scope = excluded.scope,
              write_flag = excluded.write_flag,
              approval_required = excluded.approval_required,
              enabled = excluded.enabled,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at`,
      args: [
        randomUUID(),
        data.module,
        data.name,
        data.description ?? null,
        data.scope ?? null,
        data.write ? 1 : 0,
        data.approvalRequired === false ? 0 : 1,
        data.enabled === false ? 0 : 1,
        data.tenantId,
        data.expiresAt ?? null,
        now,
        now,
      ],
    })
    const found = await this.findByModuleAndName(data.tenantId, data.module, data.name)
    return found!
  },

  async findByModuleAndName(tenantId: string, module: string, name: string): Promise<WecomMcpToolMetadata | null> {
    const res = await db.execute({
      sql: 'SELECT * FROM wecom_mcp_tools WHERE tenant_id = ? AND module = ? AND name = ?',
      args: [tenantId, module, name],
    })
    return res.rows[0] ? rowToTool(res.rows[0]) : null
  },

  async findByTenant(tenantId: string): Promise<WecomMcpToolMetadata[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM wecom_mcp_tools WHERE tenant_id = ? ORDER BY module ASC, name ASC',
      args: [tenantId],
    })
    return res.rows.map(rowToTool)
  },

  async setEnabled(tenantId: string, module: string, name: string, enabled: boolean): Promise<void> {
    await db.execute({
      sql: 'UPDATE wecom_mcp_tools SET enabled = ?, updated_at = ? WHERE tenant_id = ? AND module = ? AND name = ?',
      args: [enabled ? 1 : 0, Date.now(), tenantId, module, name],
    })
  },

  async setExpiresAt(tenantId: string, module: string, name: string, expiresAt: number | null): Promise<void> {
    await db.execute({
      sql: 'UPDATE wecom_mcp_tools SET expires_at = ?, updated_at = ? WHERE tenant_id = ? AND module = ? AND name = ?',
      args: [expiresAt, Date.now(), tenantId, module, name],
    })
  },

  /** 将已过期的授权标记为禁用并返回受影响工具列表。 */
  async expireDueAuthorizations(now = Date.now()): Promise<WecomMcpToolMetadata[]> {
    const res = await db.execute({
      sql: `SELECT * FROM wecom_mcp_tools
            WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at < ?
            ORDER BY module ASC, name ASC`,
      args: [now],
    })
    const due = res.rows.map(rowToTool)
    if (due.length > 0) {
      await db.execute({
        sql: `UPDATE wecom_mcp_tools SET enabled = 0, updated_at = ? WHERE enabled = 1 AND expires_at IS NOT NULL AND expires_at < ?`,
        args: [now, now],
      })
    }
    return due
  },

  async deleteByTenant(tenantId: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM wecom_mcp_tools WHERE tenant_id = ?', args: [tenantId] })
  },
}
