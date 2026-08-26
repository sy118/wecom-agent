import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { OnboardingDraft } from '@wecom-platform/types'

function rowToDraft(row: Record<string, unknown>): OnboardingDraft {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    step: Number(row.step ?? 1),
    data: row.data ? JSON.parse(row.data as string) : {},
    updatedAt: Number(row.updated_at),
    createdAt: Number(row.created_at),
  }
}

export const OnboardingDraftRepository = {
  async findById(id: string): Promise<OnboardingDraft | null> {
    const res = await db.execute({ sql: 'SELECT * FROM onboarding_drafts WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToDraft(res.rows[0]) : null
  },

  async findLatestByTenant(tenantId: string): Promise<OnboardingDraft | null> {
    const res = await db.execute({
      sql: 'SELECT * FROM onboarding_drafts WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 1',
      args: [tenantId],
    })
    return res.rows[0] ? rowToDraft(res.rows[0]) : null
  },

  async upsert(data: {
    id?: string | null
    tenantId: string
    step: number
    draft: Record<string, any>
  }): Promise<OnboardingDraft> {
    const id = data.id ?? randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO onboarding_drafts (id, tenant_id, step, data, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              step = excluded.step,
              data = excluded.data,
              updated_at = excluded.updated_at`,
      args: [id, data.tenantId, data.step, JSON.stringify(data.draft), now, now],
    })
    return (await this.findById(id))!
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM onboarding_drafts WHERE id = ?', args: [id] })
  },
}
