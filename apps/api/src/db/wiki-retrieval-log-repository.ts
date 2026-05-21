import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { InValue } from '@libsql/client'

export interface WikiRetrievalLog {
  id: string
  botId: string | null
  contextId: string | null
  chatKey: string | null
  responseRunId: string | null
  namespace: string
  policy: string
  query: string
  hitCount: number
  hitPaths: string[]
  durationMs: number | null
  error: string | null
  createdAt: number
}

export interface WikiMissSummary {
  query: string
  count: number
  latestAt: number
  contextIds: string[]
  chatKeys: string[]
}

export interface WikiHotDocument {
  path: string
  hitCount: number
}

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value as string)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rowToLog(row: Record<string, unknown>): WikiRetrievalLog {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    contextId: (row.context_id as string | null) ?? null,
    chatKey: (row.chat_key as string | null) ?? null,
    responseRunId: (row.response_run_id as string | null) ?? null,
    namespace: row.namespace as string,
    policy: row.policy as string,
    query: row.query as string,
    hitCount: Number(row.hit_count ?? 0),
    hitPaths: parseStringArray(row.hit_paths),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    error: (row.error as string | null) ?? null,
    createdAt: Number(row.created_at),
  }
}

export const WikiRetrievalLogRepository = {
  async create(data: {
    botId?: string | null
    contextId?: string | null
    chatKey?: string | null
    responseRunId?: string | null
    namespace: string
    policy: string
    query: string
    hitCount?: number
    hitPaths?: string[]
    durationMs?: number | null
    error?: string | null
    createdAt?: number
  }): Promise<WikiRetrievalLog> {
    const id = randomUUID()
    const createdAt = data.createdAt ?? Date.now()
    await db.execute({
      sql: `INSERT INTO wiki_retrieval_logs
              (id, bot_id, context_id, chat_key, response_run_id, namespace, policy, query, hit_count, hit_paths, duration_ms, error, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId ?? null,
        data.contextId ?? null,
        data.chatKey ?? null,
        data.responseRunId ?? null,
        data.namespace,
        data.policy,
        data.query,
        data.hitCount ?? 0,
        JSON.stringify(data.hitPaths ?? []),
        data.durationMs ?? null,
        data.error ?? null,
        createdAt,
      ],
    })
    return (await this.findById(id))!
  },

  async findByResponseRunId(responseRunId: string): Promise<WikiRetrievalLog[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM wiki_retrieval_logs WHERE response_run_id = ? ORDER BY created_at ASC',
      args: [responseRunId],
    })
    return res.rows.map(rowToLog)
  },

  async findById(id: string): Promise<WikiRetrievalLog | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_retrieval_logs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToLog(res.rows[0]) : null
  },

  async findByNamespace(namespace: string, options: {
    since?: number
    until?: number
    missesOnly?: boolean
    limit?: number
  } = {}): Promise<WikiRetrievalLog[]> {
    const filters = ['namespace = ?']
    const args: InValue[] = [namespace]
    if (options.since !== undefined) { filters.push('created_at >= ?'); args.push(options.since) }
    if (options.until !== undefined) { filters.push('created_at <= ?'); args.push(options.until) }
    if (options.missesOnly) filters.push('hit_count = 0')
    args.push(Math.min(Math.max(options.limit ?? 100, 1), 500))
    const res = await db.execute({
      sql: `SELECT * FROM wiki_retrieval_logs WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      args,
    })
    return res.rows.map(rowToLog)
  },

  async countByNamespace(namespace: string, since?: number): Promise<{ total: number; misses: number }> {
    const filters = ['namespace = ?']
    const args: InValue[] = [namespace]
    if (since !== undefined) { filters.push('created_at >= ?'); args.push(since) }
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS total, SUM(CASE WHEN hit_count = 0 THEN 1 ELSE 0 END) AS misses
            FROM wiki_retrieval_logs WHERE ${filters.join(' AND ')}`,
      args,
    })
    const row = res.rows[0] ?? {}
    return { total: Number(row.total ?? 0), misses: Number(row.misses ?? 0) }
  },

  async summarizeMisses(namespace: string, since?: number, limit = 20): Promise<WikiMissSummary[]> {
    const filters = ['namespace = ?', 'hit_count = 0']
    const args: InValue[] = [namespace]
    if (since !== undefined) { filters.push('created_at >= ?'); args.push(since) }
    args.push(Math.min(Math.max(limit, 1), 100))
    const res = await db.execute({
      sql: `SELECT query, COUNT(*) AS count, MAX(created_at) AS latest_at
            FROM wiki_retrieval_logs
            WHERE ${filters.join(' AND ')}
            GROUP BY query
            ORDER BY count DESC, latest_at DESC
            LIMIT ?`,
      args,
    })
    const summaries: WikiMissSummary[] = []
    for (const row of res.rows) {
      const query = row.query as string
      const details = await db.execute({
        sql: `SELECT DISTINCT context_id, chat_key
              FROM wiki_retrieval_logs
              WHERE namespace = ? AND hit_count = 0 AND query = ?
              ORDER BY created_at DESC
              LIMIT 10`,
        args: [namespace, query],
      })
      summaries.push({
        query,
        count: Number(row.count ?? 0),
        latestAt: Number(row.latest_at ?? 0),
        contextIds: [...new Set(details.rows.map((item) => item.context_id).filter((item): item is string => typeof item === 'string'))],
        chatKeys: [...new Set(details.rows.map((item) => item.chat_key).filter((item): item is string => typeof item === 'string'))],
      })
    }
    return summaries
  },

  async hotDocuments(namespace: string, since?: number, limit = 10): Promise<WikiHotDocument[]> {
    const logs = await this.findByNamespace(namespace, { since, limit: 500 })
    const counts = new Map<string, number>()
    for (const log of logs) {
      for (const path of log.hitPaths) {
        counts.set(path, (counts.get(path) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([path, hitCount]) => ({ path, hitCount }))
  },
}
