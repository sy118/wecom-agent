import { randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import type { Client } from '@libsql/client'
import type { StructuredTool } from '@langchain/core/tools'
import { AgentEngine, DifyClient, MessageQueue, RecursionLimitError, WecomAdapter, appendSkillPrompts, buildSkillPromptAdditions, createMcpToolClient, createSkillTools } from '@wecom-platform/core'
import type { McpToolClient } from '@wecom-platform/core'
import { SessionStore } from '../session-store.js'
import { SkillAuditRepository } from '../db/skill-audit-repository.js'
import { WikiRetrievalLogRepository } from '../db/wiki-retrieval-log-repository.js'
import { BotResponseRunRepository } from '../db/bot-response-run-repository.js'
import { AnnotationAnswerRepository } from '../db/annotation-answer-repository.js'
import { ActiveContextRepository, CommandPermissionRepository, ContextAccessRepository, WecomUserRepository } from '../db/wecom-access-repository.js'
import { ModelConfigRepository } from '../db/generation-repository.js'
import { handleIncomingWecomEvent } from '../services/wecom-event-service.js'
import { createGenerationTask, formatGenerationTaskResult, formatGenerationTaskStatus, getGenerationTaskForUser, listGeneratedFilesForTask } from '../services/generation-task-service.js'
import { generatedFileName } from '../services/generated-file-service.js'
import { assertImageGenerationCapacity, ensureImageGenerationProcessorRegistered } from '../services/image-generation-service.js'
import { generationTaskRunner } from '../services/generation-task-runner.js'
import { parseWecomCommand } from '../commands/wecom-command-parser.js'
import { WecomCommandExecutor } from '../commands/wecom-command-executor.js'
import type { WecomCommandActor, WecomCommandHandlerResult, WecomCommandRuntime } from '../commands/wecom-command-executor.js'
import type { ParsedWecomCommand } from '../commands/wecom-command-parser.js'
import type { BotConfig, ContextConfig, Binding, McpServerConfig, McpConfig, SkillConfig, SkillDefinition, IncomingMessage, IncomingContent, IncomingEvent, Session, SessionMessage, BotResponseRun, GeneratedFile, WecomMediaType, WecomUserRole, WecomUserStatus } from '@wecom-platform/types'

const QUEUE_BACKPRESSURE_LIMIT = 10
const BUSY_MESSAGE = '当前处理队列繁忙，请稍后再试'
const RECONNECTING_MESSAGE = '机器人正在重连，请稍后再试'
const THINKING_MESSAGE = '🤔 正在分析，请稍候...'
const STREAM_TOOL_MSG = '🔍 正在检索相关信息...'
const TYPEWRITER_INTERVAL_MS = 800
const EMPTY_RESPONSE_FALLBACK = '抱歉，我暂时无法生成有效回复，请稍后重试。'
const PROGRESS_HEARTBEAT_INTERVAL_MS = 5_000
const MCP_SESSION_RETRY_FLAG = 'mcpSessionRetry'

type ProgressPhase = 'thinking' | 'tool' | 'organizing'

function configuredPositiveInt(envKey: string): number | undefined {
  const raw = process.env[envKey]
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function safeReply(text: string): string {
  return text.trim() || EMPTY_RESPONSE_FALLBACK
}

function collectErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error === null || error === undefined) return ''
  if (seen.has(error)) return ''
  if (typeof error !== 'object') return String(error)
  seen.add(error)

  const parts: string[] = []
  if (error instanceof Error) {
    parts.push(error.message)
    if (error.cause) parts.push(collectErrorText(error.cause, seen))
  }

  const record = error as Record<string, unknown>
  for (const key of ['message', 'body', 'response', 'cause']) {
    if (key in record) parts.push(collectErrorText(record[key], seen))
  }
  return parts.filter(Boolean).join('\n')
}

function isMcpSessionInvalidError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase()
  return text.includes('no valid session')
    || (text.includes('session not found') && (text.includes('re-initialize') || text.includes('reinitialize')))
}

function hasRetriedMcpSession(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false
  const metadata = (config as { metadata?: unknown }).metadata
  return !!metadata
    && typeof metadata === 'object'
    && (metadata as Record<string, unknown>)[MCP_SESSION_RETRY_FLAG] === true
}

function withMcpSessionRetryMetadata(config: unknown): Record<string, unknown> {
  const base = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : {}
  const metadata = base.metadata && typeof base.metadata === 'object' && !Array.isArray(base.metadata)
    ? { ...(base.metadata as Record<string, unknown>) }
    : {}
  return { ...base, metadata: { ...metadata, [MCP_SESSION_RETRY_FLAG]: true } }
}

function contentText(content: string | IncomingContent[]): string {
  if (typeof content === 'string') return content
  return content.map((item) => (item.type === 'text' ? item.text : `[图片: ${item.url}]`)).join('\n')
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes} 分 ${rest.toString().padStart(2, '0')} 秒`
}

function progressBar(tick: number): string {
  const width = 6
  const active = tick % width
  return `[${Array.from({ length: width }, (_, index) => (index === active ? '●' : '○')).join('')}]`
}

function progressMessage(phase: ProgressPhase, startedAt: number, tick: number): string {
  const title = phase === 'tool'
    ? STREAM_TOOL_MSG
    : phase === 'organizing'
      ? '🧩 正在整理线索...'
      : '⏳ 正在思考中...'
  return `${title}\n${progressBar(tick)}，已用时间：${formatElapsed(startedAt)}`
}

export function isVisionFallbackError(err: unknown): boolean {
  const status = (err as any)?.response?.status ?? (err as any)?.status
  return status === 400 || status === 422
}

export function getVisionFallbackSessionMessages(_sessionMessages: SessionMessage[]): SessionMessage[] {
  return []
}

export function degradeVisionContent(content: IncomingContent[]): string {
  return content.map((c) => (c.type === 'text' ? c.text : `[图片: ${c.url}]`)).join('\n')
}

export function shouldSkipRuntimeToolsForDify(
  provider: BotConfig['provider'],
  mcpConfigs: McpConfig[] = [],
  skillConfigs: SkillConfig[] = []
): boolean {
  return provider === 'dify' && (mcpConfigs.length > 0 || skillConfigs.length > 0)
}

async function invokeVisionFallback(
  engine: AgentEngine,
  sessionMessages: SessionMessage[],
  content: IncomingContent[],
  systemPrompt: string,
  tools: StructuredTool[]
): Promise<string> {
  return safeReply(await engine.invokeWithTools(
    getVisionFallbackSessionMessages(sessionMessages),
    degradeVisionContent(content),
    systemPrompt,
    tools
  ))
}

export interface BotInstanceDeps {
  bot: BotConfig
  contexts: ContextConfig[]
  bindings: Binding[]
  mcpServers: McpServerConfig[]
  skills: SkillDefinition[]
  db: Client
}

const UNBOUND_REPLY = '该会话暂未配置，请联系管理员在管理台绑定上下文后再使用。'

export interface DiscoveredChat {
  chatKey: string
  chatType: 'group' | 'user'
  firstSeenAt: number
}

type EffectiveContextSource = 'runtime' | 'binding' | 'default'

interface EffectiveContext {
  context: ContextConfig
  source: EffectiveContextSource
}

const CONTEXT_CARD_EVENT_KEY = 'ctx_use_submit'
const CONTEXT_CARD_QUESTION_KEY = 'ctx_id'
const CONTEXT_CARD_TASK_PREFIX = 'ctx_use_'
const MENU_CARD_TASK_PREFIX = 'menu_'
const MENU_EVENT_CURRENT = 'menu_ctx_current'
const MENU_EVENT_LIST = 'menu_ctx_list'
const MENU_EVENT_RESET = 'menu_ctx_reset'
const MENU_EVENT_HELP = 'menu_help'
const TASK_CARD_TASK_PREFIX = 'gen_task_'
const TASK_EVENT_STATUS = 'task_status'
const TASK_EVENT_RESULT = 'task_result'
const WECOM_SELECT_OPTION_LIMIT = 10

export class BotInstance {
  private adapter: WecomAdapter
  private engine: AgentEngine | null = null
  private difyClient: DifyClient | null = null
  private toolPool = new Map<string, StructuredTool[]>() // mcpServerId → tools
  private toolClients = new Map<string, McpToolClient>()
  private mcpReloadInFlight = new Map<string, Promise<StructuredTool[]>>()
  private skillToolPool = new Map<string, SkillDefinition>()
  private queues = new Map<string, MessageQueue>()
  private sessions: SessionStore
  private processedMsgs = new Set<string>()
  private contextMap: Map<string, ContextConfig>
  private bindingMap: Map<string, string>
  private defaultContext: ContextConfig | null
  private discoveredChats = new Map<string, DiscoveredChat>()
  private commandExecutor: WecomCommandExecutor
  private completedTemplateCardTasks = new Set<string>()

  constructor(private deps: BotInstanceDeps) {
    this.adapter = new WecomAdapter({
      botId: deps.bot.wecomBotId,
      secret: deps.bot.wecomBotSecret,
      wsUrl: deps.bot.wecomWsUrl,
      visionEnabled: deps.bot.visionEnabled,
    })
    this.sessions = new SessionStore(deps.db, deps.bot.id)
    this.contextMap = new Map(deps.contexts.map((c) => [c.id, c]))
    this.bindingMap = new Map(deps.bindings.map((b) => [b.chatKey, b.contextId]))
    this.defaultContext = deps.contexts.find((c) => c.isDefault) ?? null
    this.skillToolPool = new Map(deps.skills.filter((skill) => skill.enabled).map((skill) => [skill.id, skill]))
    this.commandExecutor = new WecomCommandExecutor({
      handle: (command, runtime, actor) => this.handleRuntimeCommand(command, runtime, actor),
    })
  }

  private async handleRuntimeCommand(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    actor: WecomCommandActor
  ): Promise<WecomCommandHandlerResult | null> {
    return (await this.handleContextCommand(command, runtime, actor))
      ?? (await this.handleTaskCommand(command, runtime, actor))
      ?? (await this.handleImageCommand(command, runtime, actor))
      ?? this.handleAdminCommand(command, runtime, actor)
  }

  private runtimeFromMessage(msg: IncomingMessage): WecomCommandRuntime {
    return {
      botId: this.deps.bot.id,
      chatKey: msg.chatKey,
      chatId: msg.chatId,
      userId: msg.userId,
    }
  }

  private runtimeFromEvent(event: IncomingEvent): WecomCommandRuntime {
    return {
      botId: this.deps.bot.id,
      chatKey: event.chatKey,
      chatId: event.chatId ?? event.userId,
      userId: event.userId,
    }
  }

  private isGroupChat(chatKey: string): boolean {
    return chatKey.startsWith('wecom:group:')
  }

  private async resolveEffectiveContext(chatKey: string, userId: string): Promise<EffectiveContext | null> {
    const groupChat = this.isGroupChat(chatKey)
    const active = groupChat
      ? await ActiveContextRepository.findForChat(this.deps.bot.id, chatKey)
      : await ActiveContextRepository.findForUser(this.deps.bot.id, chatKey, userId)
    if (active) {
      const activeContext = this.contextMap.get(active.contextId)
      if (activeContext && groupChat && active.scope === 'chat') {
        return { context: activeContext, source: 'runtime' }
      }
      if (activeContext && await ContextAccessRepository.hasAccess(this.deps.bot.id, userId, active.contextId)) {
        return { context: activeContext, source: 'runtime' }
      }
      if (active.scope === 'user_in_chat' && active.wecomUserId === userId) {
        await ActiveContextRepository.clear(this.deps.bot.id, chatKey, userId)
      } else if (active.scope === 'chat') {
        await ActiveContextRepository.clearChat(this.deps.bot.id, chatKey)
      }
    }

    const boundContextId = this.bindingMap.get(chatKey)
    const boundContext = boundContextId ? this.contextMap.get(boundContextId) : null
    if (boundContext) return { context: boundContext, source: 'binding' }
    if (this.defaultContext) return { context: this.defaultContext, source: 'default' }
    return null
  }

  private async handleContextCommand(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    actor: WecomCommandActor
  ): Promise<WecomCommandHandlerResult | null> {
    if (!command.commandKey.startsWith('ctx.')) return null

    if (command.commandKey === 'ctx.current') {
      const resolved = await this.resolveEffectiveContext(runtime.chatKey, runtime.userId)
      if (!resolved) {
        return {
          commandKey: command.commandKey,
          ok: false,
          status: 'not_found',
          message: '当前会话暂未配置可用上下文。',
          auditReason: 'context_not_found',
        }
      }
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: `当前上下文：${resolved.context.name} (${resolved.context.id})\n来源：${this.formatContextSource(resolved.source)}`,
        auditPayload: { contextId: resolved.context.id, source: resolved.source },
      }
    }

    if (!actor.mapped) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: '你的企微用户尚未登记，无法执行该上下文命令。',
        auditReason: 'wecom_user_unmapped',
      }
    }

    if (command.commandKey === 'ctx.list') {
      const contexts = await this.getSwitchableContexts(runtime.userId, actor.role)

      if (contexts.length === 0) {
        return {
          commandKey: command.commandKey,
          ok: true,
          status: 'success',
          message: '当前没有可切换的上下文。',
          auditPayload: { count: 0 },
        }
      }

      if (await this.sendContextSelectionCard(runtime, contexts)) {
        return {
          commandKey: command.commandKey,
          ok: true,
          status: 'success',
          message: contexts.length > WECOM_SELECT_OPTION_LIMIT
            ? '已发送上下文选择卡片。受企业微信选择器限制，本次只展示前 10 个上下文；未展示的上下文仍可用 /ctx use <上下文名称> 切换。'
            : '已发送上下文选择卡片，请在卡片中选择后提交。',
          auditPayload: { count: contexts.length, interaction: 'template_card' },
        }
      }

      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: ['可切换上下文：', ...contexts.map((context) => `- ${context.name} (${context.id})`)].join('\n'),
        auditPayload: { count: contexts.length },
      }
    }

    if (command.commandKey === 'ctx.use') {
      const requested = command.args[0]
      const target = this.findContextByIdOrName(requested)
      if (!target || !await ContextAccessRepository.hasAccess(this.deps.bot.id, runtime.userId, target.id)) {
        return {
          commandKey: command.commandKey,
          ok: false,
          status: 'permission_denied',
          message: '未找到可访问的目标上下文，或你没有切换权限。',
          auditReason: 'context_access_denied',
          auditPayload: { requested },
        }
      }

      const scope = this.isGroupChat(runtime.chatKey) ? 'chat' : 'user_in_chat'
      await ActiveContextRepository.set({
        botId: this.deps.bot.id,
        chatKey: runtime.chatKey,
        wecomUserId: scope === 'chat' ? null : runtime.userId,
        scope,
        contextId: target.id,
        activatedBy: runtime.userId,
      })
      await this.sessions.delete(runtime.chatKey)
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: `${scope === 'chat' ? '已切换本群上下文' : '已切换到上下文'}：${target.name} (${target.id})\n下一条消息将立即使用该上下文。`,
        auditPayload: { contextId: target.id, scope },
      }
    }

    if (command.commandKey === 'ctx.reset') {
      const groupChat = this.isGroupChat(runtime.chatKey)
      const active = groupChat
        ? await ActiveContextRepository.findForChat(this.deps.bot.id, runtime.chatKey)
        : await ActiveContextRepository.findForUser(this.deps.bot.id, runtime.chatKey, runtime.userId)
      if (!active) {
        return {
          commandKey: command.commandKey,
          ok: true,
          status: 'success',
          message: '当前没有运行时切换的上下文，无需重置。',
        }
      }

      if (groupChat) {
        await ActiveContextRepository.clearChat(this.deps.bot.id, runtime.chatKey)
      } else {
        await ActiveContextRepository.clear(this.deps.bot.id, runtime.chatKey, runtime.userId)
      }
      await this.sessions.delete(runtime.chatKey)
      const fallback = await this.resolveEffectiveContext(runtime.chatKey, runtime.userId)
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: fallback
          ? `已重置${groupChat ? '本群' : '运行时'}上下文。\n当前上下文：${fallback.context.name} (${fallback.context.id})\n来源：${this.formatContextSource(fallback.source)}`
          : `已重置${groupChat ? '本群' : '运行时'}上下文。当前会话暂无可用上下文。`,
        auditPayload: { previousContextId: active.contextId, fallbackContextId: fallback?.context.id ?? null },
      }
    }

    return null
  }

  private async getSwitchableContexts(userId: string, role: WecomCommandActor['role']): Promise<ContextConfig[]> {
    if (role === 'admin') {
      return [...this.contextMap.values()].filter((context) => context.botId === this.deps.bot.id)
    }
    return (await ContextAccessRepository.listByUser(this.deps.bot.id, userId))
      .map((grant) => this.contextMap.get(grant.contextId))
      .filter((context): context is ContextConfig => Boolean(context))
  }

  private async sendContextSelectionCard(runtime: WecomCommandRuntime, contexts: ContextConfig[]): Promise<boolean> {
    if (!this.adapter.sendTemplateCard) return false
    const options = contexts.slice(0, WECOM_SELECT_OPTION_LIMIT).map((context) => ({
      id: context.id,
      text: this.templateOptionText(context.name || context.id),
    }))
    if (options.length === 0) return false
    const current = await this.resolveEffectiveContext(runtime.chatKey, runtime.userId)
    const selectedId = options.some((option) => option.id === current?.context.id)
      ? current!.context.id
      : options[0].id
    try {
      await this.adapter.sendTemplateCard(runtime.chatId, {
        card_type: 'multiple_interaction',
        source: { desc: '上下文' },
        main_title: {
          title: '切换上下文',
          desc: this.isGroupChat(runtime.chatKey) ? '提交后对本群立即生效' : '提交后对当前会话立即生效',
        },
        select_list: [
          {
            question_key: CONTEXT_CARD_QUESTION_KEY,
            title: '上下文',
            selected_id: selectedId,
            option_list: options,
          },
        ],
        submit_button: {
          text: '切换',
          key: CONTEXT_CARD_EVENT_KEY,
        },
        task_id: `${CONTEXT_CARD_TASK_PREFIX}${randomUUID()}`,
      })
      return true
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to send context selection card:`, err)
      return false
    }
  }

  private async sendCommandMenuCard(runtime: WecomCommandRuntime): Promise<boolean> {
    if (!this.adapter.sendTemplateCard) return false
    try {
      await this.adapter.sendTemplateCard(runtime.chatId, {
        card_type: 'button_interaction',
        source: { desc: '企微助手' },
        main_title: {
          title: '操作菜单',
          desc: this.isGroupChat(runtime.chatKey) ? '群聊上下文切换会对本群生效' : '选择一个可直接执行的操作',
        },
        sub_title_text: '需要补充内容的功能请直接发送文字命令。',
        horizontal_content_list: [
          { keyname: '图片', value: '/image 描述' },
          { keyname: '任务', value: '/task result ID' },
          { keyname: '用户', value: '/admin user upsert ID' },
          { keyname: '授权', value: '/admin ctx grant 用户 上下文' },
          { keyname: '权限', value: '/admin command set 命令 角色 on' },
          { keyname: '更多', value: '/help 查看完整命令' },
        ],
        button_list: [
          { text: '当前上下文', style: 1, key: MENU_EVENT_CURRENT },
          { text: '切换上下文', style: 1, key: MENU_EVENT_LIST },
          { text: '使用说明', style: 1, key: MENU_EVENT_HELP },
          { text: '重置上下文', style: 2, key: MENU_EVENT_RESET },
        ],
        task_id: `${MENU_CARD_TASK_PREFIX}${randomUUID()}`,
      })
      return true
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to send command menu card:`, err)
      return false
    }
  }

  private async sendTaskActionCard(runtime: WecomCommandRuntime, taskId: string): Promise<boolean> {
    if (!this.adapter.sendTemplateCard) return false
    try {
      await this.adapter.sendTemplateCard(runtime.chatId, {
        card_type: 'button_interaction',
        source: { desc: '生成任务' },
        main_title: {
          title: '图片生成任务已创建',
          desc: '完成后会自动推送结果，也可以点按钮查询',
        },
        horizontal_content_list: [
          { keyname: '任务ID', value: taskId },
        ],
        button_list: [
          { text: '查状态', style: 1, key: TASK_EVENT_STATUS },
          { text: '取结果', style: 1, key: TASK_EVENT_RESULT },
        ],
        task_id: `${TASK_CARD_TASK_PREFIX}${taskId}`,
      })
      return true
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to send task action card:`, err)
      return false
    }
  }

  private templateOptionText(value: string): string {
    const text = value.trim() || '未命名'
    return text.length > 10 ? text.slice(0, 9) + '…' : text
  }

  private findContextByIdOrName(value: string): ContextConfig | null {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return null
    return [...this.contextMap.values()].find((context) =>
      context.botId === this.deps.bot.id &&
      (context.id.toLowerCase() === normalized || context.name.toLowerCase() === normalized)
    ) ?? null
  }

  private formatContextSource(source: EffectiveContextSource): string {
    if (source === 'runtime') return '运行时切换'
    if (source === 'binding') return '后台绑定'
    return '默认上下文'
  }

  private async handleTaskCommand(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    actor: WecomCommandActor
  ): Promise<WecomCommandHandlerResult | null> {
    if (command.commandKey !== 'task.status' && command.commandKey !== 'task.result') return null
    if (!actor.mapped) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: '你的企微用户尚未登记，无法查询生成任务。',
        auditReason: 'wecom_user_unmapped',
      }
    }

    const taskId = command.args[0]
    const access = await getGenerationTaskForUser(this.deps.bot.id, taskId, runtime.userId, actor.role)
    if (access.error === 'not_found') {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'not_found',
        message: '未找到该任务，或任务不属于当前机器人。',
        auditReason: 'task_not_found',
        auditPayload: { taskId },
      }
    }
    if (access.error === 'denied' || !access.task) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: '你没有查看该任务的权限。',
        auditReason: 'task_access_denied',
        auditPayload: { taskId },
      }
    }

    if (command.commandKey === 'task.status') {
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: formatGenerationTaskStatus(access.task),
        auditPayload: { taskId },
      }
    }

    const files = await listGeneratedFilesForTask(access.task)
    if (access.task.status === 'succeeded' && files.length > 0) {
      const sentCount = await this.sendGeneratedFilesToChat(runtime.chatId, files)
      if (sentCount > 0) {
        return {
          commandKey: command.commandKey,
          ok: true,
          status: 'success',
          message: sentCount === files.length
            ? `已发送 ${sentCount} 个结果文件到当前会话。`
            : `已发送 ${sentCount}/${files.length} 个结果文件到当前会话，其余文件发送失败，请稍后重试。`,
          auditPayload: { taskId, fileCount: files.length, sentCount },
        }
      }
    }
    return {
      commandKey: command.commandKey,
      ok: true,
      status: 'success',
      message: formatGenerationTaskResult(access.task, files, process.env.PUBLIC_BASE_URL),
      auditPayload: { taskId, fileCount: files.length },
    }
  }

  private async handleImageCommand(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    actor: WecomCommandActor
  ): Promise<WecomCommandHandlerResult | null> {
    if (command.commandKey !== 'image.generate') return null
    if (!actor.mapped) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: '你的企微用户尚未登记，无法创建图片生成任务。',
        auditReason: 'wecom_user_unmapped',
      }
    }

    const model = await ModelConfigRepository.findEnabledByCapability(this.deps.bot.id, 'image_generation')
    if (!model) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'not_found',
        message: '当前机器人未配置可用的图片生成模型。',
        auditReason: 'image_model_not_configured',
      }
    }
    const prompt = command.args.join(' ').trim()
    const capacityError = await assertImageGenerationCapacity(
      this.deps.bot.id,
      runtime.userId,
      model.id,
      model.quotaPerUserDaily,
      model.maxConcurrent
    )
    if (capacityError) {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: capacityError,
        auditReason: 'image_capacity_limited',
        auditPayload: { modelId: model.id },
      }
    }

    const resolved = await this.resolveEffectiveContext(runtime.chatKey, runtime.userId)
    const task = await createGenerationTask({
      botId: this.deps.bot.id,
      taskType: 'image',
      ownerUserId: runtime.userId,
      chatKey: runtime.chatKey,
      chatId: runtime.chatId,
      contextId: resolved?.context.id ?? null,
      modelId: model.id,
      inputPayload: { prompt, params: model.defaultParams },
      previewSummary: prompt.slice(0, 120),
    })
    ensureImageGenerationProcessorRegistered()
    generationTaskRunner.enqueue(task.id)
    const cardSent = await this.sendTaskActionCard(runtime, task.id)
    return {
      commandKey: command.commandKey,
      ok: true,
      status: 'success',
      message: cardSent
        ? ''
        : [
            '已创建图片生成任务。',
            `任务 ID：${task.id}`,
            '任务完成后会自动推送结果到当前企微会话。',
            `查询状态：/task status ${task.id}`,
            `获取结果：/task result ${task.id}`,
          ].join('\n'),
      auditPayload: { taskId: task.id, modelId: model.id },
    }
  }

  private async handleAdminCommand(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    actor: WecomCommandActor
  ): Promise<WecomCommandHandlerResult | null> {
    if (!command.commandKey.startsWith('admin.')) return null
    if (actor.role !== 'admin') {
      return {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied',
        message: '只有超级管理员可以执行该管理命令。',
        auditReason: 'admin_role_required',
      }
    }

    if (command.commandKey === 'admin.user.upsert') {
      const wecomUserId = command.args[0]
      const parsed = parseUserUpsertArgs(command.args.slice(1))
      const user = await WecomUserRepository.upsert({
        botId: this.deps.bot.id,
        wecomUserId,
        role: parsed.role,
        status: parsed.status,
        displayName: parsed.displayName,
      })
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: [
          '已维护企微用户。',
          `用户ID：${user.wecomUserId}`,
          `角色：${formatWecomRole(user.role)}`,
          `状态：${user.status === 'active' ? '启用' : '禁用'}`,
        ].join('\n'),
        auditPayload: { wecomUserId, role: parsed.role, status: parsed.status, displayName: parsed.displayName },
      }
    }

    if (command.commandKey === 'admin.ctx.grant') {
      const wecomUserId = command.args[0]
      const contextId = command.args[1]
      const context = this.contextMap.get(contextId)
      if (!context || context.botId !== this.deps.bot.id) {
        return {
          commandKey: command.commandKey,
          ok: false,
          status: 'not_found',
          message: '未找到该上下文，无法授权。',
          auditReason: 'context_not_found',
          auditPayload: { contextId, wecomUserId },
        }
      }
      await ContextAccessRepository.grant({
        botId: this.deps.bot.id,
        contextId,
        wecomUserId,
        accessLevel: 'use',
        grantedBy: runtime.userId,
      })
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: `已授权 ${wecomUserId} 切换上下文：${context.name} (${context.id})`,
        auditPayload: { contextId, wecomUserId, accessLevel: 'use' },
      }
    }

    if (command.commandKey === 'admin.ctx.revoke') {
      const wecomUserId = command.args[0]
      const contextId = command.args[1]
      await ContextAccessRepository.deleteGrant(this.deps.bot.id, contextId, wecomUserId)
      await ActiveContextRepository.clearForUser(this.deps.bot.id, wecomUserId)
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: `已删除 ${wecomUserId} 的可切换上下文授权：${contextId}`,
        auditPayload: { contextId, wecomUserId },
      }
    }

    if (command.commandKey === 'admin.command.set') {
      const commandKey = command.args[0]
      const role = parseWecomRole(command.args[1])
      const enabled = parseOnOff(command.args[2])
      const requireConfirm = parseConfirmMode(command.args[3])
      if (!role || enabled === null) {
        return {
          commandKey: command.commandKey,
          ok: false,
          status: 'argument_error',
          message: '参数不正确。格式：/admin command set <commandKey> <user|manager|admin> <on|off> [confirm|direct]',
          auditReason: 'invalid_admin_command_set_args',
          auditPayload: { args: command.args },
        }
      }
      const permission = await CommandPermissionRepository.set({
        botId: this.deps.bot.id,
        commandKey,
        role,
        enabled,
        requireConfirm,
      })
      return {
        commandKey: command.commandKey,
        ok: true,
        status: 'success',
        message: [
          '已更新命令权限。',
          `命令：${permission.commandKey}`,
          `角色：${formatWecomRole(permission.role)}`,
          `状态：${permission.enabled ? '启用' : '禁用'}`,
          `执行方式：${permission.requireConfirm ? '二次确认' : '直接执行'}`,
        ].join('\n'),
        auditPayload: { commandKey, role, enabled, requireConfirm },
      }
    }

    return null
  }

  async start(): Promise<void> {
    const { bot, mcpServers } = this.deps

    if (bot.provider === 'dify') {
      if (!bot.difyBaseUrl || !bot.difyApiKey) {
        throw new Error('Dify provider requires difyBaseUrl and difyApiKey')
      }
      this.difyClient = new DifyClient({
        baseUrl: bot.difyBaseUrl,
        apiKey: bot.difyApiKey,
        appId: bot.difyAppId,
      })
    } else {
      this.engine = new AgentEngine({
        llm: {
          apiKey: bot.llmApiKey,
          baseUrl: bot.llmBaseUrl,
          model: bot.llmModel,
          provider: bot.provider,
        },
        systemPrompt: '',
        timeoutMs: configuredPositiveInt('AGENT_TIMEOUT_MS'),
        recursionLimit: configuredPositiveInt('AGENT_RECURSION_LIMIT'),
      })
      await this.engine.initialize()

      // Build tool pool: load tools per MCP server
      for (const server of mcpServers) {
        if (!server.enabled) continue
        try {
          const toolClient = await this.createTrackedMcpToolClient(server)
          this.toolPool.set(server.id, toolClient.tools)
          this.toolClients.set(server.id, toolClient)
        } catch (err) {
          console.error(`[BotInstance:${bot.id}] Failed to load tools from ${server.name}:`, err)
        }
      }
      console.log(`[BotInstance:${bot.id}] Loaded ${this.skillToolPool.size} enabled skill(s)`)
    }

    this.adapter.onMessage((msg) => this.handleMessage(msg))
    this.adapter.onEvent((event) => this.handleEvent(event))
    await this.adapter.start()
  }

  async stop(): Promise<void> {
    await this.adapter.stop()
    this.sessions.destroy()
    this.queues.clear()
    this.processedMsgs.clear()
    this.discoveredChats.clear()
    await this.closeMcpToolClients()
    this.toolPool.clear()
    this.skillToolPool.clear()
  }

  async getActiveSessions() {
    const sessions = await this.sessions.getAll()
    return sessions.map((session) => ({
      ...session,
      contextName: this.contextMap.get(session.contextId)?.name ?? session.contextId,
    }))
  }

  deleteSession(chatKey: string): void {
    this.sessions.delete(chatKey)
  }

  getDiscoveredChats(): DiscoveredChat[] {
    return [...this.discoveredChats.values()].sort((a, b) => b.firstSeenAt - a.firstSeenAt)
  }

  acknowledgeBinding(chatKey: string): void {
    this.discoveredChats.delete(chatKey)
  }

  addBinding(chatKey: string, contextId: string): void {
    this.bindingMap.set(chatKey, contextId)
    this.discoveredChats.delete(chatKey)
  }

  removeBinding(chatKey: string): void {
    this.bindingMap.delete(chatKey)
  }

  updateBinding(chatKey: string, contextId: string): void {
    this.bindingMap.set(chatKey, contextId)
    this.discoveredChats.delete(chatKey)
  }

  upsertContext(context: ContextConfig): void {
    this.contextMap.set(context.id, context)
    if (context.isDefault) {
      this.defaultContext = context
    }
  }

  reloadContexts(contexts: ContextConfig[]): void {
    this.deps.contexts = contexts
    this.contextMap = new Map(contexts.map((context) => [context.id, context]))
    this.defaultContext = contexts.find((context) => context.isDefault) ?? null
    console.log(`[BotInstance:${this.deps.bot.id}] Reloaded ${contexts.length} context(s)`)
  }

  reloadBindings(bindings: Binding[]): void {
    this.deps.bindings = bindings
    this.bindingMap = new Map(bindings.map((binding) => [binding.chatKey, binding.contextId]))
    for (const binding of bindings) {
      this.discoveredChats.delete(binding.chatKey)
    }
    console.log(`[BotInstance:${this.deps.bot.id}] Reloaded ${bindings.length} binding(s)`)
  }

  async reloadMcpServers(mcpServers: McpServerConfig[]): Promise<void> {
    this.deps.mcpServers = mcpServers
    if (this.deps.bot.provider === 'dify') {
      await this.closeMcpToolClients()
      this.toolPool.clear()
      return
    }

    const nextToolPool = new Map<string, StructuredTool[]>()
    const nextToolClients = new Map<string, McpToolClient>()
    for (const server of mcpServers) {
      if (!server.enabled) continue
      try {
        const toolClient = await this.createTrackedMcpToolClient(server)
        nextToolPool.set(server.id, toolClient.tools)
        nextToolClients.set(server.id, toolClient)
      } catch (err) {
        console.error(`[BotInstance:${this.deps.bot.id}] Failed to reload tools from ${server.name}:`, err)
        const previousTools = this.toolPool.get(server.id)
        const previousClient = this.toolClients.get(server.id)
        if (previousTools?.length && previousClient) {
          nextToolPool.set(server.id, previousTools)
          nextToolClients.set(server.id, previousClient)
          console.warn(`[BotInstance:${this.deps.bot.id}] Keeping last known MCP tools for ${server.name}`)
        }
      }
    }

    const oldClients = [...this.toolClients].filter(([serverId, client]) => nextToolClients.get(serverId) !== client).map(([, client]) => client)
    this.toolPool = nextToolPool
    this.toolClients = nextToolClients
    await this.closeMcpToolClients(oldClients)
    console.log(`[BotInstance:${this.deps.bot.id}] Reloaded ${this.toolPool.size} MCP server tool pool(s)`)
  }

  reloadSkills(skills: SkillDefinition[]): void {
    this.deps.skills = skills
    this.skillToolPool = new Map(skills.filter((skill) => skill.enabled).map((skill) => [skill.id, skill]))
    console.log(`[BotInstance:${this.deps.bot.id}] Reloaded ${this.skillToolPool.size} enabled skill(s)`)
  }

  async invokeForScheduledTask(prompt: string, systemPrompt: string, targetChatId: string): Promise<string> {
    if (this.deps.bot.provider === 'dify') {
      const scheduledUser = `wecom:scheduled:${targetChatId}`
      const result = await this.difyClient!.chat(prompt, null, scheduledUser)
      return result.answer
    }
    if (!this.engine) throw new Error('AgentEngine not initialized')
    return this.engine.invokeWithPrompt([], prompt, systemPrompt)
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.adapter.sendMessage(chatId, text)
  }

  async sendGeneratedFiles(chatId: string, files: GeneratedFile[]): Promise<number> {
    return this.sendGeneratedFilesToChat(chatId, files)
  }

  private async sendGeneratedFilesToChat(chatId: string, files: GeneratedFile[]): Promise<number> {
    if (!this.adapter.sendMediaMessage) return 0
    let sent = 0
    for (const file of files) {
      try {
        const bytes = await readFile(file.storagePath)
        await this.adapter.sendMediaMessage(chatId, wecomMediaTypeForGeneratedFile(file), {
          bytes,
          filename: generatedFileName(file),
        })
        sent++
      } catch (err) {
        console.error(`[BotInstance:${this.deps.bot.id}] Failed to send generated file ${file.id}:`, err)
      }
    }
    return sent
  }

  private resolveContent(msg: IncomingMessage): string | IncomingContent[] {
    if (!Array.isArray(msg.content)) return msg.content
    if (this.deps.bot.visionEnabled) return msg.content
    // visionEnabled=false: keep only text parts, replace image items with [图片] label (no URL)
    return msg.content.map((c) => (c.type === 'text' ? c.text : '[图片]')).join('\n')
  }

  async handleEvent(event: IncomingEvent): Promise<void> {
    try {
      await handleIncomingWecomEvent(event, { botId: this.deps.bot.id, contexts: this.deps.contexts })
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to handle WeCom event ${event.eventType}:`, err)
    }

    try {
      if (event.eventType === 'enter_chat') {
        await this.sendCommandMenuCard(this.runtimeFromEvent(event))
        return
      }
      const handled = await this.handleTemplateCardEvent(event)
      if (handled?.message && event.chatId) await this.adapter.sendMessage(event.chatId, handled.message).catch(() => {})
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to handle WeCom template card event:`, err)
      if (event.chatId) await this.adapter.sendMessage(event.chatId, '处理卡片操作失败，请稍后重试。').catch(() => {})
    }
  }

  private async handleTemplateCardEvent(event: IncomingEvent): Promise<{ message: string; ok: boolean } | null> {
    if (event.eventType !== 'template_card_event') return null
    const cardEvent = event.eventPayload?.template_card_event
    if (!cardEvent || typeof cardEvent !== 'object') return null
    const eventKey = String(cardEvent.event_key ?? '')
    const taskId = String(cardEvent.task_id ?? '')
    const oneShot = this.isOneShotTemplateCardTask(taskId, eventKey)
    if (oneShot && this.completedTemplateCardTasks.has(taskId)) {
      return { message: '该卡片已处理，无需重复操作。', ok: true }
    }

    const command = this.commandFromTemplateCardEvent(eventKey, taskId, cardEvent)
    if (!command) return null
    const result = await this.commandExecutor.execute(command, {
      ...this.runtimeFromEvent(event),
    })
    if (result.ok && oneShot) {
      this.rememberCompletedTemplateCardTask(taskId)
      await this.updateTemplateCardDone(event, taskId, result.message)
    }
    return { message: result.message, ok: result.ok }
  }

  private isOneShotTemplateCardTask(taskId: string, eventKey: string): boolean {
    return taskId.startsWith(CONTEXT_CARD_TASK_PREFIX)
      || (taskId.startsWith(TASK_CARD_TASK_PREFIX) && eventKey === TASK_EVENT_RESULT)
  }

  private rememberCompletedTemplateCardTask(taskId: string): void {
    this.completedTemplateCardTasks.add(taskId)
    if (this.completedTemplateCardTasks.size > 1000) {
      const first = this.completedTemplateCardTasks.values().next().value
      if (first) this.completedTemplateCardTasks.delete(first)
    }
  }

  private async updateTemplateCardDone(event: IncomingEvent, taskId: string, message: string): Promise<void> {
    if (!this.adapter.updateTemplateCard) return
    const summary = message.split('\n').find((line) => line.trim())?.trim() ?? '操作已完成'
    try {
      await this.adapter.updateTemplateCard(event, {
        card_type: 'text_notice',
        source: { desc: '企微助手', desc_color: 3 },
        main_title: {
          title: '操作已完成',
          desc: summary.length > 30 ? `${summary.slice(0, 29)}…` : summary,
        },
        sub_title_text: '该卡片已处理，无需重复点击。',
        card_action: { type: 0 },
        task_id: taskId,
      })
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to update template card ${taskId}:`, err)
    }
  }

  private commandFromTemplateCardEvent(eventKey: string, taskId: string, cardEvent: Record<string, any>): ParsedWecomCommand | null {
    if (eventKey === CONTEXT_CARD_EVENT_KEY && taskId.startsWith(CONTEXT_CARD_TASK_PREFIX)) {
      const contextId = this.selectedTemplateCardOption(cardEvent, CONTEXT_CARD_QUESTION_KEY)
      return contextId
        ? this.createEventCommand('ctx.use', [contextId])
        : this.createEventCommand('ctx.use', [])
    }
    if (taskId.startsWith(MENU_CARD_TASK_PREFIX)) {
      if (eventKey === MENU_EVENT_CURRENT) return this.createEventCommand('ctx.current', [])
      if (eventKey === MENU_EVENT_LIST) return this.createEventCommand('ctx.list', [])
      if (eventKey === MENU_EVENT_HELP) return this.createEventCommand('help', [])
      if (eventKey === MENU_EVENT_RESET) return this.createEventCommand('ctx.reset', [])
    }
    if (taskId.startsWith(TASK_CARD_TASK_PREFIX)) {
      const generationTaskId = taskId.slice(TASK_CARD_TASK_PREFIX.length)
      if (eventKey === TASK_EVENT_STATUS) return this.createEventCommand('task.status', [generationTaskId])
      if (eventKey === TASK_EVENT_RESULT) return this.createEventCommand('task.result', [generationTaskId])
    }
    return null
  }

  private selectedTemplateCardOption(cardEvent: Record<string, any>, questionKey: string): string | null {
    const selectedItems = cardEvent.selected_items?.selected_item
    if (!Array.isArray(selectedItems)) return null
    const item = selectedItems.find((entry) => entry?.question_key === questionKey)
    const optionIds = item?.option_ids?.option_id
    return Array.isArray(optionIds) && optionIds[0] ? String(optionIds[0]) : null
  }

  private createEventCommand(commandKey: ParsedWecomCommand['commandKey'], args: string[]): ParsedWecomCommand {
    return {
      raw: `event:${commandKey}`,
      commandText: `event:${commandKey}`,
      commandKey,
      base: 'event',
      subcommand: commandKey,
      args,
      isKnown: true,
    }
  }

  private async handleMessage(msg: IncomingMessage): Promise<void> {
    const body = msg.rawBody as any
    const msgId: string = body?.msgid
    if (!msgId) return

    if (this.processedMsgs.has(msgId)) return
    this.processedMsgs.add(msgId)
    if (this.processedMsgs.size > 1000) {
      const first = this.processedMsgs.values().next().value
      if (first) this.processedMsgs.delete(first)
    }

    const { chatKey, chatId } = msg

    if (this.adapter.isReconnecting()) {
      await this.adapter.sendMessage(chatId, RECONNECTING_MESSAGE).catch(() => {})
      return
    }

    const command = parseWecomCommand(msg.content)
    if (command) {
      const runtime = this.runtimeFromMessage(msg)
      const result = await this.commandExecutor.execute(command, runtime)
      if (command.commandKey === 'help' && result.ok && await this.sendCommandMenuCard(runtime)) {
        return
      } else {
        if (result.message.trim()) await this.adapter.sendMessage(chatId, result.message).catch(() => {})
      }
      return
    }

    const resolvedContext = await this.resolveEffectiveContext(chatKey, msg.userId)
    const context = resolvedContext?.context ?? null
    if (!context) {
      if (!this.discoveredChats.has(chatKey)) {
        const chatType = chatKey.startsWith('wecom:group:') ? 'group' : 'user'
        this.discoveredChats.set(chatKey, { chatKey, chatType, firstSeenAt: Date.now() })
      }
      await this.adapter.sendMessage(chatId, UNBOUND_REPLY).catch(() => {})
      return
    }

    const queue = this.getOrCreateQueue(chatKey)
    if (queue.size >= QUEUE_BACKPRESSURE_LIMIT) {
      await this.adapter.sendMessage(chatId, BUSY_MESSAGE).catch(() => {})
      return
    }

    const content = this.resolveContent(msg)
    const frame = (msg as any)._frame

    queue.enqueue(async () => {
      if (this.adapter.isReconnecting()) {
        await this.adapter.sendMessage(chatId, RECONNECTING_MESSAGE).catch(() => {})
        return
      }

      const session = await this.sessions.getOrCreate(chatKey, context.id, context.sessionTtlMin)
      const { streamingMode } = this.deps.bot
      const responseRun = await this.createResponseRun(context, session, chatKey, chatId, msg.userId, content)
      const annotation = await this.findAnnotationAnswer(context, content)
      if (annotation) {
        await AnnotationAnswerRepository.recordHit(annotation.id)
        const answer = safeReply(annotation.answer)
        await this.saveMessages(chatKey, content, answer, responseRun.id)
        await BotResponseRunRepository.markSent(responseRun.id, answer)
        await this.sendTrackedStaticReply(chatId, answer, responseRun, frame)
        return
      }

      if (this.deps.bot.provider === 'dify') {
        if (shouldSkipRuntimeToolsForDify(this.deps.bot.provider, context.mcpConfigs ?? [], context.skillConfigs ?? [])) {
          console.log(`[BotInstance:${this.deps.bot.id}] Dify provider skips MCP/Skill runtime tools`)
        }
        if (streamingMode === 'none') {
          await this.handleDify(chatId, chatKey, content, session.difyConversationId ?? null, undefined, frame, responseRun)
        } else {
          await this.handleDifyStreaming(chatId, chatKey, content, session.difyConversationId ?? null, frame, responseRun)
        }
        return
      }

      const mcpTools = this.resolveTools(context.mcpConfigs ?? [])
      const skillContext = this.createSkillRuntimeContext(context.id, chatKey, content)
      const skillTools = this.resolveSkillTools(context.skillConfigs ?? [], skillContext)
      const tools = this.mergeTools(mcpTools, skillTools)
      let systemPrompt = injectAllowedProjects(context.systemPrompt, context.mcpConfigs ?? [])
      systemPrompt = injectWikiNamespace(systemPrompt, context.mcpConfigs ?? [])
      systemPrompt = appendSkillPrompts(systemPrompt, buildSkillPromptAdditions([...this.skillToolPool.values()], context.skillConfigs ?? [], content))
      const promptWithForcedResults = await this.executeForceCallMcps(systemPrompt, context.mcpConfigs ?? [], content, {
        contextId: context.id,
        chatKey,
        responseRunId: responseRun.id,
      })

      if (streamingMode === 'progressive') {
        await this.handleProgressive(chatId, chatKey, content, session.messages, promptWithForcedResults, tools, frame, responseRun)
      } else if (streamingMode === 'typewriter') {
        await this.handleTypewriter(chatId, chatKey, content, session.messages, promptWithForcedResults, tools, frame, responseRun)
      } else {
        await this.handleNone(chatId, chatKey, content, session.messages, promptWithForcedResults, tools, frame, responseRun)
      }
    })
  }

  private async createResponseRun(
    context: ContextConfig,
    session: Session,
    chatKey: string,
    chatId: string,
    userId: string,
    content: string | IncomingContent[]
  ): Promise<BotResponseRun> {
    return BotResponseRunRepository.create({
      feedbackId: randomUUID(),
      botId: this.deps.bot.id,
      contextId: context.id,
      sessionId: session.id,
      chatKey,
      chatId,
      userId,
      questionPreview: contentText(content),
      provider: this.deps.bot.provider,
      model: this.deps.bot.provider === 'dify'
        ? this.deps.bot.difyAppId ?? this.deps.bot.llmModel
        : this.deps.bot.llmModel,
      feedbackAvailable: true,
    })
  }

  private async findAnnotationAnswer(context: ContextConfig, content: string | IncomingContent[]) {
    const question = contentText(content)
    if (!question.trim()) return null
    return AnnotationAnswerRepository.findMatch(question, {
      contextId: context.id,
      namespace: firstWikiNamespaceFromConfigs(context.mcpConfigs ?? []),
    })
  }

  private async sendTrackedStaticReply(
    chatId: string,
    text: string,
    responseRun: BotResponseRun,
    frame?: any
  ): Promise<void> {
    if (frame && responseRun.feedbackId) {
      try {
        const streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE, responseRun.feedbackId)
        await this.adapter.editMessage(chatId, streamId, text, true)
        return
      } catch (err) {
        console.warn(`[BotInstance:${this.deps.bot.id}] Feedback reply stream unavailable:`, err)
      }
    }
    await this.adapter.sendMessage(chatId, text).catch(() => {})
    await BotResponseRunRepository.markFeedbackUnavailable(
      responseRun.id,
      frame ? 'feedback stream unavailable; sent as proactive message' : 'no callback frame for feedback-enabled reply'
    )
  }

  private async finishTrackedReply(
    chatId: string,
    text: string,
    responseRun: BotResponseRun,
    streamId?: string
  ): Promise<void> {
    if (streamId) {
      try {
        await this.adapter.editMessage(chatId, streamId, text, true)
        return
      } catch (err) {
        console.warn(`[BotInstance:${this.deps.bot.id}] Failed to finish feedback stream:`, err)
      }
    }
    await this.adapter.sendMessage(chatId, text).catch(() => {})
    await BotResponseRunRepository.markFeedbackUnavailable(
      responseRun.id,
      streamId ? 'feedback stream finish failed; sent fallback message' : 'no feedback-capable stream'
    )
  }

  private createProgressReporter(chatId: string, frame: any | undefined, responseRun: BotResponseRun) {
    let streamId: string | undefined
    let phase: ProgressPhase = 'thinking'
    let interval: ReturnType<typeof setInterval> | undefined
    let tick = 0
    let active = false
    let editAvailable = true
    const startedAt = Date.now()

    const stop = () => {
      active = false
      if (interval) clearInterval(interval)
      interval = undefined
    }

    const render = async () => {
      if (!active || !streamId || !editAvailable) return
      try {
        await this.adapter.editMessage(chatId, streamId, progressMessage(phase, startedAt, tick), false)
        tick += 1
      } catch (err) {
        editAvailable = false
        stop()
        console.warn(`[BotInstance:${this.deps.bot.id}] Progress heartbeat stopped after edit failure:`, err)
      }
    }

    return {
      get streamId() {
        return streamId
      },
      start: async () => {
        if (!frame) {
          await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
          return
        }
        try {
          streamId = await this.adapter.sendThinkingWithStream(frame, progressMessage(phase, startedAt, tick), responseRun.feedbackId)
          tick += 1
        } catch (err) {
          editAvailable = false
          console.warn(`[BotInstance:${this.deps.bot.id}] Progress stream unavailable:`, err)
          await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
          return
        }
        active = true
        interval = setInterval(() => { void render() }, PROGRESS_HEARTBEAT_INTERVAL_MS)
      },
      setPhase: (nextPhase: ProgressPhase) => {
        if (!active || !editAvailable) return
        phase = nextPhase
        void render()
      },
      finish: async (text: string) => {
        stop()
        await this.finishTrackedReply(chatId, text, responseRun, streamId)
      },
      fail: async (text: string) => {
        stop()
        await this.sendRunErrorReply(chatId, text, responseRun, streamId)
      },
      stop,
    }
  }

  private async sendRunErrorReply(
    chatId: string,
    text: string,
    responseRun: BotResponseRun,
    streamId?: string
  ): Promise<void> {
    await BotResponseRunRepository.markError(responseRun.id, text)
    if (streamId) {
      await this.adapter.editMessage(chatId, streamId, text, true).catch(async () => {
        await this.adapter.sendMessage(chatId, text).catch(() => {})
      })
      return
    }
    await this.adapter.sendMessage(chatId, text).catch(() => {})
  }

  /** Resolve tools from toolPool based on context mcpConfigs */
  private resolveTools(mcpConfigs: McpConfig[]): StructuredTool[] {
    const tools: StructuredTool[] = []
    for (const cfg of mcpConfigs) {
      if (!cfg.enabled) continue
      const serverTools = this.toolPool.get(cfg.mcpServerId)
      console.log(`[BotInstance] resolveTools: mcpServerId=${cfg.mcpServerId}, found=${serverTools?.length ?? 'none'}, poolKeys=[${[...this.toolPool.keys()].join(',')}]`)
      if (serverTools) tools.push(...serverTools)
    }
    console.log(`[BotInstance] resolveTools total: ${tools.length} tools, mcpConfigs=${JSON.stringify(mcpConfigs)}`)
    return tools
  }

  private createSkillRuntimeContext(contextId: string, chatKey: string, content: string | IncomingContent[]) {
    return {
      botId: this.deps.bot.id,
      contextId,
      chatKey,
      content,
      audit: async (record: Parameters<typeof SkillAuditRepository.create>[0]) => { await SkillAuditRepository.create(record) },
    }
  }

  private resolveSkillTools(
    skillConfigs: SkillConfig[],
    runtimeContext: ReturnType<BotInstance['createSkillRuntimeContext']>
  ): StructuredTool[] {
    const tools = createSkillTools([...this.skillToolPool.values()], skillConfigs, runtimeContext)
    console.log(`[BotInstance] resolveSkillTools total: ${tools.length}, skillConfigs=${JSON.stringify(skillConfigs)}`)
    return tools
  }

  private mergeTools(mcpTools: StructuredTool[], skillTools: StructuredTool[]): StructuredTool[] {
    const merged: StructuredTool[] = []
    const seen = new Set<string>()
    for (const tool of [...mcpTools, ...skillTools]) {
      const original = tool.name
      if (seen.has(tool.name)) {
        let index = 2
        while (seen.has(`${original}_${index}`)) index += 1
        ;(tool as any).name = `${original}_${index}`
        console.warn(`[BotInstance] Tool name conflict: ${original} renamed to ${tool.name}`)
      }
      seen.add(tool.name)
      merged.push(tool)
    }
    return merged
  }

  private async invokeWithTimeout<T>(
    tool: { invoke: (args: unknown, config?: { signal?: AbortSignal }) => Promise<T> },
    args: unknown,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        tool.invoke(args, { signal: controller.signal }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error(`Tool invoke timed out after ${timeoutMs}ms`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async createTrackedMcpToolClient(server: McpServerConfig): Promise<McpToolClient> {
    const toolClient = await createMcpToolClient(server)
    return {
      ...toolClient,
      tools: this.wrapMcpTools(server.id, toolClient.tools),
    }
  }

  private wrapMcpTools(serverId: string, tools: StructuredTool[]): StructuredTool[] {
    return tools.map((tool) => this.wrapMcpTool(serverId, tool))
  }

  private wrapMcpTool(serverId: string, tool: StructuredTool): StructuredTool {
    const originalName = tool.name
    const invokeWithRetry = async (input: unknown, config?: unknown) => {
      try {
        return await (tool.invoke as any).call(tool, input, config)
      } catch (err) {
        if (!isMcpSessionInvalidError(err) || hasRetriedMcpSession(config)) throw err

        console.warn(`[BotInstance:${this.deps.bot.id}] MCP session expired for ${serverId}/${originalName}; reinitializing`)
        const refreshedTools = await this.reloadMcpServerToolPool(serverId).catch((reloadErr) => {
          console.error(`[BotInstance:${this.deps.bot.id}] Failed to reinitialize MCP server ${serverId}:`, reloadErr)
          throw err
        })
        const replacement = refreshedTools.find((candidate) => candidate.name === originalName || candidate.name === tool.name)
        if (!replacement) throw err
        return (replacement.invoke as any).call(replacement, input, withMcpSessionRetryMetadata(config))
      }
    }

    return new Proxy(tool as any, {
      get(target, prop, receiver) {
        if (prop === 'invoke' || prop === 'call') return invokeWithRetry
        return Reflect.get(target, prop, receiver)
      },
    }) as StructuredTool
  }

  private async reloadMcpServerToolPool(serverId: string): Promise<StructuredTool[]> {
    const inFlight = this.mcpReloadInFlight.get(serverId)
    if (inFlight) return inFlight

    const reload = this.reloadMcpServerToolPoolNow(serverId)
    this.mcpReloadInFlight.set(serverId, reload)
    try {
      return await reload
    } finally {
      this.mcpReloadInFlight.delete(serverId)
    }
  }

  private async reloadMcpServerToolPoolNow(serverId: string): Promise<StructuredTool[]> {
    const server = this.deps.mcpServers.find((item) => item.id === serverId && item.enabled)
    if (!server) throw new Error(`MCP server ${serverId} is not enabled`)

    const previousClient = this.toolClients.get(serverId)
    const toolClient = await this.createTrackedMcpToolClient(server)
    this.toolPool.set(serverId, toolClient.tools)
    this.toolClients.set(serverId, toolClient)
    if (previousClient && previousClient !== toolClient) {
      await this.closeMcpToolClients([previousClient])
    }
    return toolClient.tools
  }

  private async closeMcpToolClients(clients?: McpToolClient[]): Promise<void> {
    const clientsToClose = clients ?? [...this.toolClients.values()]
    if (!clients) this.toolClients.clear()
    await Promise.allSettled(clientsToClose.map((client) => client.close()))
  }

  private async executeForceCallMcps(
    systemPrompt: string,
    mcpConfigs: McpConfig[],
    content: string | IncomingContent[],
    runtimeMeta: { contextId?: string; chatKey?: string; responseRunId?: string } = {}
  ): Promise<string> {
    const results: string[] = []
    const FORCE_CALL_TIMEOUT_MS = 55_000
    const query = typeof content === 'string'
      ? content
      : content.map((item) => (item.type === 'text' ? item.text : `[图片: ${item.url}]`)).join('\n')

    for (const cfg of mcpConfigs) {
      if (!cfg.enabled) continue
      const serverTools = this.toolPool.get(cfg.mcpServerId)
      if (!serverTools?.length) continue

      const findTool = (name: string) => serverTools.find((tool) => tool.name === name || tool.name.endsWith(`_${name}`))
      const policy = cfg.params?.retrievalPolicy as string | undefined
      const forceCallPage = cfg.params?.forceCallPage as string | undefined
      const nsParam = cfg.params?.namespace
      const namespace = Array.isArray(nsParam) ? nsParam[0] as string | undefined : nsParam as string | undefined
      const shouldForce = Boolean(cfg.forceCall || policy === 'autoSearch' || policy === 'fixedPage' || forceCallPage)
      if (!shouldForce) continue

      if (policy === 'manual') continue

      if (policy === 'fixedPage' || forceCallPage) {
        const wikiReadTool = findTool('wiki_read')
        if (wikiReadTool) {
          const startedAt = Date.now()
          try {
            const output = await this.invokeWithTimeout(wikiReadTool, {
              path: forceCallPage,
              namespace,
              max_chars: Number(cfg.params?.maxChars ?? 6000),
            }, FORCE_CALL_TIMEOUT_MS)
            const textOutput = typeof output === 'string' ? output : JSON.stringify(output)
            await this.recordWikiRetrieval({
              namespace,
              policy: 'fixedPage',
              query: forceCallPage ?? '',
              hitCount: isWikiReadHit(textOutput) ? 1 : 0,
              hitPaths: forceCallPage && isWikiReadHit(textOutput) ? [forceCallPage] : [],
              durationMs: Date.now() - startedAt,
              ...runtimeMeta,
            })
            results.push(`[wiki_read: ${forceCallPage}]\n${typeof output === 'string' ? output : JSON.stringify(output)}`)
          } catch (err) {
            console.error(`[BotInstance:${this.deps.bot.id}] Force-call wiki_read failed:`, err)
            await this.recordWikiRetrieval({
              namespace,
              policy: 'fixedPage',
              query: forceCallPage ?? '',
              hitCount: 0,
              hitPaths: [],
              durationMs: Date.now() - startedAt,
              error: err instanceof Error ? err.message : String(err),
              ...runtimeMeta,
            })
          }
          continue
        }
      }

      if (policy === 'autoSearch' || findTool('wiki_search')) {
        const wikiSearchTool = findTool('wiki_search')
        if (wikiSearchTool) {
          const startedAt = Date.now()
          try {
            const output = await this.invokeWithTimeout(wikiSearchTool, {
              query,
              namespace,
              cross_ns: Boolean(cfg.params?.crossNs),
            }, FORCE_CALL_TIMEOUT_MS)
            const textOutput = typeof output === 'string' ? output : JSON.stringify(output)
            const hits = extractWikiSearchHits(textOutput)
            await this.recordWikiRetrieval({
              namespace,
              policy: 'autoSearch',
              query,
              hitCount: hits.hitCount,
              hitPaths: hits.hitPaths,
              durationMs: Date.now() - startedAt,
              ...runtimeMeta,
            })
            results.push(`[wiki_search]\n${typeof output === 'string' ? output : JSON.stringify(output)}`)
          } catch (err) {
            console.error(`[BotInstance:${this.deps.bot.id}] Force-call wiki_search failed:`, err)
            await this.recordWikiRetrieval({
              namespace,
              policy: 'autoSearch',
              query,
              hitCount: 0,
              hitPaths: [],
              durationMs: Date.now() - startedAt,
              error: err instanceof Error ? err.message : String(err),
              ...runtimeMeta,
            })
          }
          continue
        }
      }

      for (const tool of serverTools) {
        const shape = (tool as any).schema?.shape
        if (!shape || !('query' in shape)) continue
        try {
          const output = await this.invokeWithTimeout(tool, { query }, FORCE_CALL_TIMEOUT_MS)
          results.push(`[${tool.name}]\n${typeof output === 'string' ? output : JSON.stringify(output)}`)
        } catch (err) {
          console.error(`[BotInstance:${this.deps.bot.id}] Force-call MCP failed: ${tool.name}`, err)
        }
      }
    }

    if (results.length === 0) return systemPrompt
    return `${systemPrompt}\n\n# 强制检索结果\n\n${results.join('\n\n')}`
  }

  private async recordWikiRetrieval(data: {
    namespace?: string
    policy: string
    query: string
    hitCount: number
    hitPaths: string[]
    durationMs: number
    error?: string
    contextId?: string
    chatKey?: string
    responseRunId?: string
  }): Promise<void> {
    if (!data.namespace) return
    try {
      await WikiRetrievalLogRepository.create({
        botId: this.deps.bot.id,
        contextId: data.contextId ?? null,
        chatKey: data.chatKey ?? null,
        responseRunId: data.responseRunId ?? null,
        namespace: data.namespace,
        policy: data.policy,
        query: data.query,
        hitCount: data.hitCount,
        hitPaths: data.hitPaths,
        durationMs: data.durationMs,
        error: data.error ?? null,
      })
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to record Wiki retrieval log:`, err)
    }
  }

  private async handleNone(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[],
    frame: any | undefined,
    responseRun: BotResponseRun
  ): Promise<void> {
    await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
    try {
      const response = safeReply(await this.engine!.invokeWithTools(sessionMessages, content, systemPrompt, tools))
      await this.saveMessages(chatKey, content, response, responseRun.id)
      await BotResponseRunRepository.markSent(responseRun.id, response)
      await this.sendTrackedStaticReply(chatId, response, responseRun, frame)
    } catch (err: any) {
      if (err instanceof RecursionLimitError) {
        const response = safeReply(err.summary)
        await this.saveMessages(chatKey, content, response, responseRun.id)
        await BotResponseRunRepository.markSent(responseRun.id, response)
        await this.sendTrackedStaticReply(chatId, response, responseRun, frame)
        return
      }
      // Vision fallback: if LLM rejects multimodal input (400/422), retry with text-only degradation
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response, responseRun.id)
          await BotResponseRunRepository.markSent(responseRun.id, response)
          await this.sendTrackedStaticReply(chatId, response, responseRun, frame)
          return
        } catch {
          // fall through to generic error
        }
      }
      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.sendRunErrorReply(chatId, '处理消息时发生错误，请稍后重试。', responseRun)
    }
  }

  private async handleProgressive(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[],
    frame: any | undefined,
    responseRun: BotResponseRun
  ): Promise<void> {
    const reporter = this.createProgressReporter(chatId, frame, responseRun)
    await reporter.start()

    try {
      const response = safeReply(await this.engine!.invokeWithTools(sessionMessages, content, systemPrompt, tools, {
        onToolStart: () => reporter.setPhase('tool'),
        onToolEnd: () => reporter.setPhase('organizing'),
        onOrganizing: () => reporter.setPhase('organizing'),
      }))
      await this.saveMessages(chatKey, content, response, responseRun.id)
      await BotResponseRunRepository.markSent(responseRun.id, response)
      await reporter.finish(response)
    } catch (err: any) {
      reporter.stop()
      if (err instanceof RecursionLimitError) {
        const response = safeReply(err.summary)
        await this.saveMessages(chatKey, content, response, responseRun.id)
        await BotResponseRunRepository.markSent(responseRun.id, response)
        await this.finishTrackedReply(chatId, response, responseRun, reporter.streamId)
        return
      }
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response, responseRun.id)
          await BotResponseRunRepository.markSent(responseRun.id, response)
          await this.finishTrackedReply(chatId, response, responseRun, reporter.streamId)
          return
        } catch {
          // fall through to generic error
        }
      }

      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.sendRunErrorReply(chatId, '处理消息时发生错误，请稍后重试。', responseRun, reporter.streamId)
    }
  }

  private async handleTypewriter(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[],
    frame: any | undefined,
    responseRun: BotResponseRun
  ): Promise<void> {
    if (!frame) {
      await this.handleNone(chatId, chatKey, content, sessionMessages, systemPrompt, tools, undefined, responseRun)
      return
    }

    let streamId: string | undefined
    try {
      streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE, responseRun.feedbackId)
    } catch {
      streamId = undefined
    }

    if (!streamId) {
      await this.handleNone(chatId, chatKey, content, sessionMessages, systemPrompt, tools, frame, responseRun)
      return
    }

    let accumulated = ''
    let lastEditAt = 0
    let finalResponse = ''

    try {
      finalResponse = safeReply(await this.engine!.invokeWithStream(sessionMessages, content, systemPrompt, tools, {
        onToken: async (token) => {
          accumulated += token
          const now = Date.now()
          if (now - lastEditAt >= TYPEWRITER_INTERVAL_MS) {
            lastEditAt = now
            await this.adapter.editMessage(chatId, streamId!, accumulated, false).catch(() => {})
          }
        },
        onToolStart: async () => {
          await this.adapter.editMessage(chatId, streamId!, STREAM_TOOL_MSG, false).catch(() => {})
        },
        onToolEnd: async () => {},
        onOrganizing: async () => {},
      }))

      await this.saveMessages(chatKey, content, finalResponse, responseRun.id)
      await BotResponseRunRepository.markSent(responseRun.id, finalResponse)
      await this.finishTrackedReply(chatId, finalResponse, responseRun, streamId)
    } catch (err: any) {
      if (err instanceof RecursionLimitError) {
        const response = safeReply(accumulated.trim() || err.summary)
        await this.saveMessages(chatKey, content, response, responseRun.id)
        await BotResponseRunRepository.markSent(responseRun.id, response)
        await this.finishTrackedReply(chatId, response, responseRun, streamId)
        return
      }
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response, responseRun.id)
          await BotResponseRunRepository.markSent(responseRun.id, response)
          await this.finishTrackedReply(chatId, response, responseRun, streamId)
          return
        } catch {
          // fall through to generic error
        }
      }

      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.sendRunErrorReply(chatId, '处理消息时发生错误，请稍后重试。', responseRun, streamId)
    }
  }

  private async handleDify(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    conversationId: string | null,
    streamId: string | undefined,
    frame: any | undefined,
    responseRun: BotResponseRun
  ): Promise<void> {
    let replyStreamId = streamId
    if (!replyStreamId && frame) {
      try {
        replyStreamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE, responseRun.feedbackId)
      } catch {
        replyStreamId = undefined
      }
    }
    if (!replyStreamId) await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
    try {
      const result = await this.difyClient!.chat(content, conversationId, chatKey)
      const answer = safeReply(result.answer)
      await this.sessions.setDifyConversationId(chatKey, result.conversationId)
      await this.saveMessages(chatKey, content, answer, responseRun.id)
      await BotResponseRunRepository.markSent(responseRun.id, answer, { difyConversationId: result.conversationId })
      await this.finishTrackedReply(chatId, answer, responseRun, replyStreamId)
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Dify error:`, err)
      await this.sendRunErrorReply(chatId, '处理消息时发生错误，请稍后重试。', responseRun, replyStreamId)
    }
  }

  private async handleDifyStreaming(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    conversationId: string | null,
    frame: any | undefined,
    responseRun: BotResponseRun
  ): Promise<void> {
    if (!frame) {
      await this.handleDify(chatId, chatKey, content, conversationId, undefined, undefined, responseRun)
      return
    }

    let streamId: string | undefined
    try {
      streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE, responseRun.feedbackId)
    } catch {
      streamId = undefined
    }

    if (!streamId) {
      await this.handleDify(chatId, chatKey, content, conversationId, undefined, frame, responseRun)
      return
    }

    let accumulated = ''
    let lastEditAt = 0
    let streamStarted = false

    try {
      const result = await this.difyClient!.chatStream({
        content,
        conversationId,
        userId: chatKey,
        onToken: async (token) => {
          streamStarted = true
          accumulated += token
          const now = Date.now()
          if (now - lastEditAt >= TYPEWRITER_INTERVAL_MS) {
            lastEditAt = now
            await this.adapter.editMessage(chatId, streamId!, accumulated, false).catch(() => {})
          }
        },
      })
      const answer = safeReply(result.answer)
      await this.sessions.setDifyConversationId(chatKey, result.conversationId)
      await this.saveMessages(chatKey, content, answer, responseRun.id)
      await BotResponseRunRepository.markSent(responseRun.id, answer, { difyConversationId: result.conversationId })
      await this.finishTrackedReply(chatId, answer, responseRun, streamId)
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Dify streaming error:`, err)
      await BotResponseRunRepository.markError(responseRun.id, err instanceof Error ? err.message : String(err))
      if (streamStarted) {
        await this.adapter.editMessage(chatId, streamId, `${accumulated}\n\n处理消息时发生错误，请稍后重试。`, true).catch(() => {})
        return
      }
      await this.adapter.editMessage(chatId, streamId, '流式连接失败，正在切换为普通回复...', false).catch(() => {})
      await this.handleDify(chatId, chatKey, content, conversationId, streamId, undefined, responseRun)
    }
  }

  private async saveMessages(chatKey: string, content: string | IncomingContent[], response: string, responseRunId?: string | null): Promise<void> {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    await this.sessions.addMessage(chatKey, { role: 'human', content: contentStr, timestamp: Date.now(), responseRunId }, responseRunId)
    await this.sessions.addMessage(chatKey, { role: 'ai', content: response, timestamp: Date.now(), responseRunId }, responseRunId)
  }

  private getOrCreateQueue(chatKey: string): MessageQueue {
    if (!this.queues.has(chatKey)) {
      this.queues.set(chatKey, new MessageQueue())
    }
    return this.queues.get(chatKey)!
  }
}

function injectWikiNamespace(systemPrompt: string, mcpConfigs: McpConfig[]): string {
  const namespaces: string[] = []
  for (const cfg of mcpConfigs) {
    if (!cfg.enabled) continue
    const ns = cfg.params?.namespace
    if (!ns) continue
    if (Array.isArray(ns)) namespaces.push(...ns)
    else if (typeof ns === 'string') namespaces.push(ns)
  }
  if (namespaces.length === 0) return systemPrompt

  const nsText = namespaces.length === 1
    ? `当前绑定的 Wiki namespace: ${namespaces[0]}\n当你需要查询相关知识时，使用 wiki_read、wiki_search 等工具，默认在 namespace "${namespaces[0]}" 中查询。`
    : `当前绑定的 Wiki namespaces: ${namespaces.join(', ')}\n当你需要查询相关知识时，使用 wiki_read、wiki_search 等工具，可查询这些 namespace。`

  const marker = '## Wiki 知识库'
  if (systemPrompt.includes(marker)) return systemPrompt
  return `${systemPrompt}\n\n## Wiki 知识库\n${nsText}`
}

function firstWikiNamespaceFromConfigs(mcpConfigs: McpConfig[]): string | null {
  for (const cfg of mcpConfigs) {
    if (!cfg.enabled) continue
    const ns = cfg.params?.namespace
    if (Array.isArray(ns)) {
      const first = ns.find((item): item is string => typeof item === 'string' && Boolean(item))
      if (first) return first
    } else if (typeof ns === 'string' && ns) {
      return ns
    }
  }
  return null
}

function wecomMediaTypeForGeneratedFile(file: GeneratedFile): WecomMediaType {
  if (file.fileType === 'image' || file.mimeType?.startsWith('image/')) return 'image'
  return 'file'
}

function parseWecomRole(value?: string): WecomUserRole | null {
  if (value === 'user' || value === '普通用户') return 'user'
  if (value === 'manager' || value === '管理员') return 'manager'
  if (value === 'admin' || value === '超级管理员') return 'admin'
  return null
}

function parseWecomStatus(value?: string): WecomUserStatus | null {
  if (value === 'active' || value === '启用') return 'active'
  if (value === 'disabled' || value === '禁用') return 'disabled'
  return null
}

function parseOnOff(value?: string): boolean | null {
  const normalized = value?.toLowerCase()
  if (normalized === 'on' || normalized === 'true' || normalized === 'enable' || normalized === 'enabled' || value === '启用') return true
  if (normalized === 'off' || normalized === 'false' || normalized === 'disable' || normalized === 'disabled' || value === '禁用') return false
  return null
}

function parseConfirmMode(value?: string): boolean {
  const normalized = value?.toLowerCase()
  return normalized === 'confirm' || normalized === 'yes' || normalized === 'true' || value === '二次确认'
}

function parseUserUpsertArgs(args: string[]): { role: WecomUserRole; status: WecomUserStatus; displayName: string | null } {
  let role: WecomUserRole = 'user'
  let status: WecomUserStatus = 'active'
  const displayNameParts = [...args]
  const firstRole = parseWecomRole(displayNameParts[0])
  if (firstRole) {
    role = firstRole
    displayNameParts.shift()
  }
  const firstStatus = parseWecomStatus(displayNameParts[0])
  if (firstStatus) {
    status = firstStatus
    displayNameParts.shift()
  }
  return {
    role,
    status,
    displayName: displayNameParts.join(' ').trim() || null,
  }
}

function formatWecomRole(role: WecomUserRole): string {
  if (role === 'admin') return '超级管理员'
  if (role === 'manager') return '管理员'
  return '普通用户'
}

function isWikiReadHit(output: string): boolean {
  const normalized = output.trim()
  if (!normalized) return false
  return !/页面不存在|错误:|not found|error/i.test(normalized)
}

function extractWikiSearchHits(output: string): { hitCount: number; hitPaths: string[] } {
  if (!output.trim() || output.includes('未找到匹配页面')) return { hitCount: 0, hitPaths: [] }
  const hitPaths = [...output.matchAll(/\[[^\]]+\]\s+.+?\(([^)]+\.md)\)/g)]
    .map((match) => match[1])
    .filter((path): path is string => Boolean(path))
  if (hitPaths.length > 0) return { hitCount: hitPaths.length, hitPaths: [...new Set(hitPaths)] }
  return { hitCount: 1, hitPaths: [] }
}

function injectAllowedProjects(systemPrompt: string, mcpConfigs: McpConfig[]): string {
  // Extract allowedProjects from the gitnexus MCP config (or any config with allowedProjects)
  const allowedProjects: string[] = []
  for (const cfg of mcpConfigs) {
    if (cfg.enabled && cfg.params.allowedProjects?.length) {
      allowedProjects.push(...cfg.params.allowedProjects)
    }
  }
  if (allowedProjects.length === 0) return systemPrompt

  const projectList = allowedProjects.map((p) => `* ${p}`).join('\n')
  const marker = '# 项目范围限制'
  if (systemPrompt.includes(marker)) {
    return systemPrompt.replace(
      /# 项目范围限制[\s\S]*?(?=\n#|\n$|$)/,
      `# 项目范围限制\n\n当使用 gitnexus 或任何代码检索能力时，只允许查询以下项目：\n\n${projectList}\n\n禁止访问、分析、引用或推测任何其他项目内容。`
    )
  }
  return `${systemPrompt}\n\n# 项目范围限制\n\n当使用 gitnexus 或任何代码检索能力时，只允许查询以下项目：\n\n${projectList}\n\n禁止访问、分析、引用或推测任何其他项目内容。`
}
