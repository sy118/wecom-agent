import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { createAgent } from 'langchain'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { StructuredTool } from '@langchain/core/tools'
import type { LlmConfig, SessionMessage, IncomingContent } from '@wecom-platform/types'

type AgentResponse = { messages?: BaseMessage[] }

export class RecursionLimitError extends Error {
  constructor(public readonly summary: string) {
    super('GRAPH_RECURSION_LIMIT')
    this.name = 'RecursionLimitError'
  }
}

export class AgentTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Agent invoke timed out after ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'AgentTimeoutError'
  }
}

export interface AgentEngineConfig {
  llm: LlmConfig
  systemPrompt: string
  timeoutMs?: number
  recursionLimit?: number
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_TOOL_TIMEOUT_MS = 180_000
const DEFAULT_RECURSION_LIMIT = 50
const EMPTY_RESPONSE_FALLBACK = '抱歉，我暂时无法生成有效回复，请稍后重试。'
const TIMEOUT_RESPONSE_FALLBACK = '本次检索耗时较长，已达到处理时间上限。请缩小查询范围后重试，或稍后继续检索。'
const MAX_TOOL_ERROR_MESSAGE_LENGTH = 800

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new AgentTimeoutError(ms))
        }, ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function withToolTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parentSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const abortFromParent = () => controller.abort()
  if (parentSignal?.aborted) controller.abort()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort()
          reject(new Error(`${label} timed out after ${ms}ms`))
        }, ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function configuredPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sanitizeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_TOOL_ERROR_MESSAGE_LENGTH)
}

function toolFailureOutput(toolName: string, err: unknown, failureCount: number): string {
  const message = sanitizeErrorMessage(err) || 'unknown error'
  const retryHint = failureCount > 1
    ? `同一个工具已经失败 ${failureCount} 次，请不要继续重复调用。`
    : '请不要重复调用同一个失败工具。'
  return [
    `[工具调用失败: ${toolName}] ${message}`,
    `${retryHint}请直接向用户说明当前工具不可用、查询超时或建议缩小查询范围。`,
  ].join('\n')
}

function wrapToolsForAgent(tools: StructuredTool[], timeoutMs: number): StructuredTool[] {
  const failureCounts = new Map<string, number>()

  return tools.map((tool) => {
    const safeInvoke = async (input: unknown, config?: Record<string, unknown>) => {
      try {
        return await withToolTimeout(
          (signal) => (tool.invoke as any).call(tool, input, { ...(config ?? {}), signal }),
          timeoutMs,
          `Tool ${tool.name}`,
          config?.signal as AbortSignal | undefined
        )
      } catch (err) {
        const failureCount = (failureCounts.get(tool.name) ?? 0) + 1
        failureCounts.set(tool.name, failureCount)
        const output = toolFailureOutput(tool.name, err, failureCount)
        console.warn(`[AgentEngine] ${output}`)
        return output
      }
    }

    return new Proxy(tool as any, {
      get(target, prop, receiver) {
        if (prop === 'invoke' || prop === 'call') return safeInvoke
        return Reflect.get(target, prop, receiver)
      },
    }) as StructuredTool
  })
}

export interface AgentProgressCallbacks {
  onToolStart?: () => void | Promise<void>
  onToolEnd?: () => void | Promise<void>
  onOrganizing?: () => void | Promise<void>
}

export interface StreamCallbacks extends AgentProgressCallbacks {
  onToken: (token: string) => void | Promise<void>
}

function extractTextContent(content: unknown): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c?.type === 'text')
      .map((c: any) => c.text as string)
      .join('')
  }
  return String(content)
}

function extractLastNonEmptyAiText(messages: BaseMessage[] | undefined): string {
  const msgs = messages ?? []
  // Find the last contiguous run of AI messages (handles streaming chunks)
  let end = msgs.length - 1
  while (end >= 0 && !AIMessage.isInstance(msgs[end])) end--
  if (end < 0) return ''

  let start = end
  while (start > 0 && AIMessage.isInstance(msgs[start - 1])) start--

  return msgs
    .slice(start, end + 1)
    .map((m) => extractTextContent(m.content))
    .join('')
    .trim()
}

function messageType(message: BaseMessage): string {
  return typeof (message as any)._getType === 'function' ? (message as any)._getType() : message.constructor.name
}

function logMessageStructure(scope: string, messages: BaseMessage[] | undefined): void {
  console.log(`[AgentEngine] ${scope} messages=${messages?.length ?? 0}`)
  for (const [index, message] of (messages ?? []).entries()) {
    const contentText = extractTextContent(message.content)
    const toolCalls = (message as any).tool_calls?.length ?? 0
    console.log(`[AgentEngine] ${scope}[${index}] type=${messageType(message)} textLength=${contentText.length} toolCalls=${toolCalls}`)
  }
}

function isGraphRecursionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message.includes('GRAPH_RECURSION_LIMIT') || message.toLowerCase().includes('recursion limit')
}

function safeResponse(text: string): string {
  const trimmed = text.trim()
  if (trimmed) return trimmed
  console.warn('[AgentEngine] Result extraction empty; using fallback response')
  return EMPTY_RESPONSE_FALLBACK
}

function withCollectedFallback(history: BaseMessage[], collectedMessages: BaseMessage[]): AgentResponse {
  return { messages: collectedMessages.length > 0 ? collectedMessages : history }
}

function createTimeoutResponse(messages: BaseMessage[] | undefined): string {
  const partial = extractLastNonEmptyAiText(messages)
  if (!partial) return TIMEOUT_RESPONSE_FALLBACK
  return `${partial}\n\n本次检索已达到处理时间上限，以上为当前阶段性结果。你可以缩小查询范围后继续检索。`
}

function createToolLogHandler(callbacks: AgentProgressCallbacks = {}): BaseCallbackHandler {
  return new (class extends BaseCallbackHandler {
    name = 'tool-log-handler'
    async handleToolStart(tool: any, input: string) {
      console.log(`[AgentEngine] Tool call start: name=${tool?.name ?? 'unknown'} input=${input}`)
      await callbacks.onToolStart?.()
    }
    async handleToolEnd(output: string) {
      const preview = output.length > 100 ? output.slice(0, 100) + '...' : output
      console.log(`[AgentEngine] Tool call end: ${preview}`)
      await callbacks.onToolEnd?.()
      await callbacks.onOrganizing?.()
    }
    async handleToolError(err: Error) {
      console.error(`[AgentEngine] Tool call error:`, err.message)
      await callbacks.onToolEnd?.()
      await callbacks.onOrganizing?.()
    }
  })()
}

function buildHumanMessage(content: string | IncomingContent[]): HumanMessage {
  if (typeof content === 'string') return new HumanMessage(content)
  return new HumanMessage({
    content: content.map((c) =>
      c.type === 'text'
        ? { type: 'text' as const, text: c.text }
        : { type: 'image_url' as const, image_url: { url: c.url } }
    ),
  })
}

export function __testConfiguredPositiveInt(envKey: string, fallback: number): number {
  return configuredPositiveInt(envKey, fallback)
}

export function __testCreateTimeoutResponse(messages: BaseMessage[] | undefined): string {
  return createTimeoutResponse(messages)
}

export function __testExtractLastNonEmptyAiText(messages: BaseMessage[] | undefined): string {
  return extractLastNonEmptyAiText(messages)
}

export function __testWithCollectedFallback(history: BaseMessage[], collectedMessages: BaseMessage[]): AgentResponse {
  return withCollectedFallback(history, collectedMessages)
}

export function __testWrapToolsForAgent(tools: StructuredTool[], timeoutMs: number): StructuredTool[] {
  return wrapToolsForAgent(tools, timeoutMs)
}

export class AgentEngine {
  private model: InstanceType<typeof ChatOpenAI> | InstanceType<typeof ChatAnthropic> | null = null
  private config: AgentEngineConfig

  constructor(config: AgentEngineConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    const { llm } = this.config
    if (llm.provider === 'anthropic') {
      this.model = new ChatAnthropic({
        modelName: llm.model,
        apiKey: llm.apiKey,
        anthropicApiUrl: llm.baseUrl || undefined,
        temperature: 0,
        streaming: true,
      })
    } else {
      this.model = new ChatOpenAI({
        modelName: llm.model,
        apiKey: llm.apiKey,
        configuration: { baseURL: llm.baseUrl },
        temperature: 0,
        streaming: true,
      })
    }
  }

  private runtimeOptions() {
    return { recursionLimit: this.config.recursionLimit ?? DEFAULT_RECURSION_LIMIT }
  }

  private async summarizePartialResult(messages: BaseMessage[] | undefined, systemPrompt: string): Promise<string> {
    const partial = extractLastNonEmptyAiText(messages)
    if (partial) return partial
    if (!this.model) return EMPTY_RESPONSE_FALLBACK
    const summaryPrompt = '工具调用达到递归限制。请基于目前可见的对话内容，给出一个简短、诚实的阶段性回复；如果信息不足，请说明需要稍后重试。'
    const response = await this.model.invoke([
      new HumanMessage(`${systemPrompt}\n\n${summaryPrompt}`),
      new HumanMessage((messages ?? []).map((message) => `${messageType(message)}: ${extractTextContent(message.content)}`).join('\n')),
    ])
    return safeResponse(extractTextContent(response.content))
  }

  private createAgentWithTools(tools: StructuredTool[], systemPrompt: string) {
    if (!this.model) throw new Error('AgentEngine not initialized')
    const toolTimeoutMs = configuredPositiveInt('AGENT_TOOL_TIMEOUT_MS', DEFAULT_TOOL_TIMEOUT_MS)
    const safeTools = wrapToolsForAgent(tools, toolTimeoutMs)
    const toolFailurePolicy = tools.length > 0
      ? '\n\n## 工具调用失败处理\n当工具返回“[工具调用失败: ...]”时，停止重复调用同一个工具，直接向用户说明失败原因，并给出可执行的下一步建议。'
      : ''
    return createAgent({ model: this.model, tools: safeTools, systemPrompt: `${systemPrompt}${toolFailurePolicy}` })
  }

  async invokeWithTools(
    sessionMessages: SessionMessage[],
    newContent: string | IncomingContent[],
    systemPrompt: string,
    tools: StructuredTool[],
    callbacks: AgentProgressCallbacks = {}
  ): Promise<string> {
    const agent = this.createAgentWithTools(tools, systemPrompt)
    const history = this.buildHistory(sessionMessages, newContent)
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS

    console.log(`[AgentEngine] invokeWithTools: tools=${tools.length}, history=${history.length}`)
    if (tools.length === 0) console.log('[AgentEngine] No tools available; LLM cannot start tool calls')

    const collectedMessages: BaseMessage[] = []
    const logHandler = createToolLogHandler(callbacks)

    try {
      await withTimeout(
        async (signal) => {
          const stream = await agent.stream(
            { messages: history },
            { streamMode: 'messages', callbacks: [logHandler], ...this.runtimeOptions(), signal } as any
          ) as unknown as AsyncIterable<[unknown]> & { return?: () => Promise<unknown> }
          try {
            for await (const [msg] of stream) {
              if (signal.aborted) break
              if (msg) collectedMessages.push(msg as BaseMessage)
            }
          } finally {
            await (stream as any).return?.().catch?.(() => {})
          }
        },
        timeoutMs
      )
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        const messages = collectedMessages.length > 0 ? collectedMessages : history
        const response = createTimeoutResponse(messages)
        console.warn(`[AgentEngine] Agent timed out after ${timeoutMs}ms; returning partial response`)
        return response
      }
      if (!isGraphRecursionError(err)) throw err
      console.warn('[AgentEngine] Graph recursion limit reached; summarizing partial messages')
      const messages = collectedMessages.length > 0 ? collectedMessages : history
      logMessageStructure('invokeWithTools', messages)
      const summary = await this.summarizePartialResult(messages, systemPrompt)
      console.log(`[AgentEngine] invokeWithTools result (first 200): ${summary.slice(0, 200)}`)
      throw new RecursionLimitError(summary)
    }

    const messages = collectedMessages.length > 0 ? collectedMessages : history
    logMessageStructure('invokeWithTools', messages)
    const result = extractLastNonEmptyAiText(messages)
    console.log(`[AgentEngine] invokeWithTools result (first 200): ${result.slice(0, 200)}`)
    return result ? result : await this.summarizePartialResult(messages, systemPrompt)
  }

  async invokeWithPrompt(
    sessionMessages: SessionMessage[],
    newContent: string | IncomingContent[],
    systemPrompt: string
  ): Promise<string> {
    return this.invokeWithTools(sessionMessages, newContent, systemPrompt, [])
  }

  async invoke(sessionMessages: SessionMessage[], newContent: string | IncomingContent[]): Promise<string> {
    return this.invokeWithPrompt(sessionMessages, newContent, this.config.systemPrompt)
  }

  async invokeWithStream(
    sessionMessages: SessionMessage[],
    newContent: string | IncomingContent[],
    systemPrompt: string,
    tools: StructuredTool[],
    callbacks: StreamCallbacks
  ): Promise<string> {
    const agent = this.createAgentWithTools(tools, systemPrompt)
    let accumulated = ''

    const handler = new (class extends BaseCallbackHandler {
      name = 'stream-handler'
      async handleLLMNewToken(token: string) {
        accumulated += token
        await callbacks.onToken(token)
      }
      async handleToolStart(tool: any, input: string) {
        console.log(`[AgentEngine] Tool call start: name=${tool?.name ?? 'unknown'} input=${input}`)
        await callbacks.onToolStart?.()
      }
      async handleToolEnd(output: string) {
        const preview = output.length > 100 ? output.slice(0, 100) + '...' : output
        console.log(`[AgentEngine] Tool call end: ${preview}`)
        await callbacks.onToolEnd?.()
        await callbacks.onOrganizing?.()
      }
      async handleToolError(err: Error) {
        console.error(`[AgentEngine] Tool call error:`, err.message)
        await callbacks.onToolEnd?.()
        await callbacks.onOrganizing?.()
      }
    })()

    const history = this.buildHistory(sessionMessages, newContent)
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const collectedMessages: BaseMessage[] = []

    try {
      await withTimeout(
        async (signal) => {
          const stream = await agent.stream(
            { messages: history },
            { streamMode: 'messages', callbacks: [handler], ...this.runtimeOptions(), signal } as any
          ) as unknown as AsyncIterable<[unknown]> & { return?: () => Promise<unknown> }
          try {
            for await (const [msg] of stream) {
              if (signal.aborted) break
              if (msg) collectedMessages.push(msg as BaseMessage)
            }
          } finally {
            await (stream as any).return?.().catch?.(() => {})
          }
        },
        timeoutMs
      )
    } catch (err) {
      if (err instanceof AgentTimeoutError) {
        const messages = collectedMessages.length > 0 ? collectedMessages : history
        const response = accumulated.trim() || createTimeoutResponse(messages)
        console.warn(`[AgentEngine] Agent stream timed out after ${timeoutMs}ms; returning partial response`)
        return response
      }
      if (!isGraphRecursionError(err)) throw err
      console.warn('[AgentEngine] Graph recursion limit reached during stream; summarizing partial messages')
      const messages = collectedMessages.length > 0 ? collectedMessages : history
      logMessageStructure('invokeWithStream', messages)
      const result = extractLastNonEmptyAiText(messages)
      const summary = result ? result : await this.summarizePartialResult(messages, systemPrompt)
      throw new RecursionLimitError(accumulated.trim() || summary)
    }

    if (accumulated.trim()) return accumulated.trim()
    const messages = collectedMessages.length > 0 ? collectedMessages : history
    logMessageStructure('invokeWithStream', messages)
    const result = extractLastNonEmptyAiText(messages)
    return result ? result : await this.summarizePartialResult(messages, systemPrompt)
  }

  private buildHistory(sessionMessages: SessionMessage[], newContent: string | IncomingContent[]): BaseMessage[] {
    const history: BaseMessage[] = sessionMessages.map((m) =>
      m.role === 'human' ? buildHumanMessage(m.content) : new AIMessage(typeof m.content === 'string' ? m.content : '')
    )
    history.push(buildHumanMessage(newContent))
    return history
  }
}

