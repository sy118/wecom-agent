import { Router } from 'express'
import { TemplateRepository } from '../db/template-repository.js'
import { resolveTenantId } from '../db/tenant-repository.js'
import { seedBuiltinTemplates, importTemplateJson, validateTemplateManifest, exportTemplateJson } from '../services/template-service.js'

export const agentTemplatesRouter: Router = Router()

function tenantOf(req: { headers: Record<string, any> }): string {
  return resolveTenantId(req.headers['x-tenant-id'])
}

function authorOf(req: { headers: Record<string, any>; body?: any }): string | null {
  const actor = req.headers['x-user-id'] ?? req.body?.author
  return typeof actor === 'string' && actor.trim() ? actor.trim() : null
}

agentTemplatesRouter.get('/', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined
  const search = typeof req.query.search === 'string' ? req.query.search : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
  res.json(await TemplateRepository.findByTenant(tenantOf(req), { category, search, status, limit }))
})

agentTemplatesRouter.post('/seed', async (_req, res) => {
  const created = await seedBuiltinTemplates(tenantOf(_req))
  res.json({ ok: true, created: created.length })
})

agentTemplatesRouter.get('/:id', async (req, res) => {
  const template = await TemplateRepository.findById(req.params.id)
  if (!template || template.tenantId !== tenantOf(req)) { res.status(404).json({ error: '模板不存在' }); return }
  const revisions = await TemplateRepository.listRevisions(template.id)
  res.json({ ...template, revisions })
})

agentTemplatesRouter.get('/:id/export', async (req, res) => {
  const template = await TemplateRepository.findById(req.params.id)
  if (!template || template.tenantId !== tenantOf(req)) { res.status(404).json({ error: '模板不存在' }); return }
  const revisions = await TemplateRepository.listRevisions(template.id)
  res.setHeader('Content-Disposition', `attachment; filename="template-${template.name}.json"`)
  res.json(exportTemplateJson(template, revisions))
})

agentTemplatesRouter.post('/import', async (req, res) => {
  try {
    const template = await importTemplateJson(req.body?.template ?? req.body, tenantOf(req), authorOf(req))
    res.status(201).json(template)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '模板导入失败' })
  }
})

agentTemplatesRouter.post('/', async (req, res) => {
  const body = req.body ?? {}
  const manifest = {
    name: body.name,
    description: body.description ?? '',
    category: body.category ?? '通用',
    skills: body.skills ?? [],
    tools: body.tools ?? [],
    model: body.model ?? null,
    triggers: body.triggers ?? [],
    policy: body.policy ?? {},
  }
  const validation = validateTemplateManifest(manifest)
  if (!validation.ok) { res.status(400).json({ error: validation.errors.join('；') }); return }
  try {
    const template = await importTemplateJson({ template: manifest }, tenantOf(req), authorOf(req))
    res.status(201).json(template)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '模板创建失败' })
  }
})

agentTemplatesRouter.post('/:id/versions', async (req, res) => {
  const template = await TemplateRepository.findById(req.params.id)
  if (!template || template.tenantId !== tenantOf(req)) { res.status(404).json({ error: '模板不存在' }); return }
  const validation = validateTemplateManifest(req.body?.manifest)
  if (!validation.ok) { res.status(400).json({ error: validation.errors.join('；') }); return }
  const updated = await TemplateRepository.publishNewVersion(template.id, req.body.manifest)
  res.status(201).json(updated)
})

agentTemplatesRouter.post('/:id/enable', async (req, res) => {
  const template = await TemplateRepository.findById(req.params.id)
  if (!template || template.tenantId !== tenantOf(req)) { res.status(404).json({ error: '模板不存在' }); return }
  await TemplateRepository.incrementUsage(template.id)
  res.json({ ok: true, usageCount: template.usageCount + 1 })
})

agentTemplatesRouter.patch('/:id', async (req, res) => {
  const template = await TemplateRepository.findById(req.params.id)
  if (!template || template.tenantId !== tenantOf(req)) { res.status(404).json({ error: '模板不存在' }); return }
  const status = req.body?.status
  if (status !== undefined && !['active', 'draft', 'archived'].includes(status)) {
    res.status(400).json({ error: 'status 必须是 active/draft/archived' }); return
  }
  if (status !== undefined) await TemplateRepository.updateStatus(template.id, status)
  const updated = await TemplateRepository.updateMeta(template.id, {
    name: req.body?.name,
    description: req.body?.description,
    category: req.body?.category,
  })
  res.json(updated)
})
