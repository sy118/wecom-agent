import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { AnnotationAnswer } from '@wecom-platform/types'

function rowToAnswer(row: Record<string, unknown>): AnnotationAnswer {
  return {
    id: row.id as string,
    question: row.question as string,
    answer: row.answer as string,
    namespace: (row.namespace as string | null) ?? null,
    contextId: (row.context_id as string | null) ?? null,
    sourceType: row.source_type as string,
    sourceRef: (row.source_ref as string | null) ?? null,
    enabled: Number(row.enabled ?? 0) === 1,
    hitCount: Number(row.hit_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export const AnnotationAnswerRepository = {
  async create(data: {
    question: string
    answer: string
    namespace?: string | null
    contextId?: string | null
    sourceType?: string
    sourceRef?: string | null
    enabled?: boolean
  }): Promise<AnnotationAnswer> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO annotation_answers
              (id, question, answer, namespace, context_id, source_type, source_ref,
               enabled, hit_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      args: [
        id,
        data.question.trim(),
        data.answer,
        data.namespace ?? null,
        data.contextId ?? null,
        data.sourceType ?? 'manual',
        data.sourceRef ?? null,
        data.enabled === false ? 0 : 1,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<AnnotationAnswer | null> {
    const res = await db.execute({ sql: 'SELECT * FROM annotation_answers WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToAnswer(res.rows[0]) : null
  },

  async list(options: { namespace?: string; contextId?: string; enabled?: boolean } = {}): Promise<AnnotationAnswer[]> {
    const filters: string[] = []
    const args: import('@libsql/client').InValue[] = []
    if (options.namespace) { filters.push('(namespace = ? OR namespace IS NULL)'); args.push(options.namespace) }
    if (options.contextId) { filters.push('(context_id = ? OR context_id IS NULL)'); args.push(options.contextId) }
    if (options.enabled !== undefined) { filters.push('enabled = ?'); args.push(options.enabled ? 1 : 0) }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const res = await db.execute({ sql: `SELECT * FROM annotation_answers ${where} ORDER BY updated_at DESC`, args })
    return res.rows.map(rowToAnswer)
  },

  async update(id: string, data: {
    question?: string
    answer?: string
    namespace?: string | null
    contextId?: string | null
    sourceType?: string
    sourceRef?: string | null
    enabled?: boolean
  }): Promise<AnnotationAnswer | null> {
    const fields: string[] = ['updated_at = ?']
    const args: import('@libsql/client').InValue[] = [Date.now()]
    if (data.question !== undefined) { fields.push('question = ?'); args.push(data.question.trim()) }
    if (data.answer !== undefined) { fields.push('answer = ?'); args.push(data.answer) }
    if (data.namespace !== undefined) { fields.push('namespace = ?'); args.push(data.namespace) }
    if (data.contextId !== undefined) { fields.push('context_id = ?'); args.push(data.contextId) }
    if (data.sourceType !== undefined) { fields.push('source_type = ?'); args.push(data.sourceType) }
    if (data.sourceRef !== undefined) { fields.push('source_ref = ?'); args.push(data.sourceRef) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    args.push(id)
    await db.execute({ sql: `UPDATE annotation_answers SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async findMatch(question: string, options: { namespace?: string | null; contextId?: string | null } = {}): Promise<AnnotationAnswer | null> {
    const normalized = normalizeQuestion(question)
    const candidates = await this.list({
      namespace: options.namespace ?? undefined,
      contextId: options.contextId ?? undefined,
      enabled: true,
    })
    const match = candidates.find((item) => normalizeQuestion(item.question) === normalized)
    return match ?? null
  },

  async recordHit(id: string): Promise<void> {
    await db.execute({
      sql: 'UPDATE annotation_answers SET hit_count = hit_count + 1, updated_at = ? WHERE id = ?',
      args: [Date.now(), id],
    })
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM annotation_answers WHERE id = ?', args: [id] })
  },
}

function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}
