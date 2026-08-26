export interface DndWindow {
  fromMinutes: number
  toMinutes: number
}

export interface DisturbanceDecision {
  reply: boolean
  reason?: 'mention_only' | 'do_not_disturb' | 'group_throttled'
}

/** 解析 "HH:mm-HH:mm,HH:mm-HH:mm" 格式的免打扰时段。 */
export function parseDndWindows(raw: string | undefined | null): DndWindow[] {
  if (!raw) return []
  const windows: DndWindow[] = []
  for (const part of raw.split(',')) {
    const [from, to] = part.trim().split('-')
    if (!from || !to) continue
    const fromMinutes = minutesOfDay(from)
    const toMinutes = minutesOfDay(to)
    if (fromMinutes === null || toMinutes === null) continue
    windows.push({ fromMinutes, toMinutes })
  }
  return windows
}

export function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function isInDoNotDisturb(now = new Date(), windows: DndWindow[]): boolean {
  const current = now.getHours() * 60 + now.getMinutes()
  return windows.some((w) => {
    if (w.fromMinutes <= w.toMinutes) return current >= w.fromMinutes && current < w.toMinutes
    // 跨零点时段（如 22:00-07:00）
    return current >= w.fromMinutes || current < w.toMinutes
  })
}

/** 群聊点名检测：消息文本包含 @机器人 或机器人名称。 */
export function contentMentionsBot(text: string | undefined, botName: string): boolean {
  if (!text) return false
  const normalized = text.replace(/^\s*/, '')
  if (normalized.startsWith('@')) return true
  const name = botName?.trim()
  if (name && normalized.includes(`@${name}`)) return true
  return false
}

export class GroupThrottleGuard {
  private recentByChat = new Map<string, number[]>()

  constructor(
    private windowMs = Number(process.env.GROUP_THROTTLE_WINDOW_MS ?? 10_000),
    private maxMessages = Number(process.env.GROUP_THROTTLE_MAX_MESSAGES ?? 3)
  ) {}

  /** 返回 true 表示应跳过（节流）；false 表示可回复。 */
  shouldThrottle(chatKey: string, now = Date.now()): boolean {
    const recent = (this.recentByChat.get(chatKey) ?? []).filter((t) => now - t <= this.windowMs)
    if (recent.length >= this.maxMessages) {
      this.recentByChat.set(chatKey, recent)
      return true
    }
    recent.push(now)
    this.recentByChat.set(chatKey, recent)
    return false
  }

  reset(chatKey?: string): void {
    if (chatKey) this.recentByChat.delete(chatKey)
    else this.recentByChat.clear()
  }
}

export function makeDisturbanceDecision(input: {
  chatType: 'single' | 'group'
  rawText: string | undefined
  botName: string
  mentionOnly: boolean
  dndWindows: DndWindow[]
  groupThrottle: GroupThrottleGuard | null
  chatKey: string
}): DisturbanceDecision {
  const mentionOnly = input.mentionOnly && input.chatType === 'group'
  if (mentionOnly && !contentMentionsBot(input.rawText, input.botName)) {
    return { reply: false, reason: 'mention_only' }
  }
  if (isInDoNotDisturb(new Date(), input.dndWindows) && !contentMentionsBot(input.rawText, input.botName)) {
    return { reply: false, reason: 'do_not_disturb' }
  }
  if (input.chatType === 'group' && input.groupThrottle?.shouldThrottle(input.chatKey)) {
    return { reply: false, reason: 'group_throttled' }
  }
  return { reply: true }
}

export function __testMinutesOfDay(time: string): number | null {
  return minutesOfDay(time)
}