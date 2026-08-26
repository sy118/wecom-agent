import type { IncomingContent } from '@wecom-platform/types'

export interface DifyConfig {
  baseUrl: string
  apiKey: string
  appId?: string | null
  onStageStart?: (stage: string, meta?: Record<string, any>) => void | Promise<void>
  onStageEnd?: (stage: string, meta?: Record<string, any>) => void | Promise<void>
}

export interface DifyChatResult {
  answer: string
  conversationId: string
}

export interface DifyChatStreamOptions {
  content: string | IncomingContent[]
  conversationId: string | null
  userId: string
  onToken: (token: string) => void | Promise<void>
}

function contentToText(content: string | IncomingContent[]): string {
  if (typeof content === 'string') return content
  return content.map((c) => {
    if (c.type === 'text') return c.text
    if (c.type === 'image') return `[图片: ${c.url}]`
    return c.status === 'expired' ? '[媒体已过期]' : `[${c.kind}]`
  }).join('\n')
}

function contentToFiles(content: string | IncomingContent[]): Array<{ type: string; transfer_method: string; url: string }> {
  if (typeof content === 'string') return []
  return content
    .filter((c): c is { type: 'image'; url: string } => c.type === 'image')
    .map((c) => ({ type: 'image', transfer_method: 'remote_url', url: c.url }))
}

function buildChatBody(
  content: string | IncomingContent[],
  conversationId: string | null,
  userId: string,
  responseMode: 'blocking' | 'streaming'
): Record<string, unknown> {
  const files = contentToFiles(content)
  const body: Record<string, unknown> = {
    inputs: {},
    query: contentToText(content),
    response_mode: responseMode,
    user: userId,
  }
  if (conversationId) body.conversation_id = conversationId
  if (files.length > 0) body.files = files
  return body
}

function parseSseBlock(block: string): { event: string; data: string } {
  const lines = block.split('\n')
  let event = ''
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trim())
  }
  return { event, data: dataLines.join('\n') }
}

export function __testBuildDifyChatBody(
  content: string | IncomingContent[],
  conversationId: string | null,
  userId: string,
  responseMode: 'blocking' | 'streaming'
): Record<string, unknown> {
  return buildChatBody(content, conversationId, userId, responseMode)
}

export function __testParseDifySseBlock(block: string): { event: string; data: string } {
  return parseSseBlock(block)
}

export class DifyClient {
  constructor(private config: DifyConfig) {}

  async chat(
    content: string | IncomingContent[],
    conversationId: string | null,
    userId = 'wecom-user'
  ): Promise<DifyChatResult> {
    await this.config.onStageStart?.('dify', { mode: 'blocking' })
    const body = buildChatBody(content, conversationId, userId, 'blocking')

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/chat-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Dify API error ${res.status}: ${text}`)
      }

      const data = (await res.json()) as { answer: string; conversation_id: string }
      const result = { answer: data.answer, conversationId: data.conversation_id }
      await this.config.onStageEnd?.('dify')
      return result
    } finally {
      clearTimeout(timeout)
    }
  }

  async chatStream(options: DifyChatStreamOptions): Promise<DifyChatResult> {
    await this.config.onStageStart?.('dify', { mode: 'streaming' })
    const body = buildChatBody(options.content, options.conversationId, options.userId, 'streaming')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)

    try {
      const res = await fetch(`${this.config.baseUrl}/v1/chat-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Dify API error ${res.status}: ${text}`)
      }
      if (!res.body) throw new Error('Dify streaming response body is empty')

      let answer = ''
      let conversationId = options.conversationId ?? ''
      let buffer = ''
      const decoder = new TextDecoder()

      for await (const chunk of res.body as any as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (parsed.event !== 'message' || !parsed.data) continue
          const data = JSON.parse(parsed.data) as { answer?: string; conversation_id?: string }
          if (data.conversation_id) conversationId = data.conversation_id
          if (!data.answer) continue
          answer += data.answer
          await options.onToken(data.answer)
        }
      }

      const result = { answer, conversationId }
      await this.config.onStageEnd?.('dify')
      return result
    } finally {
      clearTimeout(timeout)
    }
  }
}
