import { randomUUID } from 'crypto'
import type { Client } from '@libsql/client'
import type { StructuredTool } from '@langchain/core/tools'
import { AgentEngine, DifyClient, MessageQueue, RecursionLimitError, WecomAdapter, appendSkillPrompts, buildSkillPromptAdditions, createMcpToolClient, createSkillTools } from '@wecom-platform/core'
import type { McpToolClient } from '@wecom-platform/core'
import { SessionStore } from '../session-store.js'
import { SkillAuditRepository } from '../db/skill-audit-repository.js'
import { WikiRetrievalLogRepository } from '../db/wiki-retrieval-log-repository.js'
import { BotResponseRunRepository } from '../db/bot-response-run-repository.js'
import { AnnotationAnswerRepository } from '../db/annotation-answer-repository.js'
import { handleIncomingWecomEvent } from '../services/wecom-event-service.js'
import type { BotConfig, ContextConfig, Binding, McpServerConfig, McpConfig, SkillConfig, SkillDefinition, IncomingMessage, IncomingContent, IncomingEvent, Session, SessionMessage, BotResponseRun } from '@wecom-platform/types'

const QUEUE_BACKPRESSURE_LIMIT = 10
const BUSY_MESSAGE = '当前处理队列繁忙，请稍后再试'
const RECONNECTING_MESSAGE = '机器人正在重连，请稍后再试'
const THINKING_MESSAGE = '🤔 正在分析，请稍候...'
const STREAM_TOOL_MSG = '🔍 正在检索相关信息...'
const TYPEWRITER_INTERVAL_MS = 800
const EMPTY_RESPONSE_FALLBACK = '抱歉，我暂时无法生成有效回复，请稍后重试。'
const PROGRESS_HEARTBEAT_INTERVAL_MS = 5_000

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

export class BotInstance {
  private adapter: WecomAdapter
  private engine: AgentEngine | null = null
  private difyClient: DifyClient | null = null
  private toolPool = new Map<string, StructuredTool[]>() // mcpServerId → tools
  private toolClients = new Map<string, McpToolClient>()
  private skillToolPool = new Map<string, SkillDefinition>()
  private queues = new Map<string, MessageQueue>()
  private sessions: SessionStore
  private processedMsgs = new Set<string>()
  private contextMap: Map<string, ContextConfig>
  private bindingMap: Map<string, string>
  private defaultContext: ContextConfig | null
  private discoveredChats = new Map<string, DiscoveredChat>()

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
          const toolClient = await createMcpToolClient(server)
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
        const toolClient = await createMcpToolClient(server)
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

  private resolveContent(msg: IncomingMessage): string | IncomingContent[] {
    if (!Array.isArray(msg.content)) return msg.content
    if (this.deps.bot.visionEnabled) return msg.content
    // visionEnabled=false: keep only text parts, replace image items with [图片] label (no URL)
    return msg.content.map((c) => (c.type === 'text' ? c.text : '[图片]')).join('\n')
  }

  private async handleEvent(event: IncomingEvent): Promise<void> {
    try {
      await handleIncomingWecomEvent(event, { botId: this.deps.bot.id, contexts: this.deps.contexts })
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Failed to handle WeCom event ${event.eventType}:`, err)
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

    const contextId = this.bindingMap.get(chatKey)
    const context = contextId ? this.contextMap.get(contextId) : this.defaultContext
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
