import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { SkillAuditRecord } from '@wecom-platform/types'

function rowToAudit(row: Record<string, unknown>): SkillAuditRecord {
  return {
    id: row.id as string,
    skillId: row.skill_id as string,
    botId: row.bot_id as string,
    contextId: (row.context_id as string | null) ?? null,
    chatKey: (row.chat_key as string | null) ?? null,
    status: row.status as SkillAuditRecord['status'],
    durationMs: row.duration_ms as number,
    inputPreview: (row.input_preview as string | null) ?? null,
    outputPreview: (row.output_preview as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: row.created_at as number,
  }
}

export const SkillAuditRepository = {
  async create(data: Omit<SkillAuditRecord, 'id' | 'createdAt'>): Promise<SkillAuditRecord> {
    const id = randomUUID()
    const createdAt = Date.now()
    await db.execute({
      sql: `INSERT INTO skill_audit_logs
              (id, skill_id, bot_id, context_id, chat_key, status, duration_ms, input_preview, output_preview, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.skillId,
        data.botId,
        data.contextId,
        data.chatKey,
        data.status,
        data.durationMs,
        data.inputPreview,
        data.outputPreview,
        data.error,
        createdAt,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<SkillAuditRecord | null> {
    const res = await db.execute({ sql: 'SELECT * FROM skill_audit_logs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToAudit(res.rows[0]) : null
  },

  async findBySkillId(skillId: string, limit = 100): Promise<SkillAuditRecord[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM skill_audit_logs WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?',
      args: [skillId, limit],
    })
    return res.rows.map(rowToAudit)
  },
}
