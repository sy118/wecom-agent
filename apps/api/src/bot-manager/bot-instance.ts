import type { Client } from '@libsql/client'
import type { StructuredTool } from '@langchain/core/tools'
import { AgentEngine, DifyClient, MessageQueue, WecomAdapter, appendSkillPrompts, buildSkillPromptAdditions, createMcpTools, createSkillTools, executeScriptSkill } from '@wecom-platform/core'
import { SessionStore } from '../session-store.js'
import { SkillAuditRepository } from '../db/skill-audit-repository.js'
import type { BotConfig, ContextConfig, Binding, McpServerConfig, McpConfig, SkillConfig, SkillDefinition, IncomingMessage, IncomingContent, SessionMessage } from '@wecom-platform/types'

const QUEUE_BACKPRESSURE_LIMIT = 10
const BUSY_MESSAGE = '当前处理队列繁忙，请稍后再试'
const RECONNECTING_MESSAGE = '机器人正在重连，请稍后再试'
const THINKING_MESSAGE = '🤔 正在分析，请稍候...'
const STREAM_TOOL_MSG = '🔍 正在检索相关信息...'
const TYPEWRITER_INTERVAL_MS = 800
const EMPTY_RESPONSE_FALLBACK = '抱歉，我暂时无法生成有效回复，请稍后重试。'

function safeReply(text: string): string {
  return text.trim() || EMPTY_RESPONSE_FALLBACK
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
        timeoutMs: 500_000,
      })
      await this.engine.initialize()

      // Build tool pool: load tools per MCP server
      for (const server of mcpServers) {
        if (!server.enabled) continue
        try {
          const tools = await createMcpTools([server])
          this.toolPool.set(server.id, tools)
        } catch (err) {
          console.error(`[BotInstance:${bot.id}] Failed to load tools from ${server.name}:`, err)
        }
      }
      console.log(`[BotInstance:${bot.id}] Loaded ${this.skillToolPool.size} enabled skill(s)`)
    }

    this.adapter.onMessage((msg) => this.handleMessage(msg))
    await this.adapter.start()
  }

  async stop(): Promise<void> {
    await this.adapter.stop()
    this.sessions.destroy()
    this.queues.clear()
    this.processedMsgs.clear()
    this.discoveredChats.clear()
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

      if (this.deps.bot.provider === 'dify') {
        if ((context.mcpConfigs?.length ?? 0) > 0 || (context.skillConfigs?.length ?? 0) > 0) {
          console.log(`[BotInstance:${this.deps.bot.id}] Dify provider skips MCP/Skill runtime tools`)
        }
        if (streamingMode === 'none') {
          await this.handleDify(chatId, chatKey, content, session.difyConversationId ?? null)
        } else {
          await this.handleDifyStreaming(chatId, chatKey, content, session.difyConversationId ?? null, frame)
        }
        return
      }

      const mcpTools = this.resolveTools(context.mcpConfigs ?? [])
      const skillContext = this.createSkillRuntimeContext(context.id, chatKey, content)
      const skillTools = this.resolveSkillTools(context.skillConfigs ?? [], skillContext)
      const tools = this.mergeTools(mcpTools, skillTools)
      let systemPrompt = injectAllowedProjects(context.systemPrompt, context.mcpConfigs ?? [])
      systemPrompt = appendSkillPrompts(systemPrompt, buildSkillPromptAdditions([...this.skillToolPool.values()], context.skillConfigs ?? []))
      const promptWithMcpResults = await this.executeForceCallMcps(systemPrompt, context.mcpConfigs ?? [], content)
      const promptWithForcedResults = await this.executeForceCallSkills(promptWithMcpResults, context.skillConfigs ?? [], content, context.id, chatKey)

      if (streamingMode === 'progressive') {
        await this.handleProgressive(chatId, chatKey, content, session.messages, promptWithForcedResults, tools, frame)
      } else if (streamingMode === 'typewriter') {
        await this.handleTypewriter(chatId, chatKey, content, session.messages, promptWithForcedResults, tools, frame)
      } else {
        await this.handleNone(chatId, chatKey, content, session.messages, promptWithForcedResults, tools)
      }
    })
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
      audit: (record: Parameters<typeof SkillAuditRepository.create>[0]) => SkillAuditRepository.create(record),
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

  private async executeForceCallMcps(
    systemPrompt: string,
    mcpConfigs: McpConfig[],
    content: string | IncomingContent[]
  ): Promise<string> {
    const results: string[] = []
    const query = typeof content === 'string'
      ? content
      : content.map((item) => (item.type === 'text' ? item.text : `[图片: ${item.url}]`)).join('\n')

    for (const cfg of mcpConfigs) {
      if (!cfg.enabled || !cfg.forceCall) continue
      const serverTools = this.toolPool.get(cfg.mcpServerId)
      if (!serverTools?.length) continue

      for (const tool of serverTools) {
        try {
          const output = await tool.invoke({ query })
          results.push(`[${tool.name}]\n${typeof output === 'string' ? output : JSON.stringify(output)}`)
        } catch (err) {
          console.error(`[BotInstance:${this.deps.bot.id}] Force-call MCP failed: ${tool.name}`, err)
        }
      }
    }

    if (results.length === 0) return systemPrompt
    return `${systemPrompt}\n\n# 强制检索结果\n\n${results.join('\n\n')}`
  }

  private async executeForceCallSkills(
    systemPrompt: string,
    skillConfigs: SkillConfig[],
    content: string | IncomingContent[],
    contextId: string,
    chatKey: string
  ): Promise<string> {
    const results: string[] = []
    const query = typeof content === 'string'
      ? content
      : content.map((item) => (item.type === 'text' ? item.text : `[image: ${item.url}]`)).join('\n')

    for (const cfg of skillConfigs) {
      if (!cfg.enabled || !cfg.forceCall) continue
      const skill = this.skillToolPool.get(cfg.skillId)
      if (!skill?.enabled || skill.type !== 'script') continue
      const output = await executeScriptSkill({
        skill,
        config: cfg,
        input: { query },
        context: this.createSkillRuntimeContext(contextId, chatKey, content),
      })
      results.push(`[${skill.name}]\n${output}`)
    }

    if (results.length === 0) return systemPrompt
    return `${systemPrompt}\n\n# Forced Skill Results\n\n${results.join('\n\n')}`
  }

  private async handleNone(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[]
  ): Promise<void> {
    await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
    try {
      const response = safeReply(await this.engine!.invokeWithTools(sessionMessages, content, systemPrompt, tools))
      await this.saveMessages(chatKey, content, response)
      await this.adapter.sendMessage(chatId, response).catch(() => {})
    } catch (err: any) {
      // Vision fallback: if LLM rejects multimodal input (400/422), retry with text-only degradation
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response)
          await this.adapter.sendMessage(chatId, response).catch(() => {})
          return
        } catch {
          // fall through to generic error
        }
      }
      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.adapter.sendMessage(chatId, '处理消息时发生错误，请稍后重试。').catch(() => {})
    }
  }

  private async handleProgressive(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[],
    frame?: any
  ): Promise<void> {
    let streamId: string | undefined
    if (frame) {
      try {
        streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE)
      } catch {
        streamId = undefined
      }
    }

    if (!streamId) {
      await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
    }

    try {
      const response = await this.engine!.invokeWithTools(sessionMessages, content, systemPrompt, tools)
      await this.saveMessages(chatKey, content, response)

      if (streamId) {
        try {
          await this.adapter.editMessage(chatId, streamId, response, true)
          return
        } catch {
          // fallback
        }
      }
      await this.adapter.sendMessage(chatId, response).catch(() => {})
    } catch (err: any) {
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response)

          if (streamId) {
            await this.adapter.editMessage(chatId, streamId, response, true).catch(async () => {
              await this.adapter.sendMessage(chatId, response).catch(() => {})
            })
            return
          }

          await this.adapter.sendMessage(chatId, response).catch(() => {})
          return
        } catch {
          // fall through to generic error
        }
      }

      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.adapter.sendMessage(chatId, '处理消息时发生错误，请稍后重试。').catch(() => {})
    }
  }

  private async handleTypewriter(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    sessionMessages: any[],
    systemPrompt: string,
    tools: StructuredTool[],
    frame?: any
  ): Promise<void> {
    if (!frame) {
      await this.handleNone(chatId, chatKey, content, sessionMessages, systemPrompt, tools)
      return
    }

    let streamId: string | undefined
    try {
      streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE)
    } catch {
      streamId = undefined
    }

    if (!streamId) {
      await this.handleNone(chatId, chatKey, content, sessionMessages, systemPrompt, tools)
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
      }))

      await this.saveMessages(chatKey, content, finalResponse)
      await this.adapter.editMessage(chatId, streamId, finalResponse, true).catch(async () => {
        await this.adapter.sendMessage(chatId, finalResponse).catch(() => {})
      })
    } catch (err: any) {
      if (Array.isArray(content) && isVisionFallbackError(err)) {
        const status = err?.response?.status ?? err?.status
        console.warn(`[BotInstance:${this.deps.bot.id}] Vision error ${status}, retrying with text degradation`)
        try {
          const response = await invokeVisionFallback(this.engine!, sessionMessages, content, systemPrompt, tools)
          await this.saveMessages(chatKey, degradeVisionContent(content), response)
          await this.adapter.editMessage(chatId, streamId, response, true).catch(async () => {
            await this.adapter.sendMessage(chatId, response).catch(() => {})
          })
          return
        } catch {
          // fall through to generic error
        }
      }

      console.error(`[BotInstance:${this.deps.bot.id}] Agent error:`, err)
      await this.adapter.editMessage(chatId, streamId, '处理消息时发生错误，请稍后重试。', true).catch(async () => {
        await this.adapter.sendMessage(chatId, '处理消息时发生错误，请稍后重试。').catch(() => {})
      })
    }
  }

  private async handleDify(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    conversationId: string | null,
    streamId?: string
  ): Promise<void> {
    if (!streamId) await this.adapter.sendMessage(chatId, THINKING_MESSAGE).catch(() => {})
    try {
      const result = await this.difyClient!.chat(content, conversationId, chatKey)
      const answer = safeReply(result.answer)
      await this.sessions.setDifyConversationId(chatKey, result.conversationId)
      if (streamId) {
        await this.adapter.editMessage(chatId, streamId, answer, true).catch(async () => {
          await this.adapter.sendMessage(chatId, answer).catch(() => {})
        })
      } else {
        await this.adapter.sendMessage(chatId, answer).catch(() => {})
      }
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Dify error:`, err)
      if (streamId) {
        await this.adapter.editMessage(chatId, streamId, '处理消息时发生错误，请稍后重试。', true).catch(async () => {
          await this.adapter.sendMessage(chatId, '处理消息时发生错误，请稍后重试。').catch(() => {})
        })
      } else {
        await this.adapter.sendMessage(chatId, '处理消息时发生错误，请稍后重试。').catch(() => {})
      }
    }
  }

  private async handleDifyStreaming(
    chatId: string,
    chatKey: string,
    content: string | IncomingContent[],
    conversationId: string | null,
    frame?: any
  ): Promise<void> {
    if (!frame) {
      await this.handleDify(chatId, chatKey, content, conversationId)
      return
    }

    let streamId: string | undefined
    try {
      streamId = await this.adapter.sendThinkingWithStream(frame, THINKING_MESSAGE)
    } catch {
      streamId = undefined
    }

    if (!streamId) {
      await this.handleDify(chatId, chatKey, content, conversationId)
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
      await this.adapter.editMessage(chatId, streamId, answer, true).catch(async () => {
        await this.adapter.sendMessage(chatId, answer).catch(() => {})
      })
    } catch (err) {
      console.error(`[BotInstance:${this.deps.bot.id}] Dify streaming error:`, err)
      if (streamStarted) {
        await this.adapter.editMessage(chatId, streamId, `${accumulated}\n\n处理消息时发生错误，请稍后重试。`, true).catch(() => {})
        return
      }
      await this.adapter.editMessage(chatId, streamId, '流式连接失败，正在切换为普通回复...', false).catch(() => {})
      await this.handleDify(chatId, chatKey, content, conversationId, streamId)
    }
  }

  private async saveMessages(chatKey: string, content: string | IncomingContent[], response: string): Promise<void> {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    await this.sessions.addMessage(chatKey, { role: 'human', content: contentStr, timestamp: Date.now() })
    await this.sessions.addMessage(chatKey, { role: 'ai', content: response, timestamp: Date.now() })
  }

  private getOrCreateQueue(chatKey: string): MessageQueue {
    if (!this.queues.has(chatKey)) {
      this.queues.set(chatKey, new MessageQueue())
    }
    return this.queues.get(chatKey)!
  }
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
