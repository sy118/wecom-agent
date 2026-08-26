import { Router } from 'express'
import { randomUUID } from 'crypto'
import { BotRepository } from '../db/bot-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import { BotTriggerRepository } from '../db/bot-trigger-repository.js'
import { TemplateRepository } from '../db/template-repository.js'
import { OnboardingDraftRepository } from '../db/onboarding-draft-repository.js'
import { resolveTenantId } from '../db/tenant-repository.js'
import { WizardService, simulateTestRun } from '../services/wizard-service.js'
import type { AgentTemplateManifest } from '@wecom-platform/types'

export const onboardingRouter: Router = Router()

const wizardService = new WizardService()

function tenantOf(req: { headers: Record<string, any> }): string {
  return resolveTenantId(req.headers['x-tenant-id'])
}

function userIdOf(req: { headers: Record<string, any> }): string | null {
  const actor = req.headers['x-user-id']
  return typeof actor === 'string' && actor.trim() ? actor.trim() : null
}

onboardingRouter.get('/draft', async (req, res) => {
  const draft = await wizardService.getDraft(tenantOf(req))
  res.json(draft ?? { id: null, step: 1, data: {} })
})

onboardingRouter.put('/draft', async (req, res) => {
  const body = req.body ?? {}
  const step = typeof body.step === 'number' && body.step >= 1 && body.step <= 5 ? body.step : 1
  const draft = await wizardService.saveDraft(tenantOf(req), {
    id: typeof body.id === 'string' ? body.id : null,
    step,
    draft: body.data && typeof body.data === 'object' ? body.data : {},
  })
  res.json(draft)
})

onboardingRouter.post('/submit', async (req, res) => {
  const tenantId = tenantOf(req)
  const body = req.body ?? {}
  const input = {
    tenantId,
    name: typeof body.name === 'string' ? body.name : '',
    description: typeof body.description === 'string' ? body.description : '',
    model: body.model ?? null,
    skills: Array.isArray(body.skills) ? body.skills : [],
    templateId: typeof body.templateId === 'string' ? body.templateId : null,
    triggers: Array.isArray(body.triggers) ? body.triggers : [],
    tools: Array.isArray(body.tools) ? body.tools : [],
  }
  const validation = await wizardService.validate(input)
  if (!validation.ok) {
    res.status(400).json({ ok: false, errors: validation.errors.map((e) => e.message) })
    return
  }

  try {
    const built = await wizardService.buildBotConfig(input)
    const bot = await BotRepository.create({
      name: built.config.name,
      wecomBotId: typeof body.wecomBotId === 'string' && body.wecomBotId.trim()
        ? body.wecomBotId.trim()
        : `wizard-${randomUUID().slice(0, 8)}`,
      wecomBotSecret: 'wizard-secret',
      wecomWsUrl: process.env.WECOM_WS_URL ?? 'wss://ws.example.invalid/ws',
      llmApiKey: process.env.LLM_API_KEY ?? 'wizard-key',
      llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.example.invalid/v1',
      llmModel: built.manifest.model?.model ?? 'MiniMax-M2.5',
      provider: built.manifest.model?.provider === 'dify' ? 'dify' : 'openai-compatible',
      streamingMode: 'none',
      difyBaseUrl: null,
      difyApiKey: null,
      difyAppId: null,
      visionEnabled: false,
    })

    await ContextRepository.create({
      botId: bot.id,
      name: `${bot.name} 默认上下文`,
      systemPrompt: buildSystemPrompt(built.manifest),
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 30,
      isDefault: true,
    })

    await BotTriggerRepository.replaceForBot(bot.id, tenantId, built.manifest.triggers)

    if (body.templateId) {
      const template = await TemplateRepository.findById(body.templateId)
      if (template) await TemplateRepository.incrementUsage(template.id)
    }

    if (typeof body.draftId === 'string' && body.draftId) {
      const draft = await wizardService.getDraft(tenantId)
      if (draft && draft.id === body.draftId) await OnboardingDraftRepository.delete(draft.id)
    }
    res.status(201).json({ ok: true, bot, config: built.config })
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : '创建 Bot 失败' })
  }
})

onboardingRouter.post('/test', async (req, res) => {
  const tenantId = tenantOf(req)
  const body = req.body ?? {}
  const input = {
    tenantId,
    name: typeof body.name === 'string' ? body.name : '测试 Bot',
    model: body.model ?? null,
    skills: Array.isArray(body.skills) ? body.skills : [],
    templateId: typeof body.templateId === 'string' ? body.templateId : null,
    triggers: Array.isArray(body.triggers) ? body.triggers : [],
  }
  const validation = await wizardService.validate(input)
  if (!validation.ok) {
    res.status(400).json({ ok: false, errors: validation.errors.map((e) => e.message) })
    return
  }
  // 零代码测试：不写入生产会话，返回模拟回复与阶段心跳
  const simulated = simulateTestRun(String(body.message ?? ''), input.triggers)
  res.json({
    ok: true,
    test: true,
    stages: simulated.stages,
    reply: simulated.reply,
  })
})

function buildSystemPrompt(manifest: AgentTemplateManifest): string {
  const lines = [
    `你是企微助手「${manifest.name}」。`,
    '请用中文简洁回答，涉及数据操作时先说明将要执行的动作。',
  ]
  if (manifest.skills.length > 0) lines.push(`可用技能：${manifest.skills.join('、')}。`)
  const dnd = Array.isArray(manifest.policy?.doNotDisturbWindows) ? manifest.policy.doNotDisturbWindows.join('、') : ''
  if (dnd) lines.push(`免打扰时段：${dnd}。`)
  return lines.join('\n')
}
