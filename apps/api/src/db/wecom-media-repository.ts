import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { WecomMedia, WecomMediaKind, WecomMediaStatus } from '@wecom-platform/types'

function rowToMedia(row: Record<string, unknown>): WecomMedia {
  return {
    id: row.id as string,
    kind: row.kind as WecomMediaKind,
    mime: (row.mime as string | null) ?? null,
    sizeBytes: (row.size_bytes as number | null) ?? null,
    sha256: (row.sha256 as string | null) ?? null,
    storage: row.storage as 'local' | 's3',
    storageKey: row.storage_key as string,
    sourceMessageId: (row.source_message_id as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
    status: row.status as WecomMediaStatus,
    createdAt: Number(row.created_at),
    expiresAt: (row.expires_at as number | null) ?? null,
  }
}

export const WecomMediaRepository = {
  async create(data: {
    kind: WecomMediaKind
    mime?: string | null
    sizeBytes?: number | null
    sha256?: string | null
    storage: 'local' | 's3'
    storageKey: string
    sourceMessageId?: string | null
    sessionId?: string | null
    expiresAt?: number | null
  }): Promise<WecomMedia> {
    const id = data.storageKey.startsWith('wecom_') ? data.storageKey : `wecom_${data.storageKey}`
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wecom_media
              (id, kind, mime, size_bytes, sha256, storage, storage_key, source_message_id, session_id, status, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [
        id,
        data.kind,
        data.mime ?? null,
        data.sizeBytes ?? null,
        data.sha256 ?? null,
        data.storage,
        data.storageKey,
        data.sourceMessageId ?? null,
        data.sessionId ?? null,
        now,
        data.expiresAt ?? null,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<WecomMedia | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wecom_media WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToMedia(res.rows[0]) : null
  },

  async findBySession(sessionId: string): Promise<WecomMedia[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM wecom_media WHERE session_id = ? ORDER BY created_at DESC',
      args: [sessionId],
    })
    return res.rows.map(rowToMedia)
  },

  async findBySourceMessage(sourceMessageId: string): Promise<WecomMedia | null> {
    const res = await db.execute({
      sql: 'SELECT * FROM wecom_media WHERE source_message_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [sourceMessageId],
    })
    return res.rows[0] ? rowToMedia(res.rows[0]) : null
  },

  async linkSessionBySourceMessage(sourceMessageId: string, sessionId: string): Promise<void> {
    await db.execute({
      sql: `UPDATE wecom_media SET session_id = ?
            WHERE source_message_id = ? AND (session_id IS NULL OR session_id = '')`,
      args: [sessionId, sourceMessageId],
    })
  },

  async markReady(id: string, data: { mime?: string | null; sizeBytes?: number | null; sha256?: string | null; storageKey?: string }): Promise<void> {
    await db.execute({
      sql: `UPDATE wecom_media
            SET status = 'ready', mime = COALESCE(?, mime), size_bytes = COALESCE(?, size_bytes),
                sha256 = COALESCE(?, sha256), storage_key = COALESCE(?, storage_key), expires_at = NULL
            WHERE id = ?`,
      args: [data.mime ?? null, data.sizeBytes ?? null, data.sha256 ?? null, data.storageKey ?? null, id],
    })
  },

  async markExpired(id: string): Promise<void> {
    await db.execute({ sql: `UPDATE wecom_media SET status = 'expired' WHERE id = ?`, args: [id] })
  },

  async markPending(id: string): Promise<void> {
    await db.execute({ sql: `UPDATE wecom_media SET status = 'pending' WHERE id = ?`, args: [id] })
  },

  async findPendingExpired(now = Date.now()): Promise<WecomMedia[]> {
    const res = await db.execute({
      sql: `SELECT * FROM wecom_media WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`,
      args: [now],
    })
    return res.rows.map(rowToMedia)
  },

  async findReadyExpired(now = Date.now()): Promise<WecomMedia[]> {
    const res = await db.execute({
      sql: `SELECT * FROM wecom_media WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at < ?`,
      args: [now],
    })
    return res.rows.map(rowToMedia)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM wecom_media WHERE id = ?', args: [id] })
  },

  async listAll(limit = 5000): Promise<WecomMedia[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM wecom_media ORDER BY created_at ASC LIMIT ?',
      args: [limit],
    })
    return res.rows.map(rowToMedia)
  },

  async countReferences(mediaId: string): Promise<number> {
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM session_messages WHERE content LIKE ?`,
      args: [`%${mediaId}%`],
    })
    return Number(res.rows[0]?.cnt ?? 0)
  },
}

export function __testRowToMedia(row: Record<string, unknown>): WecomMedia {
  return rowToMedia(row)
}
