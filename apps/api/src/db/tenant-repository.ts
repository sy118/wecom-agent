import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { TenantProfile } from '@wecom-platform/types'

export const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID?.trim() || 'default'

function rowToTenant(row: Record<string, unknown>): TenantProfile {
  return {
    id: row.id as string,
    name: row.name as string,
    status: (row.status as TenantProfile['status']) ?? 'active',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export const TenantRepository = {
  async ensureDefaultTenant(): Promise<TenantProfile> {
    const existing = await this.findById(DEFAULT_TENANT_ID)
    if (existing) return existing
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO tenant_profiles (id, name, status, created_at, updated_at)
            VALUES (?, ?, 'active', ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [DEFAULT_TENANT_ID, '默认租户', now, now],
    })
    return (await this.findById(DEFAULT_TENANT_ID))!
  },

  async findById(id: string): Promise<TenantProfile | null> {
    const res = await db.execute({ sql: 'SELECT * FROM tenant_profiles WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToTenant(res.rows[0]) : null
  },

  async findAll(): Promise<TenantProfile[]> {
    const res = await db.execute('SELECT * FROM tenant_profiles ORDER BY created_at ASC')
    return res.rows.map(rowToTenant)
  },

  async create(data: { id?: string; name: string }): Promise<TenantProfile> {
    const id = data.id ?? randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO tenant_profiles (id, name, status, created_at, updated_at)
            VALUES (?, ?, 'active', ?, ?)`,
      args: [id, data.name, now, now],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: { name?: string; status?: TenantProfile['status'] }): Promise<TenantProfile | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE tenant_profiles SET name = COALESCE(?, name), status = COALESCE(?, status), updated_at = ? WHERE id = ?`,
      args: [data.name ?? null, data.status ?? null, now, id],
    })
    return this.findById(id)
  },
}

/** 解析请求中的租户标识；未指定时回落到默认租户。 */
export function resolveTenantId(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_TENANT_ID
  return value.trim()
}

/** 租户隔离校验：期望租户与目标租户不一致时返回错误信息，否则返回 null。 */
export function tenantMismatch(expectedTenantId: string, targetTenantId: string | null | undefined): string | null {
  if (!targetTenantId) return null
  if (expectedTenantId !== targetTenantId) return `跨租户访问被拒绝：期望租户 ${expectedTenantId}，目标租户 ${targetTenantId}`
  return null
}
