import { createHash } from 'crypto'
import { createMediaStore } from '@wecom-platform/core'
import type { MediaStore, IncomingContent } from '@wecom-platform/types'
import { db } from '../db/client.js'
import { WecomMediaRepository } from '../db/wecom-media-repository.js'
import { AuditLogRepository } from '../db/wecom-access-repository.js'
import { MediaDownloadService } from './media-download-service.js'

const WECOM_URL_RE = /^https?:\/\/(?:[^/]*\.)?(?:qpic\.cn|wx\.qq\.com|weixin\.qq\.com|wechat\.com|work\.weixin\.qq\.com|wework\.cn|cdn\.)\//i

function configuredPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function configuredNonNegativeInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export interface MediaMigrationReport {
  scanned: number
  migrated: number
  expired: number
  skipped: number
}

export interface MediaCleanupReport {
  expired: number
  deleted: number
  freedBytes: number
  overQuota: boolean
}

function parseContentRow(raw: string): IncomingContent[] | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed as IncomingContent[] : null
  } catch {
    return null
  }
}

function urlHash(url: string): string {
  return createHash('sha256').update(url).digest('hex').slice(0, 16)
}

function isWecomUrl(url: string): boolean {
  if (!url || url.startsWith('data:')) return false
  return WECOM_URL_RE.test(url) || url.startsWith('https://')
}

/**
 * 后台迁移任务：分页扫描历史 session_messages 中的企微临时 URL。
 * 消息时间在重试窗口内 → 尽力入队下载并替换为媒体 ID；
 * 已超期 → 直接替换为 expired 媒体引用，界面显示“媒体已过期”，不再访问企微 URL。
 */
export async function migrateHistoricalMedia(service = new MediaDownloadService()): Promise<MediaMigrationReport> {
  const report: MediaMigrationReport = { scanned: 0, migrated: 0, expired: 0, skipped: 0 }
  const retryWindowMs = configuredPositiveInt('WECOM_MEDIA_RETRY_WINDOW_MS', 240_000)
  const pageSize = 200
  const seenUrls = new Set<string>()
  let offset = 0

  for (;;) {
    const res = await db.execute({
      sql: `SELECT id, session_id, content, timestamp FROM session_messages
            ORDER BY timestamp ASC LIMIT ? OFFSET ?`,
      args: [pageSize, offset],
    })
    if (res.rows.length === 0) break

    for (const row of res.rows) {
      const items = parseContentRow(row.content as string)
      if (!items) continue
      report.scanned += 1
      let changed = false
      const next = items.map((item) => {
        if (item.type !== 'image') return item
        const url = item.url
        if (!isWecomUrl(url)) return item
        if (seenUrls.has(url)) {
          report.skipped += 1
          return item
        }
        seenUrls.add(url)
        const age = Date.now() - Number(row.timestamp ?? 0)
        if (age > retryWindowMs) {
          report.expired += 1
          changed = true
          return { type: 'media', mediaId: `wecom_hist_${urlHash(url)}`, kind: 'image', status: 'expired' }
        }
        const mediaId = `wecom_hist_${urlHash(url)}_${Date.now()}`
        void service.enqueue({
          url,
          kind: 'image',
          sourceMessageId: null,
          sessionId: String(row.session_id ?? ''),
        }).catch((err) => console.error(`[MediaMigration] enqueue failed for ${url}:`, err))
        report.migrated += 1
        changed = true
        return { type: 'media', mediaId, kind: 'image' }
      })
      if (changed) {
        await db.execute({
          sql: 'UPDATE session_messages SET content = ? WHERE id = ?',
          args: [JSON.stringify(next), String(row.id)],
        })
      }
    }
    offset += pageSize
  }
  return report
}

function isReferenced(mediaId: string): Promise<number> {
  return WecomMediaRepository.countReferences(mediaId)
}

/**
 * 每日清理任务：
 * 1. pending 超重试窗口 → expired；
 * 2. ready 超过保留时长且无消息引用 → 删除文件与记录；
 * 3. 总配额超限时按最旧优先删除未被引用的媒体。
 */
export async function cleanupExpiredMedia(): Promise<MediaCleanupReport> {
  const store: MediaStore = createMediaStore()
  const report: MediaCleanupReport = { expired: 0, deleted: 0, freedBytes: 0, overQuota: false }
  const retentionMs = configuredNonNegativeInt('WECOM_MEDIA_RETENTION_MS', 30 * 24 * 60 * 60 * 1000)
  const quotaBytes = configuredNonNegativeInt('WECOM_MEDIA_QUOTA_BYTES', 10 * 1024 * 1024 * 1024)
  const now = Date.now()

  const pendingExpired = await WecomMediaRepository.findPendingExpired(now)
  for (const media of pendingExpired) {
    await WecomMediaRepository.markExpired(media.id)
    report.expired += 1
  }

  const all = await WecomMediaRepository.listAll()
  const ready = all.filter((media) => media.status === 'ready' && media.storageKey)
  let totalBytes = ready.reduce((sum, media) => sum + (media.sizeBytes ?? 0), 0)

  const candidates: Array<{ media: typeof ready[number]; ageMs: number }> = []
  for (const media of ready) {
    const referenced = await isReferenced(media.id)
    const ageMs = now - media.createdAt
    if (referenced === 0) candidates.push({ media, ageMs })
    if (referenced === 0 && ageMs > retentionMs) {
      await store.delete(media.storageKey).catch(() => {})
      await WecomMediaRepository.delete(media.id)
      report.deleted += 1
      report.freedBytes += media.sizeBytes ?? 0
      totalBytes -= media.sizeBytes ?? 0
    }
  }

  if (totalBytes > quotaBytes) {
    report.overQuota = true
    candidates.sort((a, b) => a.ageMs - b.ageMs)
    for (const { media } of candidates) {
      if (totalBytes <= quotaBytes) break
      await store.delete(media.storageKey).catch(() => {})
      await WecomMediaRepository.delete(media.id)
      report.deleted += 1
      report.freedBytes += media.sizeBytes ?? 0
      totalBytes -= media.sizeBytes ?? 0
    }
  }

  await AuditLogRepository.create({
    action: 'media.cleanup',
    targetType: 'wecom_media',
    result: 'success',
    payload: report,
  }).catch(() => {})

  return report
}

export function __testIsWecomUrl(url: string): boolean {
  return isWecomUrl(url)
}
