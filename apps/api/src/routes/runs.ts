import { Router } from 'express'
import { botManager } from '../bot-manager/bot-manager.js'
import { BotResponseRunRepository } from '../db/bot-response-run-repository.js'
import { RunStageEventRepository } from '../db/run-stage-event-repository.js'

export const runsRouter: Router = Router()

runsRouter.get('/', async (_req, res) => {
  res.json(await BotResponseRunRepository.findAll())
})

runsRouter.get('/diagnostics', async (_req, res) => {
  res.json(botManager.getRunDiagnostics())
})

runsRouter.get('/:id', async (req, res) => {
  const run = await BotResponseRunRepository.findById(req.params.id)
  if (!run) { res.status(404).json({ error: 'Run not found' }); return }
  const stages = await RunStageEventRepository.findByRunId(run.id)
  res.json({ ...run, stages })
})

runsRouter.post('/:id/cancel', async (req, res) => {
  const run = await BotResponseRunRepository.findById(req.params.id)
  if (!run) { res.status(404).json({ error: 'Run not found' }); return }
  const actor = typeof req.body?.actorUserId === 'string' ? req.body.actorUserId : null
  const result = await botManager.cancelRun(run.botId, run.id, actor)
  res.json(result)
})

runsRouter.post('/:id/retry', async (req, res) => {
  const run = await BotResponseRunRepository.findById(req.params.id)
  if (!run) { res.status(404).json({ error: 'Run not found' }); return }
  const result = await botManager.retryRun(run.botId, run.id)
  if (!result.ok || !result.runId) { res.status(400).json(result); return }
  const newRun = await BotResponseRunRepository.findById(result.runId)
  res.status(201).json(newRun)
})