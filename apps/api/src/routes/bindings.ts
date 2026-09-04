import { Router } from 'express'
import { BindingRepository } from '../db/binding-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import { BotRepository } from '../db/bot-repository.js'
import type { ChatType } from '@wecom-platform/types'

export const bindingsRouter: Router = Router({ mergeParams: true })

function parseChatType(value: unknown): ChatType | null {
  return value === 'group' || value === 'user' ? value : null
}

bindingsRouter.get('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await BindingRepository.findByBotId(botId))
})

bindingsRouter.get('/settings', async (req, res) => {
  const botId = (req.params as { botId: string }).botId
  const bot = await BotRepository.findById(botId)
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }
  res.json({ allowUnboundAccess: bot.allowUnboundAccess !== false })
})

bindingsRouter.put('/settings', async (req, res) => {
  const botId = (req.params as { botId: string }).botId
  if (typeof req.body.allowUnboundAccess !== 'boolean') {
    res.status(400).json({ error: 'allowUnboundAccess must be boolean' })
    return
  }
  const bot = await BotRepository.update(botId, { allowUnboundAccess: req.body.allowUnboundAccess })
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }
  botManager.updateAccessPolicy(botId, req.body.allowUnboundAccess)
  res.json({ allowUnboundAccess: bot.allowUnboundAccess !== false })
})

// GET /api/bots/:botId/bindings/discovered — chats seen but not yet bound
bindingsRouter.get('/discovered', (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(botManager.getDiscoveredChats(botId))
})

bindingsRouter.post('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const data = { ...req.body, botId }
  const context = await ContextRepository.findById(data.contextId)
  if (!context || context.botId !== botId) { res.status(400).json({ error: 'Invalid contextId' }); return }
  const chatType = parseChatType(data.chatType)
  if (!chatType) { res.status(400).json({ error: 'chatType must be group or user' }); return }
  const binding = await BindingRepository.upsert({ ...data, chatType })
  await botManager.refreshBindings(botId)
  res.status(201).json(binding)
})

bindingsRouter.put('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const existing = await BindingRepository.findById(botId, id)
  if (!existing) { res.status(404).json({ error: 'Binding not found' }); return }
  if (req.body.chatKey !== undefined && req.body.chatKey !== existing.chatKey) {
    res.status(400).json({ error: 'chatKey cannot be changed' })
    return
  }
  const context = await ContextRepository.findById(req.body.contextId)
  if (!context || context.botId !== botId) { res.status(400).json({ error: 'Invalid contextId' }); return }
  const chatType = parseChatType(req.body.chatType)
  if (!chatType) { res.status(400).json({ error: 'chatType must be group or user' }); return }
  const binding = await BindingRepository.update(botId, id, {
    contextId: context.id,
    chatName: req.body.chatName ?? null,
    chatType,
  })
  if (!binding) { res.status(404).json({ error: 'Binding not found' }); return }
  botManager.updateBinding(botId, binding.chatKey, binding.contextId)
  res.json(binding)
})

bindingsRouter.delete('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const binding = await BindingRepository.delete(botId, id)
  if (binding) botManager.removeBinding(botId, binding.chatKey)
  res.status(204).send()
})
