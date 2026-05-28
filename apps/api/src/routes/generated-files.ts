import { Router } from 'express'
import { generatedFileName, getGeneratedFileDownload } from '../services/generated-file-service.js'
import { logStructured } from '../services/observability.js'

export const generatedFilesRouter: Router = Router()

generatedFilesRouter.get('/:token', async (req, res) => {
  try {
    const download = await getGeneratedFileDownload(req.params.token)
    if (!download) { res.status(404).json({ error: 'File not found or expired' }); return }
    logStructured('generated_file.download', {
      fileId: download.file.id,
      taskId: download.file.taskId,
      botId: download.file.botId,
      ownerUserId: download.file.ownerUserId,
      fileType: download.file.fileType,
    })
    if (download.file.mimeType) res.type(download.file.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${generatedFileName(download.file)}"`)
    res.send(download.bytes)
  } catch {
    res.status(404).json({ error: 'File not found or expired' })
  }
})
