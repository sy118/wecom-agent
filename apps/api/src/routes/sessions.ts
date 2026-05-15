import { Router } from 'express'
import { botManager } from '../bot-manager/bot-manager.js'

export const sessionsRouter: Router = Router()

sessionsRouter.get('/', async (_req, res) => {
  res.json(await botManager.getAllActiveSessions())
})

sessionsRouter.get('/:chatKey', async (req, res) => {
  const chatKey = decodeURIComponent(req.params.chatKey)
  const all = await botManager.getAllActiveSessions()
  const session = all.find((s) => s.chatKey === chatKey)
  if (!session) { res.status(404).json({ error: 'Session not found' }); return }
  res.json(session)
})

sessionsRouter.delete('/:chatKey', async (req, res) => {
  const chatKey = decodeURIComponent(req.params.chatKey)
  const all = await botManager.getAllActiveSessions()
  const session = all.find((s) => s.chatKey === chatKey)
  if (session) {
    botManager.deleteSession((session as any).botId, chatKey)
  }
  res.status(204).send()
})
