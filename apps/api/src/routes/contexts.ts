import { Router } from 'express'
import { ContextRepository } from '../db/context-repository.js'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { SkillRepository } from '../db/skill-repository.js'
import type { McpConfig, SkillConfig } from '@wecom-platform/types'

export const contextsRouter: Router = Router({ mergeParams: true })

async function validateMcpConfigs(botId: string, mcpConfigs: McpConfig[]): Promise<string | null> {
  if (!Array.isArray(mcpConfigs)) return null
  const servers = await McpServerRepository.findByBotId(botId)
  const validIds = new Set(servers.map((s) => s.id))
  for (const cfg of mcpConfigs) {
    if (!validIds.has(cfg.mcpServerId)) {
      return `Invalid mcpServerId: ${cfg.mcpServerId}`
    }
  }
  return null
}

async function validateSkillConfigs(botId: string, skillConfigs: SkillConfig[]): Promise<string | null> {
  if (!Array.isArray(skillConfigs)) return null
  const skills = await SkillRepository.findByBotId(botId)
  const validIds = new Set(skills.map((s) => s.id))
  for (const cfg of skillConfigs) {
    if (!validIds.has(cfg.skillId)) {
      return `Invalid skillId: ${cfg.skillId}`
    }
  }
  return null
}

async function validateContextConfigs(botId: string, mcpConfigs: McpConfig[], skillConfigs: SkillConfig[]): Promise<string | null> {
  return (await validateMcpConfigs(botId, mcpConfigs)) ?? (await validateSkillConfigs(botId, skillConfigs))
}

contextsRouter.get('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  res.json(await ContextRepository.findByBotId(botId))
})

contextsRouter.post('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const data = { ...req.body, botId, mcpConfigs: req.body.mcpConfigs ?? [], skillConfigs: req.body.skillConfigs ?? [] }
  const err = await validateContextConfigs(botId, data.mcpConfigs, data.skillConfigs)
  if (err) { res.status(400).json({ error: err }); return }
  res.status(201).json(await ContextRepository.create(data))
})

contextsRouter.get('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const ctx = await ContextRepository.findById(id)
  if (!ctx || ctx.botId !== botId) { res.status(404).json({ error: 'Context not found' }); return }
  res.json(ctx)
})

contextsRouter.put('/:id', async (req, res) => {
  const params = req.params as unknown as { botId: string; id: string }
  if (req.body.mcpConfigs !== undefined) {
    const err = await validateMcpConfigs(params.botId, req.body.mcpConfigs)
    if (err) { res.status(400).json({ error: err }); return }
  }
  if (req.body.skillConfigs !== undefined) {
    const err = await validateSkillConfigs(params.botId, req.body.skillConfigs)
    if (err) { res.status(400).json({ error: err }); return }
  }
  const ctx = await ContextRepository.update(params.id, req.body)
  if (!ctx) { res.status(404).json({ error: 'Context not found' }); return }
  res.json(ctx)
})

contextsRouter.delete('/:id', async (req, res) => {
  await ContextRepository.delete(req.params.id)
  res.status(204).send()
})
