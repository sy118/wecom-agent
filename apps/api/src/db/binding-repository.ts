import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { Binding } from '@wecom-platform/types'

function rowToBinding(row: Record<string, unknown>): Binding {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    contextId: row.context_id as string,
    chatKey: row.chat_key as string,
    chatName: row.chat_name as string | null,
    chatType: row.chat_type as 'group' | 'user',
    createdAt: row.created_at as number,
  }
}

export const BindingRepository = {
  async findByBotId(botId: string): Promise<Binding[]> {
    const res = await db.execute({ sql: 'SELECT * FROM bindings WHERE bot_id = ? ORDER BY created_at DESC', args: [botId] })
    return res.rows.map(rowToBinding)
  },

  async findByChatKey(botId: string, chatKey: string): Promise<Binding | null> {
    const res = await db.execute({ sql: 'SELECT * FROM bindings WHERE bot_id = ? AND chat_key = ?', args: [botId, chatKey] })
    return res.rows[0] ? rowToBinding(res.rows[0]) : null
  },

  async upsert(data: Omit<Binding, 'id' | 'createdAt'>): Promise<Binding> {
    const existing = await this.findByChatKey(data.botId, data.chatKey)
    if (existing) {
      await db.execute({
        sql: 'UPDATE bindings SET context_id = ?, chat_name = ?, chat_type = ? WHERE id = ?',
        args: [data.contextId, data.chatName ?? null, data.chatType, existing.id],
      })
      return (await this.findByChatKey(data.botId, data.chatKey))!
    }
    const id = randomUUID()
    await db.execute({
      sql: 'INSERT INTO bindings (id, bot_id, context_id, chat_key, chat_name, chat_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, data.botId, data.contextId, data.chatKey, data.chatName ?? null, data.chatType, Date.now()],
    })
    return (await this.findByChatKey(data.botId, data.chatKey))!
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM bindings WHERE id = ?', args: [id] })
  },
}
