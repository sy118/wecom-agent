import { randomUUID } from 'crypto'
import { db } from './client.js'

export interface BotTrigger {
  id: string
  botId: string
  tenantId: string
  trigger: string
  createdAt: number
}

function rowToTrigger(row: Record<string, unknown>): BotTrigger {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    tenantId: row.tenant_id as string,
    trigger: row.trigger as string,
    createdAt: Number(row.created_at),
  }
}

export const BotTriggerRepository = {
  async replaceForBot(botId: string, tenantId: string, triggers: string[]): Promise<void> {
    await db.execute({ sql: 'DELETE FROM bot_triggers WHERE bot_id = ?', args: [botId] })
    for (const trigger of triggers) {
      const trimmed = trigger.trim()
      if (!trimmed) continue
      await db.execute({
        sql: `INSERT INTO bot_triggers (id, bot_id, tenant_id, trigger, created_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(tenant_id, trigger) DO UPDATE SET bot_id = excluded.bot_id`,
        args: [randomUUID(), botId, tenantId, trimmed, Date.now()],
      })
    }
  },

  async findByTenant(tenantId: string): Promise<BotTrigger[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM bot_triggers WHERE tenant_id = ? ORDER BY created_at DESC',
      args: [tenantId],
    })
    return res.rows.map(rowToTrigger)
  },

  async findConflicts(tenantId: string, triggers: string[], excludeBotId?: string | null): Promise<string[]> {
    const normalized = [...new Set(triggers.map((t) => t.trim()).filter(Boolean))]
    if (normalized.length === 0) return []
    const conflicts: string[] = []
    for (const trigger of normalized) {
      const res = await db.execute({
        sql: `SELECT * FROM bot_triggers WHERE tenant_id = ? AND trigger = ? AND bot_id != COALESCE(?, '')`,
        args: [tenantId, trigger, excludeBotId ?? ''],
      })
      if (res.rows.length > 0) conflicts.push(trigger)
    }
    return conflicts
  },

  async findByBot(botId: string): Promise<BotTrigger[]> {
    const res = await db.execute({ sql: 'SELECT * FROM bot_triggers WHERE bot_id = ? ORDER BY created_at ASC', args: [botId] })
    return res.rows.map(rowToTrigger)
  },
}