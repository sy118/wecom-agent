import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { createAgent } from 'langchain'
import { HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { StructuredTool } from '@langchain/core/tools'
import type { LlmConfig, SessionMessage, IncomingContent } from '@wecom-platform/types'

type AgentResponse = { messages?: BaseMessage[] }

export interface AgentEngineConfig {
  llm: LlmConfig
  systemPrompt: string
  timeoutMs?: number
  recursionLimit?: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_RECURSION_LIMIT = 50
const EMPTY_RESPONSE_FALLBACK = '抱歉，我暂时无法生成有效回复，请稍后重试。'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent invoke timed out after ${ms / 1000}s`)), ms)
    ),
  ])
}

export interface StreamCallbacks {
  onToken: (token: string) => void | Promise<void>
  onToolStart: (toolName: string) => void | Promise<void>
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
  for (const message of [...(messages ?? [])].reverse()) {
    // Use isInstance instead of instanceof: streaming LLMs return AIMessageChunk
    // which is NOT instanceof AIMessage but passes the duck-type isInstance check.
    if (!AIMessage.isInstance(message)) continue
    const text = extractTextContent(message.content).trim()
    if (text) return text
  }
  return ''
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

function extractResponseMessages(response: unknown): BaseMessage[] {
  return Array.isArray((response as AgentResponse | undefined)?.messages) ? (response as AgentResponse).messages! : []
}

function appendResponseMessages(collectedMessages: BaseMessage[], response: unknown): AgentResponse {
  const messages = extractResponseMessages(response)
  collectedMessages.push(...messages)
  return { ...(response as AgentResponse), messages }
}

function withCollectedFallback(history: BaseMessage[], collectedMessages: BaseMessage[]): AgentResponse {
  return { messages: collectedMessages.length > 0 ? collectedMessages : history }
}

function createToolLogHandler(): BaseCallbackHandler {
  return new (class extends BaseCallbackHandler {
    name = 'tool-log-handler'
    handleToolStart(tool: any, input: string) {
      console.log(`[AgentEngine] Tool call start: name=${tool?.name ?? 'unknown'} input=${input}`)
    }
    handleToolEnd(output: string) {
      const preview = output.length > 100 ? output.slice(0, 100) + '...' : output
      console.log(`[AgentEngine] Tool call end: ${preview}`)
    }
    handleToolError(err: Error) {
      console.error(`[AgentEngine] Tool call error:`, err.message)
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

export function __testExtractLastNonEmptyAiText(messages: BaseMessage[] | undefined): string {
  return extractLastNonEmptyAiText(messages)
}

export function __testWithCollectedFallback(history: BaseMessage[], collectedMessages: BaseMessage[]): AgentResponse {
  return withCollectedFallback(history, collectedMessages)
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
    return createAgent({ model: this.model, tools, systemPrompt })
  }

  async invokeWithTools(
    sessionMessages: SessionMessage[],
    newContent: string | IncomingContent[],
    systemPrompt: string,
    tools: StructuredTool[]
  ): Promise<string> {
    const agent = this.createAgentWithTools(tools, systemPrompt)
    const history = this.buildHistory(sessionMessages, newContent)
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS

    console.log(`[AgentEngine] invokeWithTools: tools=${tools.length}, history=${history.length}`)
    if (tools.length === 0) console.log('[AgentEngine] No tools available; LLM cannot start tool calls')

    const collectedMessages: BaseMessage[] = []
    const logHandler = createToolLogHandler()

    const response = await withTimeout(
      agent.invoke({ messages: history }, { callbacks: [logHandler], ...this.runtimeOptions() })
        .then((result) => appendResponseMessages(collectedMessages, result)),
      timeoutMs
    ).catch(async (err) => {
      if (!isGraphRecursionError(err)) throw err
      console.warn('[AgentEngine] Graph recursion limit reached; summarizing partial messages')
      return withCollectedFallback(history, collectedMessages)
    })

    logMessageStructure('invokeWithTools', response.messages)
    const result = extractLastNonEmptyAiText(response.messages)
    console.log(`[AgentEngine] invokeWithTools result (first 200): ${result.slice(0, 200)}`)
    return result ? result : await this.summarizePartialResult(response.messages, systemPrompt)
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
      async handleToolStart(_tool: any, input: string) {
        try {
          const parsed = JSON.parse(input)
          await callbacks.onToolStart(parsed?.name ?? '工具')
        } catch {
          await callbacks.onToolStart('工具')
        }
      }
    })()

    const history = this.buildHistory(sessionMessages, newContent)
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const collectedMessages: BaseMessage[] = []
    const response = await withTimeout(
      agent.invoke({ messages: history }, { callbacks: [handler], ...this.runtimeOptions() })
        .then((result) => appendResponseMessages(collectedMessages, result)),
      timeoutMs
    ).catch(async (err) => {
      if (!isGraphRecursionError(err)) throw err
      console.warn('[AgentEngine] Graph recursion limit reached during stream; summarizing partial messages')
      return withCollectedFallback(history, collectedMessages)
    })

    if (accumulated.trim()) return accumulated.trim()
    logMessageStructure('invokeWithStream', response.messages)
    const result = extractLastNonEmptyAiText(response.messages)
    return result ? result : await this.summarizePartialResult(response.messages, systemPrompt)
  }

  private buildHistory(sessionMessages: SessionMessage[], newContent: string | IncomingContent[]): BaseMessage[] {
    const history: BaseMessage[] = sessionMessages.map((m) =>
      m.role === 'human' ? buildHumanMessage(m.content) : new AIMessage(typeof m.content === 'string' ? m.content : '')
    )
    history.push(buildHumanMessage(newContent))
    return history
  }
}

