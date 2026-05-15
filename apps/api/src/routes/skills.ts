import { Router } from 'express'
import { SkillRepository } from '../db/skill-repository.js'
import { SkillAuditRepository } from '../db/skill-audit-repository.js'
import type { SkillDefinition } from '@wecom-platform/types'

export const skillsRouter: Router = Router({ mergeParams: true })

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential)/i

function maskSensitive(value: unknown, schemaKeys = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => maskSensitive(item, schemaKeys))
  if (!value || typeof value !== 'object') return value
  const masked: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (schemaKeys.has(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = child === undefined || child === null || child === '' ? child : '******'
    } else {
      masked[key] = maskSensitive(child, schemaKeys)
    }
  }
  return masked
}

function toPublicSkill(skill: SkillDefinition): SkillDefinition {
  const secretKeys = new Set((skill.paramSchema ?? []).filter((item) => item.type === 'secret').map((item) => item.key))
  return {
    ...skill,
    manifest: maskSensitive(skill.manifest, secretKeys) as SkillDefinition['manifest'],
  }
}

skillsRouter.get('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const skills = await SkillRepository.findByBotId(botId)
  res.json(skills.map(toPublicSkill))
})

skillsRouter.post('/', async (req, res) => {
  const { botId } = req.params as { botId: string }
  const skill = await SkillRepository.create({
    ...req.body,
    botId,
    description: req.body.description ?? '',
    enabled: req.body.enabled ?? true,
    manifest: req.body.manifest ?? {},
    paramSchema: req.body.paramSchema ?? [],
    permissionPolicy: req.body.permissionPolicy ?? {},
  })
  res.status(201).json(toPublicSkill(skill))
})

skillsRouter.get('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const skill = await SkillRepository.findById(id)
  if (!skill || skill.botId !== botId) { res.status(404).json({ error: 'Skill not found' }); return }
  res.json(toPublicSkill(skill))
})

skillsRouter.put('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const existing = await SkillRepository.findById(id)
  if (!existing || existing.botId !== botId) { res.status(404).json({ error: 'Skill not found' }); return }
  const skill = await SkillRepository.update(id, req.body)
  res.json(toPublicSkill(skill!))
})

skillsRouter.delete('/:id', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const existing = await SkillRepository.findById(id)
  if (!existing || existing.botId !== botId) { res.status(404).json({ error: 'Skill not found' }); return }
  await SkillRepository.delete(id)
  res.status(204).send()
})

skillsRouter.get('/:id/audit', async (req, res) => {
  const { botId, id } = req.params as { botId: string; id: string }
  const skill = await SkillRepository.findById(id)
  if (!skill || skill.botId !== botId) { res.status(404).json({ error: 'Skill not found' }); return }
  res.json(await SkillAuditRepository.findBySkillId(id))
})
