import { parseDndWindows, isInDoNotDisturb, contentMentionsBot } from './disturbance-policy.js'

export interface DisturbanceDecisionInput {
  chatType: 'user' | 'group'
  message: string
  botName?: string
  mentioned?: boolean
  now?: number
  quietWindowsRaw?: string
  throttleWindowMs?: number
  throttleMaxMessages?: number
  chatKey?: string
}

export interface DisturbanceDecision {
  shouldReply: boolean
  reason: 'private' | 'mention' | 'quiet_hours' | 'throttled' | 'ok'
  merged?: boolean
}

function configuredNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 防打扰决策：私聊始终回复；群聊支持点名才回、免打扰时段与群消息节流。
 * 节流语义：窗口内第 1 条回复、第 2 条丢弃、第 3 条合并为摘要回复、后续丢弃。
 */
export class DoNotDisturbService {
  private throttleCounts = new Map<string, number[]>()

  decide(input: DisturbanceDecisionInput): DisturbanceDecision {
    if (input.chatType === 'user') return { shouldReply: true, reason: 'private' }

    const mentionOnly = process.env.WECOM_DND_MENTION_ONLY === 'true'
    const mentioned = input.mentioned ?? contentMentionsBot(input.message, input.botName ?? '')
    if (mentionOnly && !mentioned) return { shouldReply: false, reason: 'mention' }

    const windows = parseDndWindows(input.quietWindowsRaw ?? process.env.DO_NOT_DISTURB_WINDOWS)
    if (windows.length > 0 && isInDoNotDisturb(new Date(input.now ?? Date.now()), windows) && !mentioned) {
      return { shouldReply: false, reason: 'quiet_hours' }
    }

    const windowMs = input.throttleWindowMs ?? configuredNumber(process.env.GROUP_THROTTLE_WINDOW_MS, 10_000)
    const maxMessages = input.throttleMaxMessages ?? configuredNumber(process.env.GROUP_THROTTLE_MAX_MESSAGES, 3)
    const key = input.chatKey ?? 'default'
    const now = input.now ?? Date.now()
    const recent = (this.throttleCounts.get(key) ?? []).filter((t) => now - t <= windowMs)
    recent.push(now)
    this.throttleCounts.set(key, recent)
    const count = Math.min(recent.length, maxMessages + 1)
    if (count === 1) return { shouldReply: true, reason: 'ok' }
    if (count === 2) return { shouldReply: false, reason: 'throttled' }
    if (count === 3) return { shouldReply: true, reason: 'ok', merged: true }
    return { shouldReply: false, reason: 'throttled' }
  }

  buildSummary(messages: Array<{ sender?: string; text: string }>): string {
    const senders = [...new Set(messages.map((m) => m.sender).filter((s): s is string => Boolean(s)))]
    const header = `📊 群消息摘要（${messages.length} 条消息${senders.length ? `，来自 ${senders.slice(0, 3).join('、')}` : ''}）`
    const lines = messages.map((m) => (m.sender ? `${m.sender}：${m.text}` : m.text))
    return [header, ...lines].join('\n')
  }
}