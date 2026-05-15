import { readFile } from 'fs/promises'
import { join } from 'path'
import { Router } from 'express'
import multer from 'multer'
import { SkillRepository } from '../db/skill-repository.js'
import { SkillAuditRepository } from '../db/skill-audit-repository.js'
import {
  defaultPermissionPolicy,
  installSkillBundle,
  removeSkillBundle,
  validateSkillBundle,
  type UploadedSkillFile,
} from '../skills/skill-bundle.js'

export const skillsRouter: Router = Router({ mergeParams: true })

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: {
    files: 200,
    fileSize: 2 * 1024 * 1024,
  },
})

skillsRouter.get('/', async (req, res) => {
  res.json(await SkillRepository.findAll())
})

skillsRouter.post('/upload', upload.array('files'), async (req, res) => {
  try {
    const files = (req.files ?? []) as Express.Multer.File[]
    const bundle = validateSkillBundle(files.map((file): UploadedSkillFile => ({
      originalname: file.originalname,
      buffer: file.buffer,
      size: file.size,
    })))
    const bundlePath = await installSkillBundle('global', bundle)
    const skill = await SkillRepository.create({
      id: bundle.id,
      botId: null,
      name: bundle.metadata.name,
      description: bundle.metadata.description,
      enabled: true,
      bundlePath,
      bundleHash: bundle.bundleHash,
      metadata: bundle.metadata,
      resourceIndex: bundle.resourceIndex,
      permissionPolicy: defaultPermissionPolicy(),
    })
    res.status(201).json(skill)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid Skill upload' })
  }
})

skillsRouter.get('/:id', async (req, res) => {
  const { id } = req.params as { id: string }
  const skill = await SkillRepository.findById(id)
  if (!skill) { res.status(404).json({ error: 'Skill not found' }); return }
  res.json(skill)
})

skillsRouter.get('/:id/skill-md', async (req, res) => {
  const { id } = req.params as { id: string }
  const skill = await SkillRepository.findById(id)
  if (!skill) { res.status(404).json({ error: 'Skill not found' }); return }
  try {
    const content = await readFile(join(skill.bundlePath, 'SKILL.md'), 'utf8')
    res.type('text/plain').send(content)
  } catch {
    res.status(404).json({ error: 'SKILL.md not found' })
  }
})

skillsRouter.put('/:id', async (req, res) => {
  const { id } = req.params as { id: string }
  const existing = await SkillRepository.findById(id)
  if (!existing) { res.status(404).json({ error: 'Skill not found' }); return }
  const skill = await SkillRepository.update(id, {
    enabled: req.body.enabled,
    permissionPolicy: req.body.permissionPolicy ? defaultPermissionPolicy(req.body.permissionPolicy) : undefined,
  })
  res.json(skill)
})

skillsRouter.delete('/:id', async (req, res) => {
  const { id } = req.params as { id: string }
  const existing = await SkillRepository.findById(id)
  if (!existing) { res.status(404).json({ error: 'Skill not found' }); return }
  await SkillRepository.delete(id)
  await removeSkillBundle(existing)
  res.status(204).send()
})

skillsRouter.get('/:id/audit', async (req, res) => {
  const { id } = req.params as { id: string }
  const skill = await SkillRepository.findById(id)
  if (!skill) { res.status(404).json({ error: 'Skill not found' }); return }
  res.json(await SkillAuditRepository.findBySkillId(id))
})
