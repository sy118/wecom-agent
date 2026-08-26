import { TemplateRepository } from '../db/template-repository.js'
import { BotTriggerRepository } from '../db/bot-trigger-repository.js'
import { WecomMcpToolRepository } from '../db/wecom-mcp-tool-repository.js'
import type { AgentTemplate, AgentTemplateManifest, TemplateRevision } from '@wecom-platform/types'

export interface TemplateValidationResult {
  ok: boolean
  errors: string[]
}

/** 内置 6 个高频场景模板（查订单、会议纪要、日程提醒、邮件草稿、表格汇总、通讯录查询）。 */
export const BUILTIN_TEMPLATES: Array<Omit<AgentTemplateManifest, 'name' | 'description' | 'category'> & {
  name: string
  description: string
  category: string
}> = [
  {
    name: '查订单',
    description: '根据订单号/客户信息快速查询订单状态与物流',
    category: '业务查询',
    skills: [],
    tools: [{ module: '客户', name: 'crm.search' }, { module: '消息', name: 'msg.search' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['查订单', '订单查询'],
    policy: { mentionOnly: false, doNotDisturbWindows: [] },
  },
  {
    name: '会议纪要',
    description: '自动整理会议要点并生成纪要草稿',
    category: '办公效率',
    skills: [],
    tools: [{ module: '会议', name: 'meeting.list' }, { module: '文档', name: 'doc.create' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['会议纪要', '纪要'],
    policy: { mentionOnly: false, doNotDisturbWindows: [] },
  },
  {
    name: '日程提醒',
    description: '创建日程与提醒，避免错过重要事项',
    category: '办公效率',
    skills: [],
    tools: [{ module: '日程', name: 'calendar.list' }, { module: '日程', name: 'calendar.remind' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['提醒我', '日程'],
    policy: { mentionOnly: false, doNotDisturbWindows: [] },
  },
  {
    name: '邮件草稿',
    description: '根据要求生成邮件草稿，可人工确认后发送',
    category: '办公效率',
    skills: [],
    tools: [{ module: '邮件', name: 'mail.draft' }, { module: '邮件', name: 'mail.send' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['写邮件', '邮件草稿'],
    policy: { mentionOnly: false, doNotDisturbWindows: [] },
  },
  {
    name: '表格汇总',
    description: '汇总多行表格数据并生成统计结论',
    category: '数据分析',
    skills: [],
    tools: [{ module: '表格', name: 'sheet.list' }, { module: '表格', name: 'sheet.summary' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['汇总表格', '表格统计'],
    policy: { mentionOnly: false, doNotDisturbWindows: [] },
  },
  {
    name: '通讯录查询',
    description: '查找企业成员联系方式与组织信息',
    category: '业务查询',
    skills: [],
    tools: [{ module: '通讯录', name: 'contact.search' }, { module: '通讯录', name: 'contact.detail' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['找一下', '通讯录'],
    policy: { mentionOnly: true, doNotDisturbWindows: [] },
  },
]

const SUPPORTED_CATEGORIES = new Set(['业务查询', '办公效率', '数据分析', '通用', '其他'])
const TRIGGER_MAX_LENGTH = 50

export function validateTemplateManifest(value: unknown): TemplateValidationResult {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['模板声明必须是 JSON 对象'] }
  }
  const manifest = value as Record<string, unknown>
  if (typeof manifest.name !== 'string' || !manifest.name.trim()) errors.push('name 必填')
  if (typeof manifest.description !== 'string') errors.push('description 必填')
  if (typeof manifest.category !== 'string' || !SUPPORTED_CATEGORIES.has(manifest.category)) {
    errors.push(`category 必须是 ${[...SUPPORTED_CATEGORIES].join(' / ')} 之一`)
  }
  if (!Array.isArray(manifest.skills) || !manifest.skills.every((s) => typeof s === 'string')) {
    errors.push('skills 必须是字符串数组')
  }
  if (!Array.isArray(manifest.tools) || !manifest.tools.every((t) =>
    t && typeof t === 'object' && typeof (t as any).module === 'string' && typeof (t as any).name === 'string')) {
    errors.push('tools 必须是 {module, name} 对象数组')
  }
  if (!Array.isArray(manifest.triggers) || manifest.triggers.length === 0 || !manifest.triggers.every((t) => typeof t === 'string' && t.trim())) {
    errors.push('triggers 必须是至少一个非空字符串数组')
  }
  if (manifest.model !== null && (!manifest.model || typeof manifest.model !== 'object')) {
    errors.push('model 必须为 null 或 {provider, model} 对象')
  }
  return { ok: errors.length === 0, errors }
}

export async function seedBuiltinTemplates(tenantId: string): Promise<AgentTemplate[]> {
  const created: AgentTemplate[] = []
  for (const def of BUILTIN_TEMPLATES) {
    const existing = (await TemplateRepository.findByTenant(tenantId, { search: def.name }))
      .find((t) => t.name === def.name)
    if (existing) continue
    const manifest: AgentTemplateManifest = {
      name: def.name,
      description: def.description,
      category: def.category,
      skills: def.skills,
      tools: def.tools,
      model: def.model,
      triggers: def.triggers,
      policy: def.policy,
    }
    created.push(await TemplateRepository.create({ ...def, tenantId, manifest }))
  }
  return created
}

export function exportTemplateJson(template: AgentTemplate, revisions: TemplateRevision[]): Record<string, unknown> {
  const latest = revisions.find((r) => r.version === template.currentVersion)
  return {
    format: 'wecom-agent-template',
    schemaVersion: 1,
    template: {
      name: template.name,
      description: template.description,
      category: template.category,
      author: template.author,
      manifest: latest?.manifest ?? {},
    },
    revisions: revisions.map((r) => ({ version: r.version, manifest: r.manifest, createdAt: r.createdAt })),
  }
}

export async function importTemplateJson(json: unknown, tenantId: string, author?: string | null): Promise<AgentTemplate> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('导入内容必须是 JSON 对象')
  }
  const root = json as Record<string, unknown>
  const template = (root.template ?? root) as Record<string, unknown>
  const manifest = (template.manifest ?? template) as Record<string, unknown>
  const validation = validateTemplateManifest(manifest)
  if (!validation.ok) {
    throw new Error(`模板格式不合法：${validation.errors.join('；')}`)
  }
  const name = String(manifest.name)
  const existing = (await TemplateRepository.findByTenant(tenantId, { search: name })).find((t) => t.name === name)
  const fullManifest: AgentTemplateManifest = {
    name,
    description: String(manifest.description ?? ''),
    category: String(manifest.category ?? '通用'),
    skills: Array.isArray(manifest.skills) ? manifest.skills.map(String) : [],
    tools: Array.isArray(manifest.tools) ? (manifest.tools as Array<{ module: string; name: string }>) : [],
    model: manifest.model as AgentTemplateManifest['model'],
    triggers: Array.isArray(manifest.triggers) ? manifest.triggers.map(String) : [],
    policy: (manifest.policy as Record<string, any>) ?? {},
  }
  if (existing) {
    return TemplateRepository.publishNewVersion(existing.id, fullManifest)
  }
  return TemplateRepository.create({
    name,
    description: fullManifest.description,
    category: fullManifest.category,
    author: author ?? null,
    tenantId,
    manifest: fullManifest,
  })
}

export interface WizardSubmission {
  name: string
  description?: string
  model?: { provider: string; model: string } | null
  skills: string[]
  templateId?: string | null
  triggers: string[]
  mentionOnly?: boolean
  doNotDisturbWindows?: string[]
  wecomBotId?: string | null
  llmApiKey?: string
  llmBaseUrl?: string
}

export interface WizardValidationResult {
  ok: boolean
  errors: string[]
}

export async function validateWizardSubmission(
  input: WizardSubmission,
  tenantId: string,
  excludeBotId?: string | null
): Promise<WizardValidationResult> {
  const errors: string[] = []
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 50) {
    errors.push('Bot 名称必填且不超过 50 字')
  }
  if (input.model && (typeof input.model.provider !== 'string' || typeof input.model.model !== 'string' || !input.model.model.trim())) {
    errors.push('模型选择不完整（需要 provider 与 model）')
  }
  if (!Array.isArray(input.skills) || !input.skills.every((s) => typeof s === 'string')) {
    errors.push('技能选择格式错误')
  }
  const triggers = Array.isArray(input.triggers) ? input.triggers.map((t) => t.trim()).filter(Boolean) : []
  if (triggers.length === 0) errors.push('至少需要一个触发词')
  for (const trigger of triggers) {
    if (trigger.length > TRIGGER_MAX_LENGTH) errors.push(`触发词“${trigger}”超过 ${TRIGGER_MAX_LENGTH} 字`)
  }
  if (input.templateId) {
    const template = await TemplateRepository.findById(input.templateId)
    if (!template || template.tenantId !== tenantId) errors.push('所选模板不存在或不属于当前租户')
  }
  if (errors.length === 0 && triggers.length > 0) {
    const conflicts = await BotTriggerRepository.findConflicts(tenantId, triggers, excludeBotId)
    if (conflicts.length > 0) {
      errors.push(`触发词已被其他 Bot 占用：${conflicts.join('、')}，请修改后再保存`)
    }
  }
  if (input.wecomBotId && input.llmApiKey && input.llmBaseUrl && input.model) {
    const tools = await WecomMcpToolRepository.findByTenant(tenantId)
    const referenced = input.skills ?? []
    if (referenced.length > 0 && tools.length === 0) {
      errors.push('所选技能依赖企微 MCP 工具，但当前租户尚未授权任何 MCP 模块，请先在治理控制台授权')
    }
  }
  return { ok: errors.length === 0, errors }
}

export function __testSupportedCategories(): string[] {
  return [...SUPPORTED_CATEGORIES]
}
