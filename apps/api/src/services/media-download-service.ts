import { createHash } from 'crypto'
import { createMediaStore, generateMediaId, mediaExtension } from '@wecom-platform/core'
import { AsyncLimiter } from '@wecom-platform/core'
import type { MediaStore, WecomMediaKind } from '@wecom-platform/types'
import { WecomMediaRepository } from '../db/wecom-media-repository.js'

export interface MediaDownloadJob {
  url: string
  aeskey?: string
  kind: WecomMediaKind
  sourceMessageId?: string | null
  sessionId?: string | null
}

export interface MediaDownloadResult {
  mediaId: string
  dataUrl: string | null
  status: 'pending' | 'ready' | 'expired'
}

interface PendingJob extends MediaDownloadJob {
  mediaId: string
  attempts: number
  expiresAt: number
}

const RETRY_WINDOW_MS = Number(process.env.WECOM_MEDIA_RETRY_WINDOW_MS ?? 240_000)
const MAX_ATTEMPTS = 3
const DECRYPT_FUNCTIONS = new Map<string, (url: string, aeskey: string) => Promise<string>>()

export function registerWecomImageDecrypt(fn: (url: string, aeskey: string) => Promise<string>): void {
  DECRYPT_FUNCTIONS.set('image', fn)
}

async function decryptWecomImage(url: string, aeskey: string): Promise<string> {
  const fn = DECRYPT_FUNCTIONS.get('image')
  if (!fn) throw new Error('WeCom image decrypt function not registered')
  return fn(url, aeskey)
}

function configuredPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export class MediaDownloadService {
  private store: MediaStore
  private limiter: AsyncLimiter
  private queue: PendingJob[] = []
  private flushing = false
  private readonly retryWindowMs: number
  private readonly maxAttempts: number

  constructor(store: MediaStore = createMediaStore()) {
    this.store = store
    this.limiter = new AsyncLimiter(configuredPositiveInt('WECOM_MEDIA_DOWNLOAD_CONCURRENCY', 4))
    this.retryWindowMs = configuredPositiveInt('WECOM_MEDIA_RETRY_WINDOW_MS', RETRY_WINDOW_MS)
    this.maxAttempts = MAX_ATTEMPTS
  }

  get pendingCount(): number {
    return this.queue.length
  }

  async enqueue(job: MediaDownloadJob): Promise<MediaDownloadResult> {
    const urlHash = createHash('sha256').update(job.url).digest('hex').slice(0, 12)
    const mediaId = `wecom_${urlHash}_${Date.now()}`
    const expiresAt = Date.now() + this.retryWindowMs
    await WecomMediaRepository.create({
      kind: job.kind,
      storage: process.env.WECOM_MEDIA_STORAGE === 's3' ? 's3' : 'local',
      storageKey: mediaId,
      sourceMessageId: job.sourceMessageId ?? null,
      sessionId: job.sessionId ?? null,
      expiresAt,
    })
    this.queue.push({ ...job, mediaId, attempts: 0, expiresAt })
    void this.flush()
    return { mediaId, dataUrl: null, status: 'pending' }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift()!
        await this.limiter.run(() => this.process(job))
      }
    } finally {
      this.flushing = false
    }
  }

  private async process(job: PendingJob): Promise<void> {
    try {
      if (Date.now() > job.expiresAt) {
        await WecomMediaRepository.markExpired(job.mediaId)
        return
      }
      job.attempts += 1
      const bytes = await this.download(job)
      const extension = mediaExtension(job.kind, null)
      const storageKey = `${job.mediaId}${extension}`
      const statResult = await this.store.put(storageKey, bytes, { mime: this.mimeFor(job) })
      await WecomMediaRepository.markReady(job.mediaId, {
        mime: statResult.mime,
        sizeBytes: statResult.sizeBytes,
        sha256: statResult.sha256,
        storageKey,
      })
    } catch (err) {
      console.warn(`[MediaDownload] Download failed for ${job.mediaId} (attempt ${job.attempts}/${this.maxAttempts}):`, err)
      if (job.attempts < this.maxAttempts && Date.now() < job.expiresAt) {
        this.queue.push(job)
        setTimeout(() => void this.flush(), Math.min(10_000, Math.max(1_000, 1_000 * job.attempts)))
      } else {
        await WecomMediaRepository.markExpired(job.mediaId).catch(() => {})
      }
    }
  }

  private mimeFor(job: PendingJob): string | null {
    if (job.kind === 'image') return 'image/jpeg'
    if (job.kind === 'video') return 'video/mp4'
    return 'application/octet-stream'
  }

  private async download(job: PendingJob): Promise<Uint8Array> {
    if (job.kind === 'image' && job.aeskey) {
      const dataUrl = await decryptWecomImage(job.url, job.aeskey)
      const base64 = dataUrl.split(',')[1] ?? ''
      return new Uint8Array(Buffer.from(base64, 'base64'))
    }
    const res = await fetch(job.url)
    if (!res.ok) throw new Error(`Media download failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async get(mediaId: string): Promise<Uint8Array | null> {
    const media = await WecomMediaRepository.findById(mediaId)
    if (!media || media.status === 'expired') return null
    if (media.status === 'pending') return null
    return this.store.get(media.storageKey)
  }
}

export function __testGenerateMediaId(bytes: Uint8Array): string {
  return generateMediaId(bytes)
}