import { Router } from 'express'
import { BindingRepository } from '../db/binding-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'

export const bindingsRouter: Router = Router({ mergeParams: true })

bindingsRouter.get('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await BindingRepository.findByBotId(botId))
})

// GET /api/bots/:botId/bindings/discovered — chats seen but not yet bound
bindingsRouter.get('/discovered', (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(botManager.getDiscoveredChats(botId))
})

bindingsRouter.post('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const data = { ...req.body, botId }
  const binding = await BindingRepository.upsert(data)
  // Sync in-memory binding map so running bot picks it up immediately
  botManager.addBinding(botId, data.chatKey, data.contextId)
  res.status(201).json(binding)
})

bindingsRouter.delete('/:id', async (req, res) => {
  await BindingRepository.delete(req.params.id)
  res.status(204).send()
})
