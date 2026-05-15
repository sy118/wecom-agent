import { randomUUID, createDecipheriv } from 'crypto'
import { WSClient, MessageType } from '@wecom/aibot-node-sdk'
import type { IMAdapter, IncomingMessage, IncomingContent } from '@wecom-platform/types'

export interface WecomCredentials {
  botId: string
  secret: string
  wsUrl: string
  visionEnabled?: boolean
}

const AT_PREFIX_RE = /^@\S+\s*/

interface QuoteBody {
  msgtype?: string
  text?: { content?: string }
  image?: { url?: string; aeskey?: string }
}

async function imageContent(image: { url?: string; aeskey?: string } | undefined, visionEnabled: boolean): Promise<IncomingContent[]> {
  if (!image?.url) return []
  if (!visionEnabled) return [{ type: 'text', text: '[图片]' }]
  if (!image.aeskey) return [{ type: 'image', url: image.url }]
  try {
    return [{ type: 'image', url: await decryptImageToDataUrl(image.url, image.aeskey) }]
  } catch (err) {
    console.error('[WecomAdapter] Image decrypt failed:', err)
    return [{ type: 'text', text: '[图片解密失败]' }]
  }
}

async function quoteImageContent(image: { url?: string; aeskey?: string } | undefined, visionEnabled: boolean): Promise<IncomingContent[]> {
  const imageItems = await imageContent(image, visionEnabled)
  if (!visionEnabled || imageItems.length === 0) return []
  return imageItems[0]?.type === 'text' && imageItems[0].text === '[图片]' ? [] : imageItems
}

async function decryptImageToDataUrl(url: string, aeskey: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`)
  const encrypted = Buffer.from(await res.arrayBuffer())
  const key = Buffer.from(aeskey, 'base64')
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return `data:image/jpeg;base64,${decrypted.toString('base64')}`
}

export async function decryptWecomImage(url: string, aeskey: string): Promise<string> {
  return decryptImageToDataUrl(url, aeskey)
}

export class WecomAdapter implements IMAdapter {
  private client: WSClient
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private stopped = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnecting = false
  private listenersAttached = false
  // streamId → frame mapping for editMessage (stream-based update)
  private pendingFrames = new Map<string, any>()

  constructor(private credentials: WecomCredentials) {
    this.client = new WSClient({
      botId: credentials.botId,
      secret: credentials.secret,
      wsUrl: credentials.wsUrl,
    })
  }

  async start(): Promise<void> {
    this.stopped = false
    this.attachListeners()
    this.client.connect()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.reconnecting = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.client.disconnect?.()
    this.pendingFrames.clear()
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler
  }

  isReconnecting(): boolean {
    return this.reconnecting
  }

  async sendMessage(chatId: string, text: string): Promise<void | string> {
    await this.client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: text } })
  }

  /**
   * Send a stream-capable thinking message. Returns a streamId that can be used
   * with editMessage to update the message content via WeCom stream protocol.
   * Requires the original frame — only usable from within a message handler context.
   */
  async sendThinkingWithStream(frame: any, text: string): Promise<string> {
    const streamId = randomUUID()
    await this.client.replyStream(frame, streamId, text, false)
    this.pendingFrames.set(streamId, frame)
    return streamId
  }

  /**
   * Update a previously sent stream message. streamId must have been returned
   * by sendThinkingWithStream. finish=true closes the stream.
   */
  async editMessage(chatId: string, streamId: string, text: string, finish = true): Promise<void> {
    const frame = this.pendingFrames.get(streamId)
    if (!frame) throw new Error(`WecomAdapter: no pending frame for streamId ${streamId}`)
    try {
      await this.client.replyStream(frame, streamId, text, finish)
    } finally {
      if (finish) this.pendingFrames.delete(streamId)
    }
  }

  async sendStreamChunk(chatId: string, streamId: string, content: string, finish: boolean): Promise<void> {
    await this.client.sendMessage(chatId, {
      cmd: 'aibot_respond_msg',
      body: {
        msgtype: 'stream',
        stream: { id: streamId, finish, content },
      },
    } as any)
  }

  private attachListeners(): void {
    if (this.listenersAttached) return
    this.listenersAttached = true

    const handleDisconnectedEvent = () => {
      console.warn(`[WecomAdapter:${this.credentials.botId}] Received disconnected_event, scheduling reconnect`)
      const jitter = 500 + Math.random() * 1500
      this.scheduleReconnect(jitter)
    }

    this.client.on('message', async (frame: any) => {
      if (frame?.body?.msgtype === 'event' && frame?.body?.event?.eventtype === 'disconnected_event') {
        handleDisconnectedEvent()
        return
      }

      if (!this.messageHandler) return
      const msg = await this.parseFrame(frame)
      if (msg) await this.messageHandler(msg)
    })

    this.client.on('event.disconnected_event', handleDisconnectedEvent)

    this.client.on('connected', () => {
      console.log(`[WecomAdapter:${this.credentials.botId}] Connected`)
      this.reconnecting = false
      this.reconnectAttempts = 0
    })

    this.client.on('disconnected', (reason: string) => {
      console.warn(`[WecomAdapter:${this.credentials.botId}] Disconnected: ${reason}`)
      if (!this.stopped) this.reconnecting = true
    })

    this.client.on('reconnecting', () => {
      if (!this.stopped) this.reconnecting = true
    })

    this.client.on('error', (err: unknown) => {
      console.error(`[WecomAdapter:${this.credentials.botId}] Error:`, err)
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000)
      const jitter = delay * (0.8 + Math.random() * 0.4)
      this.scheduleReconnect(jitter)
    })
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.stopped) return
    this.reconnecting = true
    if (this.reconnectTimer) return

    this.reconnectAttempts++
    console.log(
      `[WecomAdapter:${this.credentials.botId}] Reconnecting in ${Math.round(delayMs)}ms (attempt ${this.reconnectAttempts})`
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      this.client.connect()
    }, delayMs)
  }

  async __testParseFrame(frame: any): Promise<IncomingMessage | null> {
    return this.parseFrame(frame)
  }

  private async parseFrame(frame: any): Promise<IncomingMessage | null> {
    const { body } = frame
    if (!body?.msgid) return null

    const chatId = body.chatid ?? body.from?.userid
    if (!chatId) return null

    const chatType: 'single' | 'group' = body.chattype === 'group' ? 'group' : 'single'
    const chatKey = resolveChatKey(body)
    const userId = body.from?.userid ?? 'unknown'
    const content = await this.parseContent(body, chatType)

    return { chatId, chatKey, chatType, userId, content, rawBody: body, _frame: frame } as any
  }

  private async parseQuote(quote: QuoteBody | undefined, chatType: 'single' | 'group'): Promise<IncomingContent[]> {
    if (!quote?.msgtype) return []
    if (quote.msgtype === MessageType.Text || quote.msgtype === 'text') {
      const text = quote.text?.content
      return text ? [{ type: 'text', text: `> 引用消息:\n${chatType === 'group' ? text.replace(AT_PREFIX_RE, '') : text}` }] : []
    }
    if (quote.msgtype === MessageType.Image || quote.msgtype === 'image') {
      return [
        { type: 'text', text: '> 引用消息:\n[引用图片]' },
        ...await quoteImageContent(quote.image, Boolean(this.credentials.visionEnabled)),
      ]
    }
    return []
  }

  private async withQuote(body: any, chatType: 'single' | 'group', content: string | IncomingContent[]): Promise<string | IncomingContent[]> {
    const quoteItems = await this.parseQuote(body.quote, chatType)
    if (quoteItems.length === 0) return content
    const currentItems: IncomingContent[] = typeof content === 'string'
      ? [{ type: 'text', text: `当前消息:\n${content}` }]
      : content.map((item, index) => index === 0 && item.type === 'text' ? { ...item, text: `当前消息:\n${item.text}` } : item)
    return [...quoteItems, ...currentItems]
  }

  private async parseContent(body: any, chatType: 'single' | 'group'): Promise<string | IncomingContent[]> {
    const content = await this.parseContentWithoutQuote(body, chatType)
    return this.withQuote(body, chatType, content)
  }

  private async parseContentWithoutQuote(body: any, chatType: 'single' | 'group'): Promise<string | IncomingContent[]> {
    switch (body.msgtype) {
      case MessageType.Text: {
        const raw: string = body.text?.content ?? ''
        return chatType === 'group' ? raw.replace(AT_PREFIX_RE, '') : raw
      }

      case MessageType.Image:
        return [
          { type: 'text', text: `[图片]` },
          ...await imageContent(body.image, Boolean(this.credentials.visionEnabled)),
        ]

      case MessageType.Voice: {
        const recognition = body.voice?.recognition ?? ''
        return recognition ? `[语音] ${recognition}` : '[语音消息，未识别到文字]'
      }

      case 'mixed': {
        const items: IncomingContent[] = []
        for (const item of body.mixed?.msg_item ?? []) {
          if (item.msgtype === 'text' && item.text?.content) {
            const text: string = item.text.content
            items.push({ type: 'text', text: chatType === 'group' ? text.replace(AT_PREFIX_RE, '') : text })
          } else if (item.msgtype === 'image' && item.image?.url) {
            items.push(...await imageContent(item.image, Boolean(this.credentials.visionEnabled)))
          }
        }
        return items.length > 0 ? items : '[混合消息]'
      }

      default:
        return `[${body.msgtype ?? '未知'}消息类型]`
    }
  }
}

export function resolveChatKey(body: any): string {
  if (body.chatid) return `wecom:group:${body.chatid}`
  return `wecom:user:${body.from?.userid ?? 'unknown'}`
}
