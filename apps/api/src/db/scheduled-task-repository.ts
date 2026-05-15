import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { ScheduledTask } from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function rowToTask(row: Record<string, unknown>): ScheduledTask {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    name: row.name as string,
    cronExpr: row.cron_expr as string,
    promptTemplate: row.prompt_template as string,
    targetChatKey: row.target_chat_key as string,
    targetChatId: row.target_chat_id as string,
    targetChatName: (row.target_chat_name as string | null) ?? null,
    contextId: (row.context_id as string | null) ?? null,
    enabled: Boolean(row.enabled),
    lastRunAt: (row.last_run_at as number | null) ?? null,
    nextRunAt: (row.next_run_at as number | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const ScheduledTaskRepository = {
  async findAll(botId?: string | null): Promise<ScheduledTask[]> {
    if (botId) {
      const res = await db.execute({
        sql: 'SELECT * FROM scheduled_tasks WHERE bot_id = ? ORDER BY created_at DESC',
        args: [botId],
      })
      return res.rows.map(rowToTask)
    }
    const res = await db.execute('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    return res.rows.map(rowToTask)
  },

  async findAllEnabled(): Promise<ScheduledTask[]> {
    const res = await db.execute('SELECT * FROM scheduled_tasks WHERE enabled = 1')
    return res.rows.map(rowToTask)
  },

  async findById(id: string): Promise<ScheduledTask | null> {
    const res = await db.execute({ sql: 'SELECT * FROM scheduled_tasks WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToTask(res.rows[0]) : null
  },

  async create(data: Omit<ScheduledTask, 'id' | 'lastRunAt' | 'nextRunAt' | 'createdAt' | 'updatedAt'>): Promise<ScheduledTask> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO scheduled_tasks
              (id, bot_id, name, cron_expr, prompt_template, target_chat_key, target_chat_id,
               target_chat_name, context_id, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, data.botId ?? null, data.name, data.cronExpr, data.promptTemplate,
        data.targetChatKey || data.targetChatId, data.targetChatId, data.targetChatName ?? null,
        (data.contextId || null), data.enabled ? 1 : 0, now, now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<ScheduledTask, 'id' | 'botId' | 'createdAt'>>): Promise<ScheduledTask | null> {
    const now = Date.now()
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [now]
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.cronExpr !== undefined) { fields.push('cron_expr = ?'); args.push(data.cronExpr) }
    if (data.promptTemplate !== undefined) { fields.push('prompt_template = ?'); args.push(data.promptTemplate) }
    if (data.targetChatKey !== undefined) { fields.push('target_chat_key = ?'); args.push(data.targetChatKey) }
    if (data.targetChatId !== undefined) { fields.push('target_chat_id = ?'); args.push(data.targetChatId) }
    if (data.targetChatName !== undefined) { fields.push('target_chat_name = ?'); args.push(data.targetChatName) }
    if (data.contextId !== undefined) { fields.push('context_id = ?'); args.push(data.contextId) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    if (data.lastRunAt !== undefined) { fields.push('last_run_at = ?'); args.push(data.lastRunAt) }
    if (data.nextRunAt !== undefined) { fields.push('next_run_at = ?'); args.push(data.nextRunAt) }
    args.push(id)
    await db.execute({ sql: `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM scheduled_tasks WHERE id = ?', args: [id] })
  },
}
