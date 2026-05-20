import { randomUUID } from 'crypto'
import { db } from './client.js'

export type WikiDraftStatus = 'pending' | 'merged' | 'rejected'

export interface WikiKnowledgeDraft {
  id: string
  namespace: string
  targetPath: string
  content: string
  sourceType: string
  sourceRef: string | null
  status: WikiDraftStatus
  mergeStrategy: string
  reviewReason: string | null
  reviewedBy: string | null
  reviewedAt: number | null
  createdAt: number
  updatedAt: number
}

function rowToDraft(row: Record<string, unknown>): WikiKnowledgeDraft {
  return {
    id: row.id as string,
    namespace: row.namespace as string,
    targetPath: row.target_path as string,
    content: row.content as string,
    sourceType: row.source_type as string,
    sourceRef: (row.source_ref as string | null) ?? null,
    status: row.status as WikiDraftStatus,
    mergeStrategy: (row.merge_strategy as string | null) ?? 'append',
    reviewReason: (row.review_reason as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as number | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const WikiDraftRepository = {
  async findByNamespace(namespace: string): Promise<WikiKnowledgeDraft[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM wiki_knowledge_drafts WHERE namespace = ? ORDER BY created_at DESC',
      args: [namespace],
    })
    return res.rows.map(rowToDraft)
  },

  async findById(id: string): Promise<WikiKnowledgeDraft | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_knowledge_drafts WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToDraft(res.rows[0]) : null
  },

  async create(data: {
    namespace: string
    targetPath: string
    content: string
    sourceType?: string
    sourceRef?: string | null
    mergeStrategy?: string
  }): Promise<WikiKnowledgeDraft> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wiki_knowledge_drafts
              (id, namespace, target_path, content, source_type, source_ref, status,
               merge_strategy, review_reason, reviewed_by, reviewed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?, ?)`,
      args: [
        id,
        data.namespace,
        data.targetPath,
        data.content,
        data.sourceType ?? 'manual',
        data.sourceRef ?? null,
        data.mergeStrategy ?? 'append',
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: {
    targetPath?: string
    content?: string
    sourceRef?: string | null
    mergeStrategy?: string
    reviewReason?: string | null
  }): Promise<WikiKnowledgeDraft | null> {
    const fields: string[] = ['updated_at = ?']
    const args: import('@libsql/client').InValue[] = [Date.now()]
    if (data.targetPath !== undefined) { fields.push('target_path = ?'); args.push(data.targetPath) }
    if (data.content !== undefined) { fields.push('content = ?'); args.push(data.content) }
    if (data.sourceRef !== undefined) { fields.push('source_ref = ?'); args.push(data.sourceRef) }
    if (data.mergeStrategy !== undefined) { fields.push('merge_strategy = ?'); args.push(data.mergeStrategy) }
    if (data.reviewReason !== undefined) { fields.push('review_reason = ?'); args.push(data.reviewReason) }
    args.push(id)
    await db.execute({ sql: `UPDATE wiki_knowledge_drafts SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async countPendingByNamespace(namespace: string): Promise<number> {
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS count FROM wiki_knowledge_drafts WHERE namespace = ? AND status = 'pending'`,
      args: [namespace],
    })
    return Number(res.rows[0]?.count ?? 0)
  },

  async markMerged(id: string, reviewedBy?: string | null): Promise<WikiKnowledgeDraft | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE wiki_knowledge_drafts
            SET status = 'merged', reviewed_by = ?, reviewed_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [reviewedBy ?? null, now, now, id],
    })
    return this.findById(id)
  },

  async markRejected(id: string, reason: string | null, reviewedBy?: string | null): Promise<WikiKnowledgeDraft | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE wiki_knowledge_drafts
            SET status = 'rejected', review_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [reason, reviewedBy ?? null, now, now, id],
    })
    return this.findById(id)
  },
}
