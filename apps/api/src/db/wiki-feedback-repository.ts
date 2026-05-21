import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { InValue } from '@libsql/client'
import type { WikiFeedbackClassification, WikiFeedbackItem, WikiFeedbackStatus } from '@wecom-platform/types'

function parseNumberArray(value: unknown): number[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : []
  } catch {
    return []
  }
}

function rowToItem(row: Record<string, unknown>): WikiFeedbackItem {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    responseRunId: (row.response_run_id as string | null) ?? null,
    namespace: (row.namespace as string | null) ?? null,
    feedbackType: row.feedback_type === null || row.feedback_type === undefined ? null : Number(row.feedback_type),
    content: (row.content as string | null) ?? null,
    inaccurateReasons: parseNumberArray(row.inaccurate_reasons),
    classification: row.classification as WikiFeedbackClassification,
    status: row.status as WikiFeedbackStatus,
    assignedTargetPath: (row.assigned_target_path as string | null) ?? null,
    draftId: (row.draft_id as string | null) ?? null,
    resolutionNote: (row.resolution_note as string | null) ?? null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export const WikiFeedbackRepository = {
  async create(data: {
    eventId: string
    responseRunId?: string | null
    namespace?: string | null
    feedbackType?: number | null
    content?: string | null
    inaccurateReasons?: number[]
    classification?: WikiFeedbackClassification
    status?: WikiFeedbackStatus
    assignedTargetPath?: string | null
    resolutionNote?: string | null
  }): Promise<WikiFeedbackItem> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wiki_feedback_items
              (id, event_id, response_run_id, namespace, feedback_type, content,
               inaccurate_reasons, classification, status, assigned_target_path,
               draft_id, resolution_note, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      args: [
        id,
        data.eventId,
        data.responseRunId ?? null,
        data.namespace ?? null,
        data.feedbackType ?? null,
        data.content ?? null,
        JSON.stringify(data.inaccurateReasons ?? []),
        data.classification ?? defaultClassification(data.feedbackType ?? null, data.inaccurateReasons ?? []),
        data.status ?? 'new',
        data.assignedTargetPath ?? null,
        data.resolutionNote ?? null,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<WikiFeedbackItem | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_feedback_items WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToItem(res.rows[0]) : null
  },

  async findByEventId(eventId: string): Promise<WikiFeedbackItem | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_feedback_items WHERE event_id = ? LIMIT 1', args: [eventId] })
    return res.rows[0] ? rowToItem(res.rows[0]) : null
  },

  async list(options: {
    namespace?: string
    status?: string
    classification?: string
    since?: number
    until?: number
    limit?: number
  } = {}): Promise<WikiFeedbackItem[]> {
    const filters: string[] = []
    const args: InValue[] = []
    if (options.namespace) { filters.push('namespace = ?'); args.push(options.namespace) }
    if (options.status) { filters.push('status = ?'); args.push(options.status) }
    if (options.classification) { filters.push('classification = ?'); args.push(options.classification) }
    if (options.since !== undefined) { filters.push('created_at >= ?'); args.push(options.since) }
    if (options.until !== undefined) { filters.push('created_at <= ?'); args.push(options.until) }
    args.push(Math.min(Math.max(options.limit ?? 100, 1), 500))
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const res = await db.execute({
      sql: `SELECT * FROM wiki_feedback_items ${where} ORDER BY created_at DESC LIMIT ?`,
      args,
    })
    return res.rows.map(rowToItem)
  },

  async update(id: string, data: {
    status?: WikiFeedbackStatus
    classification?: WikiFeedbackClassification
    assignedTargetPath?: string | null
    draftId?: string | null
    resolutionNote?: string | null
    namespace?: string | null
  }): Promise<WikiFeedbackItem | null> {
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [Date.now()]
    if (data.status !== undefined) { fields.push('status = ?'); args.push(data.status) }
    if (data.classification !== undefined) { fields.push('classification = ?'); args.push(data.classification) }
    if (data.assignedTargetPath !== undefined) { fields.push('assigned_target_path = ?'); args.push(data.assignedTargetPath) }
    if (data.draftId !== undefined) { fields.push('draft_id = ?'); args.push(data.draftId) }
    if (data.resolutionNote !== undefined) { fields.push('resolution_note = ?'); args.push(data.resolutionNote) }
    if (data.namespace !== undefined) { fields.push('namespace = ?'); args.push(data.namespace) }
    args.push(id)
    await db.execute({ sql: `UPDATE wiki_feedback_items SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async markResolvedByDraftId(draftId: string): Promise<void> {
    await db.execute({
      sql: `UPDATE wiki_feedback_items
            SET status = 'resolved', resolution_note = COALESCE(resolution_note, 'Wiki draft merged'), updated_at = ?
            WHERE draft_id = ?`,
      args: [Date.now(), draftId],
    })
  },

  async metrics(options: { namespace?: string; since?: number; until?: number } = {}) {
    const filters: string[] = []
    const args: InValue[] = []
    if (options.namespace) { filters.push('namespace = ?'); args.push(options.namespace) }
    if (options.since !== undefined) { filters.push('created_at >= ?'); args.push(options.since) }
    if (options.until !== undefined) { filters.push('created_at <= ?'); args.push(options.until) }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const counts = await db.execute({
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN feedback_type = 1 THEN 1 ELSE 0 END) AS positive,
              SUM(CASE WHEN feedback_type = 2 THEN 1 ELSE 0 END) AS negative,
              SUM(CASE WHEN status IN ('new', 'triaged', 'unlinked') THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'drafted' THEN 1 ELSE 0 END) AS drafted
            FROM wiki_feedback_items ${where}`,
      args,
    })
    const reasons = await db.execute({ sql: `SELECT inaccurate_reasons, classification, status FROM wiki_feedback_items ${where}`, args })
    const reasonCounts = new Map<string, number>()
    const classificationCounts = new Map<string, number>()
    for (const row of reasons.rows) {
      for (const reason of parseNumberArray(row.inaccurate_reasons)) {
        reasonCounts.set(String(reason), (reasonCounts.get(String(reason)) ?? 0) + 1)
      }
      const cls = String(row.classification ?? 'unclassified')
      classificationCounts.set(cls, (classificationCounts.get(cls) ?? 0) + 1)
    }
    const row = counts.rows[0] ?? {}
    const positive = Number(row.positive ?? 0)
    const negative = Number(row.negative ?? 0)
    return {
      total: Number(row.total ?? 0),
      positive,
      negative,
      negativeRate: positive + negative === 0 ? 0 : negative / (positive + negative),
      pending: Number(row.pending ?? 0),
      drafted: Number(row.drafted ?? 0),
      reasonCounts: Object.fromEntries(reasonCounts),
      classificationCounts: Object.fromEntries(classificationCounts),
    }
  },
}

export function defaultClassification(feedbackType: number | null, inaccurateReasons: number[]): WikiFeedbackClassification {
  if (feedbackType === 1) return 'positive'
  if (feedbackType === 3) return 'ignored'
  if (feedbackType !== 2) return 'unclassified'
  if (inaccurateReasons.includes(1)) return 'retrieval_issue'
  if (inaccurateReasons.includes(4)) return 'model_or_tool_issue'
  if (inaccurateReasons.includes(2) || inaccurateReasons.includes(3)) return 'knowledge_gap'
  return 'unclassified'
}
