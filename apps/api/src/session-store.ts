import { randomUUID } from 'crypto'
import type { Client } from '@libsql/client'
import type { Session, SessionMessage, IncomingContent } from '@wecom-platform/types'

const MAX_MESSAGES = 20

function serializeContent(content: string | IncomingContent[]): string {
  if (typeof content === 'string') return content
  return JSON.stringify(content)
}

function deserializeContent(raw: string): string | IncomingContent[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as IncomingContent[]
  } catch {
    // not JSON — plain string
  }
  return raw
}

export class SessionStore {
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor(private db: Client, private botId: string) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000)
  }

  async getOrCreate(chatKey: string, contextId: string, ttlMin: number): Promise<Session> {
    const now = Date.now()
    const result = await this.db.execute({
      sql: `SELECT id, context_id, dify_conversation_id, last_active_at, expires_at
            FROM sessions
            WHERE bot_id = ? AND chat_key = ? AND context_id = ? AND expires_at > ?
            ORDER BY last_active_at DESC
            LIMIT 1`,
      args: [this.botId, chatKey, contextId, now],
    })

    if (result.rows.length > 0) {
      const row = result.rows[0]
      const sessionId = row.id as string
      const newExpiry = now + ttlMin * 60_000

      await this.db.execute({
        sql: 'UPDATE sessions SET last_active_at = ?, expires_at = ? WHERE id = ? AND bot_id = ?',
        args: [now, newExpiry, sessionId, this.botId],
      })

      const msgResult = await this.db.execute({
        sql: 'SELECT role, content, timestamp, response_run_id FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC',
        args: [sessionId],
      })

      const messages: SessionMessage[] = msgResult.rows.map((r) => ({
        role: r.role as 'human' | 'ai',
        content: deserializeContent(r.content as string),
        timestamp: r.timestamp as number,
        responseRunId: (r.response_run_id as string | null) ?? null,
      }))

      return {
        id: sessionId,
        chatKey,
        contextId: row.context_id as string,
        messages,
        difyConversationId: (row.dify_conversation_id as string | null) ?? undefined,
        lastActiveAt: now,
        expiresAt: newExpiry,
      }
    }

    const sessionId = randomUUID()
    const expiresAt = now + ttlMin * 60_000

    await this.db.execute({
      sql: 'INSERT INTO sessions (id, bot_id, chat_key, context_id, last_active_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [sessionId, this.botId, chatKey, contextId, now, expiresAt],
    })

    return { id: sessionId, chatKey, contextId, messages: [], lastActiveAt: now, expiresAt }
  }

  async addMessage(chatKey: string, message: SessionMessage, responseRunId?: string | null): Promise<void> {
    const now = Date.now()
    const sessionResult = await this.db.execute({
      sql: `SELECT id FROM sessions
            WHERE bot_id = ? AND chat_key = ? AND expires_at > ?
            ORDER BY last_active_at DESC
            LIMIT 1`,
      args: [this.botId, chatKey, now],
    })
    if (sessionResult.rows.length === 0) return

    const sessionId = sessionResult.rows[0].id as string

    await this.db.execute({
      sql: 'INSERT INTO session_messages (id, session_id, role, content, timestamp, response_run_id) VALUES (?, ?, ?, ?, ?, ?)',
      args: [randomUUID(), sessionId, message.role, serializeContent(message.content), message.timestamp, responseRunId ?? message.responseRunId ?? null],
    })

    const countResult = await this.db.execute({
      sql: 'SELECT COUNT(*) as cnt FROM session_messages WHERE session_id = ?',
      args: [sessionId],
    })
    const count = countResult.rows[0].cnt as number
    if (count > MAX_MESSAGES) {
      await this.db.execute({
        sql: `DELETE FROM session_messages WHERE session_id = ? AND id IN (
          SELECT id FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?
        )`,
        args: [sessionId, sessionId, count - MAX_MESSAGES],
      })
    }

    await this.db.execute({
      sql: 'UPDATE sessions SET last_active_at = ? WHERE id = ? AND bot_id = ?',
      args: [now, sessionId, this.botId],
    })
  }

  async setDifyConversationId(chatKey: string, conversationId: string): Promise<void> {
    await this.db.execute({
      sql: `UPDATE sessions SET dify_conversation_id = ?
            WHERE id = (
              SELECT id FROM sessions
              WHERE bot_id = ? AND chat_key = ? AND expires_at > ?
              ORDER BY last_active_at DESC
              LIMIT 1
            )`,
      args: [conversationId, this.botId, chatKey, Date.now()],
    })
  }

  async delete(chatKey: string): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM sessions WHERE bot_id = ? AND chat_key = ?',
      args: [this.botId, chatKey],
    })
  }

  async getAll(): Promise<Session[]> {
    const now = Date.now()
    const sessionResult = await this.db.execute({
      sql: `SELECT id, chat_key, context_id, dify_conversation_id, last_active_at, expires_at
            FROM sessions
            WHERE bot_id = ? AND expires_at > ?
            ORDER BY last_active_at DESC`,
      args: [this.botId, now],
    })

    const sessions: Session[] = []
    for (const row of sessionResult.rows) {
      const msgResult = await this.db.execute({
        sql: 'SELECT role, content, timestamp, response_run_id FROM session_messages WHERE session_id = ? ORDER BY timestamp ASC',
        args: [row.id as string],
      })
      sessions.push({
        id: row.id as string,
        chatKey: row.chat_key as string,
        contextId: row.context_id as string,
        messages: msgResult.rows.map((r) => ({
          role: r.role as 'human' | 'ai',
          content: deserializeContent(r.content as string),
          timestamp: r.timestamp as number,
          responseRunId: (r.response_run_id as string | null) ?? null,
        })),
        difyConversationId: (row.dify_conversation_id as string | null) ?? undefined,
        lastActiveAt: row.last_active_at as number,
        expiresAt: row.expires_at as number,
      })
    }
    return sessions
  }

  async get(chatKey: string): Promise<Session | undefined> {
    const all = await this.getAll()
    return all.find((s) => s.chatKey === chatKey)
  }

  async getMessagesByResponseRunId(responseRunId: string): Promise<SessionMessage[]> {
    const result = await this.db.execute({
      sql: 'SELECT role, content, timestamp, response_run_id FROM session_messages WHERE response_run_id = ? ORDER BY timestamp ASC',
      args: [responseRunId],
    })
    return result.rows.map((r) => ({
      role: r.role as 'human' | 'ai',
      content: deserializeContent(r.content as string),
      timestamp: r.timestamp as number,
      responseRunId: (r.response_run_id as string | null) ?? null,
    }))
  }

  private async cleanup(): Promise<void> {
    await this.db.execute({
      sql: 'DELETE FROM sessions WHERE bot_id = ? AND expires_at < ?',
      args: [this.botId, Date.now()],
    })
  }

  destroy(): void {
    clearInterval(this.cleanupInterval)
  }
}
