import { randomUUID, createDecipheriv } from 'crypto'
import { WSClient, MessageType } from '@wecom/aibot-node-sdk'
import type { IMAdapter, IncomingMessage, IncomingContent, IncomingEvent, IMMediaFile, WecomMediaType, WecomMediaKind } from '@wecom-platform/types'

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
  if (!image.aeskey) return [{ type: 'image', url: image.url }]
  try {
    return [{ type: 'image', url: await decryptImageToDataUrl(image.url, image.aeskey) }]
  } catch (err) {
    console.error('[WecomAdapter] Image decrypt failed:', err)
    return [{ type: 'text', text: '[图片解密失败]' }]
  }
}

export interface WecomMediaPersistInput {
  url: string
  aeskey?: string
  kind: WecomMediaKind
  sourceMessageId?: string | null
}

export interface WecomMediaPersistResult {
  mediaId: string
  dataUrl: string | null
}

export type WecomMediaPersistHandler = (input: WecomMediaPersistInput) => Promise<WecomMediaPersistResult | null>

function mergePersistedAndVision(persisted: IncomingContent[], vision: IncomingContent[]): IncomingContent[] {
  // persisted 已带 data URL（image 项）时避免与 vision 重复；否则两者都保留：
  // 持久化媒体引用供历史回看，vision data URL 供模型即时视觉上下文。
  return persisted.some((item) => item.type === 'image') ? persisted : [...persisted, ...vision]
}

async function persistMediaContent(
  input: WecomMediaPersistInput,
  visionEnabled: boolean,
  persist?: WecomMediaPersistHandler | null
): Promise<IncomingContent[]> {
  if (!persist) return []
  try {
    const result = await persist(input)
    if (!result) return []
    const items: IncomingContent[] = [{ type: 'media', mediaId: result.mediaId, kind: input.kind }]
    if (visionEnabled && result.dataUrl) {
      items.unshift({ type: 'image', url: result.dataUrl })
    }
    return items
  } catch (err) {
    console.error('[WecomAdapter] Media persist failed:', err)
    return []
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
  if (key.length !== 32) throw new Error(`Invalid WeCom image aeskey length: ${key.length}`)
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)
  const decrypted = stripWecomPadding(Buffer.concat([decipher.update(encrypted), decipher.final()]))
  return `data:image/jpeg;base64,${decrypted.toString('base64')}`
}

export async function decryptWecomImage(url: string, aeskey: string): Promise<string> {
  return decryptImageToDataUrl(url, aeskey)
}

function stripWecomPadding(buffer: Buffer): Buffer {
  if (buffer.length === 0) throw new Error('Invalid WeCom image payload: empty decrypted buffer')

  const padLength = buffer[buffer.length - 1]
  if (padLength < 1 || padLength > 32 || padLength > buffer.length) {
    throw new Error(`Invalid WeCom image padding: ${padLength}`)
  }

  for (let i = buffer.length - padLength; i < buffer.length; i++) {
    if (buffer[i] !== padLength) throw new Error('Invalid WeCom image padding bytes')
  }

  return buffer.subarray(0, buffer.length - padLength)
}

export class WecomAdapter implements IMAdapter {
  private client: WSClient
  private messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null
  private eventHandler: ((event: IncomingEvent) => Promise<void>) | null = null
  private mediaPersistHandler: WecomMediaPersistHandler | null = null
  private stopped = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnecting = false
  private listenersAttached = false
  private processedEventIds = new Set<string>()
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

  onEvent(handler: (event: IncomingEvent) => Promise<void>): void {
    this.eventHandler = handler
  }

  onMediaPersist(handler: WecomMediaPersistHandler): void {
    this.mediaPersistHandler = handler
  }

  isReconnecting(): boolean {
    return this.reconnecting
  }

  async sendMessage(chatId: string, text: string): Promise<void | string> {
    await this.client.sendMessage(chatId, { msgtype: 'markdown', markdown: { content: text } })
  }

  async sendTemplateCard(chatId: string, templateCard: Record<string, any>): Promise<void | string> {
    await this.client.sendMessage(chatId, { msgtype: 'template_card', template_card: templateCard } as any)
  }

  async sendMediaMessage(chatId: string, mediaType: WecomMediaType, file: IMMediaFile): Promise<void | string> {
    const upload = await this.client.uploadMedia(Buffer.from(file.bytes), {
      type: mediaType,
      filename: file.filename,
    })
    await this.client.sendMediaMessage(chatId, mediaType as any, upload.media_id)
  }

  async updateTemplateCard(event: IncomingEvent, templateCard: Record<string, any>, userIds?: string[]): Promise<void | string> {
    const frame = (event.rawBody as any)?._frame
    if (!frame) throw new Error('WecomAdapter: template card update requires the original event frame')
    await this.client.updateTemplateCard(frame, templateCard as any, userIds)
  }

  /**
   * Send a stream-capable thinking message. Returns a streamId that can be used
   * with editMessage to update the message content via WeCom stream protocol.
   * Requires the original frame — only usable from within a message handler context.
   */
  async sendThinkingWithStream(frame: any, text: string, feedbackId?: string | null): Promise<string> {
    const streamId = randomUUID()
    await this.client.replyStream(frame, streamId, text, false, undefined, feedbackId ? { id: feedbackId } : undefined)
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

  /**
   * Detect whether the SDK supports staged passive replies
   * (placeholder with finish=false, final result with finish=true).
   * @wecom/aibot-node-sdk exposes replyStream(frame, streamId, text, finish) — verified by SDK spike.
   */
  supportsPassiveReply(): boolean {
    return typeof (this.client as any)?.replyStream === 'function'
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
      if (frame?.body?.msgtype === 'event') {
        if (frame?.body?.event?.eventtype === 'disconnected_event') {
          handleDisconnectedEvent()
        }
        await this.handleEventFrame(frame)
        return
      }

      if (!this.messageHandler) return
      const msg = await this.parseFrame(frame)
      if (msg) await this.messageHandler(msg)
    })

    this.client.on('event', async (frame: any) => {
      if (frame?.body?.event?.eventtype === 'disconnected_event') {
        handleDisconnectedEvent()
      }
      await this.handleEventFrame(frame)
    })

    this.client.on('event.disconnected_event', async (frame: any) => {
      handleDisconnectedEvent()
      await this.handleEventFrame(frame)
    })

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

  async __testParseEventFrame(frame: any): Promise<IncomingEvent | null> {
    return this.parseEventFrame(frame)
  }

  private async handleEventFrame(frame: any): Promise<void> {
    if (!this.eventHandler) return
    const event = await this.parseEventFrame(frame)
    if (!event) return
    if (this.processedEventIds.has(event.msgId)) return
    this.processedEventIds.add(event.msgId)
    if (this.processedEventIds.size > 1000) {
      const first = this.processedEventIds.values().next().value
      if (first) this.processedEventIds.delete(first)
    }
    await this.eventHandler(event)
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

  private async parseEventFrame(frame: any): Promise<IncomingEvent | null> {
    const { body } = frame
    const event = parseWecomEventBody(body)
    return event ? { ...event, rawBody: { ...body, _frame: frame } } : null
  }

  private async parseQuote(quote: QuoteBody | undefined, chatType: 'single' | 'group'): Promise<IncomingContent[]> {
    if (!quote?.msgtype) return []
    if (quote.msgtype === MessageType.Text || quote.msgtype === 'text') {
      const text = quote.text?.content
      return text ? [{ type: 'text', text: `> 引用消息:\n${chatType === 'group' ? text.replace(AT_PREFIX_RE, '') : text}` }] : []
    }
    if (quote.msgtype === MessageType.Image || quote.msgtype === 'image') {
      const persisted = quote.image?.url
        ? await persistMediaContent(
            { url: quote.image.url, aeskey: quote.image.aeskey, kind: 'image', sourceMessageId: null },
            Boolean(this.credentials.visionEnabled),
            this.mediaPersistHandler
          )
        : []
      const vision = await quoteImageContent(quote.image, Boolean(this.credentials.visionEnabled))
      return [
        { type: 'text', text: '> 引用消息:\n[引用图片]' },
        ...mergePersistedAndVision(persisted, vision),
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

  private async persistFromBody(body: any, url: string, aeskey: string | undefined, kind: WecomMediaKind): Promise<IncomingContent[]> {
    return persistMediaContent(
      { url, aeskey, kind, sourceMessageId: body?.msgid ? String(body.msgid) : null },
      Boolean(this.credentials.visionEnabled),
      this.mediaPersistHandler
    )
  }

  private async parseContentWithoutQuote(body: any, chatType: 'single' | 'group'): Promise<string | IncomingContent[]> {
    switch (body.msgtype) {
      case MessageType.Text: {
        const raw: string = body.text?.content ?? ''
        return chatType === 'group' ? raw.replace(AT_PREFIX_RE, '') : raw
      }

      case MessageType.Image: {
        const persisted = await this.persistFromBody(body, body.image?.url, body.image?.aeskey, 'image')
        const vision = await imageContent(body.image, Boolean(this.credentials.visionEnabled))
        return [
          { type: 'text', text: `[图片]` },
          ...mergePersistedAndVision(persisted, vision),
        ]
      }

      case MessageType.File: {
        const persisted = await this.persistFromBody(body, body.file?.url, body.file?.aeskey, 'file')
        return [
          { type: 'text', text: `[文件]` },
          ...persisted,
        ]
      }

      case MessageType.Video: {
        const persisted = await this.persistFromBody(body, body.video?.url, body.video?.aeskey, 'video')
        return [
          { type: 'text', text: `[视频]` },
          ...persisted,
        ]
      }

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
            const persisted = await this.persistFromBody(body, item.image.url, item.image.aeskey, 'image')
            const vision = await imageContent(item.image, Boolean(this.credentials.visionEnabled))
            items.push(...mergePersistedAndVision(persisted, vision))
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

export function parseWecomEventBody(body: any): IncomingEvent | null {
  if (!body?.msgid || body.msgtype !== 'event') return null
  const eventPayload = body.event && typeof body.event === 'object' ? body.event : {}
  const eventType = String(eventPayload.eventtype ?? body.eventtype ?? 'unknown')
  const chatType: 'single' | 'group' = body.chattype === 'group' ? 'group' : 'single'
  return {
    msgId: String(body.msgid),
    eventType,
    aibotId: body.aibotid ? String(body.aibotid) : null,
    chatId: body.chatid ? String(body.chatid) : body.from?.userid ? String(body.from.userid) : null,
    chatKey: resolveChatKey(body),
    chatType,
    userId: body.from?.userid ? String(body.from.userid) : 'unknown',
    corpid: body.from?.corpid ? String(body.from.corpid) : null,
    responseUrl: body.response_url ? String(body.response_url) : null,
    createTime: body.create_time === undefined || body.create_time === null ? null : Number(body.create_time),
    eventPayload,
    rawBody: body,
  }
}
