import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { IncomingEvent, WecomEventRecord, WecomEventStatus, WecomEventType } from '@wecom-platform/types'

function parseObject(value: unknown): Record<string, any> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

function rowToEvent(row: Record<string, unknown>): WecomEventRecord {
  return {
    id: row.id as string,
    msgId: row.msgid as string,
    eventType: row.event_type as WecomEventType,
    botId: (row.bot_id as string | null) ?? null,
    aibotId: (row.aibotid as string | null) ?? null,
    chatKey: (row.chat_key as string | null) ?? null,
    chatId: (row.chatid as string | null) ?? null,
    chatType: (row.chattype as 'single' | 'group' | null) ?? null,
    fromUserId: (row.from_userid as string | null) ?? null,
    fromCorpid: (row.from_corpid as string | null) ?? null,
    responseUrl: (row.response_url as string | null) ?? null,
    rawPayload: parseObject(row.raw_payload),
    status: row.status as WecomEventStatus,
    error: (row.error as string | null) ?? null,
    createTime: row.create_time === null || row.create_time === undefined ? null : Number(row.create_time),
    createdAt: Number(row.created_at),
    processedAt: row.processed_at === null || row.processed_at === undefined ? null : Number(row.processed_at),
  }
}

export const WecomEventRepository = {
  async createFromIncoming(event: IncomingEvent, botId?: string | null): Promise<{ event: WecomEventRecord; duplicate: boolean }> {
    const existing = await this.findByMsgId(event.msgId)
    if (existing) return { event: existing, duplicate: true }

    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wecom_events
              (id, msgid, event_type, bot_id, aibotid, chat_key, chatid, chattype,
               from_userid, from_corpid, response_url, raw_payload, status, error,
               create_time, created_at, processed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
      args: [
        id,
        event.msgId,
        event.eventType,
        botId ?? null,
        event.aibotId,
        event.chatKey,
        event.chatId,
        event.chatType,
        event.userId,
        event.corpid,
        event.responseUrl,
        JSON.stringify(event.rawBody ?? {}),
        event.createTime,
        now,
      ],
    })
    return { event: (await this.findById(id))!, duplicate: false }
  },

  async createRaw(data: {
    msgId: string
    eventType: string
    botId?: string | null
    aibotId?: string | null
    chatKey?: string | null
    chatId?: string | null
    chatType?: 'single' | 'group' | null
    fromUserId?: string | null
    fromCorpid?: string | null
    responseUrl?: string | null
    rawPayload?: Record<string, any>
    createTime?: number | null
    status?: WecomEventStatus
  }): Promise<{ event: WecomEventRecord; duplicate: boolean }> {
    const existing = await this.findByMsgId(data.msgId)
    if (existing) return { event: existing, duplicate: true }
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wecom_events
              (id, msgid, event_type, bot_id, aibotid, chat_key, chatid, chattype,
               from_userid, from_corpid, response_url, raw_payload, status, error,
               create_time, created_at, processed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      args: [
        id,
        data.msgId,
        data.eventType,
        data.botId ?? null,
        data.aibotId ?? null,
        data.chatKey ?? null,
        data.chatId ?? null,
        data.chatType ?? null,
        data.fromUserId ?? null,
        data.fromCorpid ?? null,
        data.responseUrl ?? null,
        JSON.stringify(data.rawPayload ?? {}),
        data.status ?? 'pending',
        data.createTime ?? null,
        now,
      ],
    })
    return { event: (await this.findById(id))!, duplicate: false }
  },

  async findById(id: string): Promise<WecomEventRecord | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wecom_events WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToEvent(res.rows[0]) : null
  },

  async findByMsgId(msgId: string): Promise<WecomEventRecord | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wecom_events WHERE msgid = ?', args: [msgId] })
    return res.rows[0] ? rowToEvent(res.rows[0]) : null
  },

  async markProcessed(id: string): Promise<WecomEventRecord | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE wecom_events SET status = 'processed', processed_at = ?, error = NULL WHERE id = ?`,
      args: [now, id],
    })
    return this.findById(id)
  },

  async markError(id: string, error: string): Promise<WecomEventRecord | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE wecom_events SET status = 'error', processed_at = ?, error = ? WHERE id = ?`,
      args: [now, error, id],
    })
    return this.findById(id)
  },
}
