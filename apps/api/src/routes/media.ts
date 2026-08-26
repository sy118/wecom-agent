import { Router } from 'express'
import { MediaDownloadService } from '../services/media-download-service.js'
import { WecomMediaRepository } from '../db/wecom-media-repository.js'
import { AuditLogRepository } from '../db/wecom-access-repository.js'

export const mediaRouter: Router = Router()

const mediaReadService = new MediaDownloadService()

function actorOf(req: { headers: Record<string, any> }): string | null {
  const actor = req.headers['x-user-id']
  return typeof actor === 'string' && actor.trim() ? actor.trim() : null
}

function auditMediaAccess(mediaId: string, result: 'success' | 'denied', reason: string | null, actor: string | null): void {
  void AuditLogRepository.create({
    actorUserId: actor,
    action: 'media.access',
    targetType: 'wecom_media',
    targetId: mediaId,
    result,
    reason,
  }).catch((err) => console.error(`[Media] Failed to audit access ${mediaId}:`, err))
}

mediaRouter.get('/:id', async (req, res) => {
  const mediaId = req.params.id
  const actor = actorOf(req)
  const media = await WecomMediaRepository.findById(mediaId)
  if (!media) {
    auditMediaAccess(mediaId, 'denied', 'media_not_found', actor)
    res.status(404).json({ error: '媒体不存在' })
    return
  }
  if (media.status === 'expired') {
    auditMediaAccess(mediaId, 'denied', 'media_expired', actor)
    res.status(404).json({ error: '媒体已过期' })
    return
  }
  if (media.status === 'pending') {
    auditMediaAccess(mediaId, 'denied', 'media_pending', actor)
    res.status(404).json({ error: '媒体暂不可用，正在重试' })
    return
  }
  const bytes = await mediaReadService.get(mediaId)
  if (!bytes) {
    auditMediaAccess(mediaId, 'denied', 'media_store_missing', actor)
    res.status(404).json({ error: '媒体文件不存在' })
    return
  }
  auditMediaAccess(mediaId, 'success', null, actor)
  res.setHeader('Content-Type', media.mime ?? 'application/octet-stream')
  res.setHeader('Content-Length', String(bytes.byteLength))
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.end(Buffer.from(bytes))
})
