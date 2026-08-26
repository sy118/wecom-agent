import { OnboardingDraftRepository } from '../db/onboarding-draft-repository.js'
import { TemplateRepository } from '../db/template-repository.js'
import { BotTriggerRepository } from '../db/bot-trigger-repository.js'
import type { AgentTemplateManifest, OnboardingDraft } from '@wecom-platform/types'

export interface WizardValidationError {
  field: string
  message: string
}

export interface WizardValidateInput {
  tenantId: string
  name?: string
  model?: { provider: string; model: string } | null
  skills?: string[]
  templateId?: string | null
  triggers: string[]
  tools?: Array<{ module: string; name: string }>
}

export interface WizardBuildInput extends WizardValidateInput {
  description?: string
}

export interface BuiltBotConfig {
  config: {
    name: string
    templateVersion: number
    model: { provider: string; model: string } | null
    skills: string[]
    triggers: string[]
  }
  manifest: AgentTemplateManifest
}

export interface WizardValidationResult {
  ok: boolean
  errors: WizardValidationError[]
}

/**
 * 分步向导服务：草稿保存/续写、提交前校验（名称/模型/技能依赖/触发词冲突）、
 * 由模板+用户选择生成标准 Bot 配置。测试消息不写生产会话。
 */
export class WizardService {
  async saveDraft(tenantId: string, data: { step: number; draft: Record<string, any>; id?: string | null }): Promise<OnboardingDraft> {
    return OnboardingDraftRepository.upsert({ id: data.id ?? null, tenantId, step: data.step, draft: data.draft })
  }

  async getDraft(tenantId: string): Promise<OnboardingDraft | null> {
    return OnboardingDraftRepository.findLatestByTenant(tenantId)
  }

  async validate(input: WizardValidateInput): Promise<WizardValidationResult> {
    const errors: WizardValidationError[] = []
    if (typeof input.name !== 'string' || !input.name.trim()) {
      errors.push({ field: 'name', message: 'Bot 名称必填且不超过 50 字' })
    } else if (input.name.trim().length > 50) {
      errors.push({ field: 'name', message: 'Bot 名称不能超过 50 字' })
    }
    if (!input.model || typeof input.model.provider !== 'string' || typeof input.model.model !== 'string' || !input.model.model.trim()) {
      errors.push({ field: 'model', message: '请选择可用的模型' })
    }
    const triggers = Array.isArray(input.triggers) ? input.triggers.map((t) => t.trim()).filter(Boolean) : []
    if (triggers.length === 0) {
      errors.push({ field: 'triggers', message: '至少需要一个触发词' })
    }
    if (input.templateId) {
      const template = await TemplateRepository.findById(input.templateId)
      if (!template || template.tenantId !== input.tenantId) {
        errors.push({ field: 'templateId', message: '所选模板不存在或不属于当前租户' })
      }
    }
    if (errors.length === 0 && triggers.length > 0) {
      const conflicts = await BotTriggerRepository.findConflicts(input.tenantId, triggers)
      if (conflicts.length > 0) {
        errors.push({ field: 'triggers', message: `触发词已被其他 Bot 占用：${conflicts.join('、')}，请修改后再保存` })
      }
    }
    return { ok: errors.length === 0, errors }
  }

  async buildBotConfig(input: WizardBuildInput): Promise<BuiltBotConfig> {
    const template = input.templateId ? await TemplateRepository.findById(input.templateId) : null
    const templateManifest = template ? await TemplateRepository.getRevision(template.id, template.currentVersion) : null
    const skills = Array.isArray(input.skills) ? input.skills : []
    const triggers = Array.isArray(input.triggers) ? input.triggers.map((t) => t.trim()).filter(Boolean) : []
    const tools = input.tools?.length
      ? input.tools
      : templateManifest?.manifest.tools ?? []
    const manifest: AgentTemplateManifest = {
      name: (input.name ?? '').trim(),
      description: input.description ?? templateManifest?.manifest.description ?? '',
      category: templateManifest?.manifest.category ?? '通用',
      skills,
      tools,
      model: input.model ?? templateManifest?.manifest.model ?? null,
      triggers,
      policy: templateManifest?.manifest.policy ?? {},
    }
    return {
      config: {
        name: manifest.name,
        templateVersion: template?.currentVersion ?? 1,
        model: manifest.model,
        skills: manifest.skills,
        triggers: manifest.triggers,
      },
      manifest,
    }
  }
}

/** 向导内测试：匹配触发词返回模拟回复与阶段心跳；不写入任何生产会话。 */
export function simulateTestRun(message: string, triggers: string[]): { reply: string; stages: string[] } {
  const matched = (triggers ?? []).some((trigger) => trigger && message.includes(trigger))
  return {
    reply: matched
      ? '✅ 测试通过：已匹配触发词，模型将按配置技能与模板执行。'
      : `未匹配任何触发词（${(triggers ?? []).join('、') || '无'}），请调整触发词后重试。`,
    stages: ['queued', 'thinking', 'model', 'done'],
  }
}