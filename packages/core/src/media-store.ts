import { createHash } from 'crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { dirname, join, normalize, resolve, sep } from 'path'
import type { MediaStore, MediaStoreStat, WecomMediaKind } from '@wecom-platform/types'

// ─── Media ID ────────────────────────────────────────────────────────────────

export function generateMediaId(bytes: Uint8Array): string {
  const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex').slice(0, 16)
  const now = Date.now()
  if (now === lastMediaTimestamp) mediaSequence += 1
  else { lastMediaTimestamp = now; mediaSequence = 0 }
  return `wecom_${hash}_${now}${String(mediaSequence).padStart(3, '0')}`
}

let lastMediaTimestamp = 0
let mediaSequence = 0

export function mediaExtension(kind: WecomMediaKind, mime: string | null): string {
  if (!mime) return kind === 'image' ? '.jpg' : kind === 'video' ? '.mp4' : '.bin'
  const map: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'video/mp4': '.mp4', 'application/pdf': '.pdf', 'text/plain': '.txt',
  }
  return map[mime] ?? '.bin'
}

// ─── Local disk store ────────────────────────────────────────────────────────

export class LocalMediaStore implements MediaStore {
  constructor(private rootDir: string) {}

  private resolveKey(key: string): string {
    const normalized = normalize(key)
    if (!normalized || normalized === '.' || normalized.startsWith('..') || normalized.includes(`..${sep}`) || normalized.includes(':')) {
      throw new Error(`Invalid media key: ${key}`)
    }
    return resolve(this.rootDir, normalized)
  }

  async put(key: string, bytes: Uint8Array, meta?: { mime?: string | null }): Promise<MediaStoreStat> {
    const fullPath = this.resolveKey(key)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, Buffer.from(bytes))
    return {
      sizeBytes: bytes.byteLength,
      mime: meta?.mime ?? null,
      sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const fullPath = this.resolveKey(key)
    try {
      const bytes = await readFile(fullPath)
      return new Uint8Array(bytes)
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key)
    await rm(fullPath, { force: true }).catch(() => {})
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key))
      return true
    } catch {
      return false
    }
  }

  async stat(key: string): Promise<MediaStoreStat | null> {
    const fullPath = this.resolveKey(key)
    try {
      const info = await stat(fullPath)
      const bytes = await readFile(fullPath)
      return {
        sizeBytes: info.size,
        mime: null,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }
    } catch {
      return null
    }
  }
}

// ─── S3-compatible store (minimal SigV4 via fetch) ───────────────────────────

function hmacSha256(key: Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const crypto = globalThis.crypto as Crypto
  const payload = typeof data === 'string' ? new TextEncoder().encode(data) : Buffer.from(data)
  return crypto.subtle.importKey('raw', Buffer.from(key) as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    .then((k) => crypto.subtle.sign('HMAC', k, payload as BufferSource))
    .then((sig) => new Uint8Array(sig))
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : Buffer.from(data)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface S3MediaStoreConfig {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
}

export class S3MediaStore implements MediaStore {
  constructor(private config: S3MediaStoreConfig) {}

  private async sign(method: string, key: string, payload: string | Uint8Array, headers: Record<string, string> = {}): Promise<Record<string, string>> {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const host = new URL(this.config.endpoint).host
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${await sha256Hex(payload)}\nx-amz-date:${amzDate}`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      method,
      `/${this.config.bucket}/${key}`,
      '',
      canonicalHeaders,
      '',
      signedHeaders,
      await sha256Hex(payload),
    ].join('\n')
    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')
    const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${this.config.secretKey}`), dateStamp)
    const regionKey = await hmacSha256(dateKey, this.config.region)
    const serviceKey = await hmacSha256(regionKey, 's3')
    const signingKey = await hmacSha256(serviceKey, 'aws4_request')
    const signature = hex(await hmacSha256(signingKey, stringToSign))
    return {
      Authorization: `AWS4-HMAC-SHA256 Credential=${this.config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': await sha256Hex(payload),
      ...headers,
    }
  }

  private objectUrl(key: string): string {
    const base = this.config.endpoint.replace(/\/$/, '')
    return `${base}/${this.config.bucket}/${encodeURIComponent(key)}`
  }

  async put(key: string, bytes: Uint8Array, meta?: { mime?: string | null }): Promise<MediaStoreStat> {
    const payload = Buffer.from(bytes)
    const headers = await this.sign('PUT', key, payload, meta?.mime ? { 'Content-Type': meta.mime } : {})
    const res = await fetch(this.objectUrl(key), { method: 'PUT', headers, body: payload })
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`)
    return {
      sizeBytes: bytes.byteLength,
      mime: meta?.mime ?? null,
      sha256: createHash('sha256').update(payload).digest('hex'),
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const headers = await this.sign('GET', key, '')
    const res = await fetch(this.objectUrl(key), { method: 'GET', headers })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    const headers = await this.sign('DELETE', key, '')
    await fetch(this.objectUrl(key), { method: 'DELETE', headers }).catch(() => {})
  }

  async exists(key: string): Promise<boolean> {
    const headers = await this.sign('HEAD', key, '')
    const res = await fetch(this.objectUrl(key), { method: 'HEAD', headers })
    return res.ok
  }

  async stat(key: string): Promise<MediaStoreStat | null> {
    const bytes = await this.get(key)
    if (!bytes) return null
    return {
      sizeBytes: bytes.byteLength,
      mime: null,
      sha256: createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
    }
  }
}

// ─── Store factory ────────────────────────────────────────────────────────────

export function createMediaStore(): MediaStore {
  const storage = process.env.WECOM_MEDIA_STORAGE ?? 'local'
  if (storage === 's3') {
    const endpoint = process.env.WECOM_MEDIA_S3_ENDPOINT
    const region = process.env.WECOM_MEDIA_S3_REGION ?? 'us-east-1'
    const bucket = process.env.WECOM_MEDIA_S3_BUCKET
    const accessKey = process.env.WECOM_MEDIA_S3_ACCESS_KEY
    const secretKey = process.env.WECOM_MEDIA_S3_SECRET_KEY
    if (!endpoint || !bucket || !accessKey || !secretKey) {
      throw new Error('WECOM_MEDIA_STORAGE=s3 requires WECOM_MEDIA_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY')
    }
    return new S3MediaStore({ endpoint, region, bucket, accessKey, secretKey })
  }
  return new LocalMediaStore(process.env.WECOM_MEDIA_ROOT ?? './data/media')
}

export { LocalMediaStore as __testLocalMediaStore, S3MediaStore as __testS3MediaStore }
