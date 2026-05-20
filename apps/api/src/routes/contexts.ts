import { Router } from 'express'
import { ContextRepository } from '../db/context-repository.js'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { SkillRepository } from '../db/skill-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import type { ContextConfig, McpConfig, SkillConfig } from '@wecom-platform/types'

export const contextsRouter: Router = Router({ mergeParams: true })

async function validateMcpConfigs(mcpConfigs: McpConfig[]): Promise<string | null> {
  if (!Array.isArray(mcpConfigs)) return null
  const servers = await McpServerRepository.findAll()
  const validIds = new Set(servers.map((s) => s.id))
  for (const cfg of mcpConfigs) {
    if (!validIds.has(cfg.mcpServerId)) {
      return `Invalid mcpServerId: ${cfg.mcpServerId}`
    }
  }
  return null
}

async function validateSkillConfigs(skillConfigs: SkillConfig[]): Promise<string | null> {
  if (!Array.isArray(skillConfigs)) return null
  const skills = await SkillRepository.findAll()
  const validIds = new Set(skills.map((s) => s.id))
  for (const cfg of skillConfigs) {
    if (!validIds.has(cfg.skillId)) {
      return `Invalid skillId: ${cfg.skillId}`
    }
  }
  return null
}

async function validateContextConfigs(mcpConfigs: McpConfig[], skillConfigs: SkillConfig[]): Promise<string | null> {
  return (await validateMcpConfigs(mcpConfigs)) ?? (await validateSkillConfigs(skillConfigs))
}

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential)/i

function maskSecretSkillParams(ctx: ContextConfig): ContextConfig {
  return {
    ...ctx,
    skillConfigs: (ctx.skillConfigs ?? []).map((cfg) => {
      const params = { ...(cfg.params ?? {}) }
      for (const key of Object.keys(params)) {
        if (!SENSITIVE_KEY_PATTERN.test(key)) continue
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') params[key] = '******'
      }
      return { ...cfg, params }
    }),
  }
}

async function maskContextResponse(ctx: ContextConfig): Promise<ContextConfig> {
  return maskSecretSkillParams(ctx)
}

contextsRouter.get('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const contexts = await ContextRepository.findByBotId(botId)
  res.json(contexts.map((ctx) => maskSecretSkillParams(ctx)))
})

contextsRouter.post('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const data = { ...req.body, botId, mcpConfigs: req.body.mcpConfigs ?? [], skillConfigs: req.body.skillConfigs ?? [] }
  const err = await validateContextConfigs(data.mcpConfigs, data.skillConfigs)
  if (err) { res.status(400).json({ error: err }); return }
  const created = await ContextRepository.create(data)
  await botManager.refreshContexts(botId)
  res.status(201).json(await maskContextResponse(created))
})

contextsRouter.get('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const ctx = await ContextRepository.findById(id)
  if (!ctx || ctx.botId !== botId) { res.status(404).json({ error: 'Context not found' }); return }
  res.json(await maskContextResponse(ctx))
})

contextsRouter.put('/:id', async (req, res) => {
  const params = req.params as unknown as { botId: string; id: string }
  if (req.body.mcpConfigs !== undefined) {
    const err = await validateMcpConfigs(req.body.mcpConfigs)
    if (err) { res.status(400).json({ error: err }); return }
  }
  if (req.body.skillConfigs !== undefined) {
    const err = await validateSkillConfigs(req.body.skillConfigs)
    if (err) { res.status(400).json({ error: err }); return }
  }
  const ctx = await ContextRepository.update(params.id, req.body)
  if (!ctx) { res.status(404).json({ error: 'Context not found' }); return }
  await botManager.refreshContexts(params.botId)
  res.json(await maskContextResponse(ctx))
})

contextsRouter.delete('/:id', async (req, res) => {
  const { botId } = req.params as { botId: string; id: string }
  await ContextRepository.delete(req.params.id)
  await botManager.refreshContexts(botId)
  res.status(204).send()
})
