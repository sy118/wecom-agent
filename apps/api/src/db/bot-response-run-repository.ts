import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { BotProvider, BotResponseRun, BotResponseRunStatus, StallPoint } from '@wecom-platform/types'

function boolValue(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

function rowToRun(row: Record<string, unknown>): BotResponseRun {
  return {
    id: row.id as string,
    feedbackId: (row.feedback_id as string | null) ?? null,
    botId: row.bot_id as string,
    contextId: (row.context_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    chatKey: row.chat_key as string,
    chatId: row.chat_id as string,
    userId: (row.user_id as string | null) ?? null,
    questionPreview: (row.question_preview as string | null) ?? null,
    answerPreview: (row.answer_preview as string | null) ?? null,
    provider: row.provider as BotProvider,
    model: (row.model as string | null) ?? null,
    status: row.status as BotResponseRunStatus,
    error: (row.error as string | null) ?? null,
    difyConversationId: (row.dify_conversation_id as string | null) ?? null,
    feedbackAvailable: boolValue(row.feedback_available),
    stallPoint: (row.stall_point as StallPoint | null) ?? null,
    lastActivityAt: (row.last_activity_at as number | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export const BotResponseRunRepository = {
  async findAll(limit = 100): Promise<BotResponseRun[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM bot_response_runs ORDER BY created_at DESC LIMIT ?',
      args: [limit],
    })
    return res.rows.map(rowToRun)
  },

  async create(data: {
    feedbackId?: string | null
    botId: string
    contextId?: string | null
    sessionId?: string | null
    chatKey: string
    chatId: string
    userId?: string | null
    questionPreview?: string | null
    provider: BotProvider
    model?: string | null
    feedbackAvailable?: boolean
  }): Promise<BotResponseRun> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO bot_response_runs
              (id, feedback_id, bot_id, context_id, session_id, chat_key, chat_id, user_id,
               question_preview, answer_preview, provider, model, status, error,
               dify_conversation_id, feedback_available, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pending', NULL, NULL, ?, ?, ?)`,
      args: [
        id,
        data.feedbackId ?? null,
        data.botId,
        data.contextId ?? null,
        data.sessionId ?? null,
        data.chatKey,
        data.chatId,
        data.userId ?? null,
        preview(data.questionPreview),
        data.provider,
        data.model ?? null,
        data.feedbackAvailable === false ? 0 : 1,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<BotResponseRun | null> {
    const res = await db.execute({ sql: 'SELECT * FROM bot_response_runs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToRun(res.rows[0]) : null
  },

  async findByFeedbackId(feedbackId: string): Promise<BotResponseRun | null> {
    const res = await db.execute({ sql: 'SELECT * FROM bot_response_runs WHERE feedback_id = ?', args: [feedbackId] })
    return res.rows[0] ? rowToRun(res.rows[0]) : null
  },

  async markSent(id: string, answer: string, data: { difyConversationId?: string | null } = {}): Promise<BotResponseRun | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE bot_response_runs
            SET answer_preview = ?, status = 'sent', error = NULL, dify_conversation_id = COALESCE(?, dify_conversation_id), updated_at = ?
            WHERE id = ?`,
      args: [preview(answer), data.difyConversationId ?? null, now, id],
    })
    return this.findById(id)
  },

  async markError(id: string, error: string): Promise<BotResponseRun | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE bot_response_runs SET status = 'error', error = ?, updated_at = ? WHERE id = ?`,
      args: [error, now, id],
    })
    return this.findById(id)
  },

  async markFeedbackUnavailable(id: string, error?: string | null): Promise<BotResponseRun | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE bot_response_runs
            SET status = 'feedback_unavailable', feedback_available = 0, error = ?, updated_at = ?
            WHERE id = ?`,
      args: [error ?? null, now, id],
    })
    return this.findById(id)
  },

  async updateStallPoint(id: string, stallPoint: StallPoint): Promise<BotResponseRun | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE bot_response_runs
            SET stall_point = ?, last_activity_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [stallPoint, now, now, id],
    })
    return this.findById(id)
  },

  async touchActivity(id: string): Promise<void> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE bot_response_runs SET last_activity_at = ?, updated_at = ? WHERE id = ?`,
      args: [now, now, id],
    })
  },
}

export function preview(value: unknown, maxLength = 1200): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const trimmed = text.trim()
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength)}...`
}
