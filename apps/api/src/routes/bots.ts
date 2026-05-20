import { Router, Response } from 'express'
import { BotRepository } from '../db/bot-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import type { BotStatusEvent } from '@wecom-platform/types'

export const botsRouter: Router = Router()

// SSE clients registry
const sseClients = new Set<Response>()

const RUNTIME_RESTART_FIELDS = new Set([
  'wecomBotId',
  'wecomBotSecret',
  'wecomWsUrl',
  'llmApiKey',
  'llmBaseUrl',
  'llmModel',
  'provider',
  'streamingMode',
  'difyBaseUrl',
  'difyApiKey',
  'difyAppId',
  'visionEnabled',
])

function hasRuntimeRestartChange(before: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((key) => RUNTIME_RESTART_FIELDS.has(key) && patch[key] !== before[key])
}

// Forward BotManager status events to all SSE clients
botManager.on('status', (event: BotStatusEvent) => {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    client.write(data)
  }
})

// GET /api/bots
botsRouter.get('/', async (_req, res) => {
  res.json(await BotRepository.findAll())
})

// POST /api/bots
botsRouter.post('/', async (req, res) => {
  const bot = await BotRepository.create(req.body)
  res.status(201).json(bot)
})

// GET /api/bots/events  — SSE (must be before /:id)
botsRouter.get('/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Send current statuses on connect
  const bots = await BotRepository.findAll()
  for (const bot of bots) {
    const event: BotStatusEvent = { type: 'bot_status', botId: bot.id, status: bot.status }
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

// GET /api/bots/:id
botsRouter.get('/:id', async (req, res) => {
  const bot = await BotRepository.findById(req.params.id)
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }
  res.json(bot)
})

// PUT /api/bots/:id
botsRouter.put('/:id', async (req, res) => {
  const before = await BotRepository.findById(req.params.id)
  if (!before) { res.status(404).json({ error: 'Bot not found' }); return }
  const bot = await BotRepository.update(req.params.id, req.body)
  if (!bot) { res.status(404).json({ error: 'Bot not found' }); return }
  if (botManager.isRunning(req.params.id) && hasRuntimeRestartChange(before as unknown as Record<string, unknown>, req.body)) {
    try {
      await botManager.restart(req.params.id)
    } catch (err) {
      res.status(500).json({ error: `Bot updated but runtime restart failed: ${err instanceof Error ? err.message : String(err)}` })
      return
    }
  }
  res.json(bot)
})

// DELETE /api/bots/:id
botsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  await botManager.stop(id).catch(() => {})
  await BotRepository.delete(id)
  res.status(204).send()
})

// POST /api/bots/:id/start
botsRouter.post('/:id/start', async (req, res) => {
  try {
    await botManager.start(req.params.id)
    res.json({ status: 'running' })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// POST /api/bots/:id/stop
botsRouter.post('/:id/stop', async (req, res) => {
  await botManager.stop(req.params.id)
  res.json({ status: 'stopped' })
})
