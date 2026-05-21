import type { ContextConfig, IncomingEvent, WikiFeedbackItem } from '@wecom-platform/types'
import { parseWecomEventBody } from '@wecom-platform/core'
import { WecomEventRepository } from '../db/wecom-event-repository.js'
import { BotResponseRunRepository } from '../db/bot-response-run-repository.js'
import { WikiFeedbackRepository, defaultClassification } from '../db/wiki-feedback-repository.js'
import { WikiRetrievalLogRepository } from '../db/wiki-retrieval-log-repository.js'
import { ContextRepository } from '../db/context-repository.js'

export interface WecomEventProcessResult {
  duplicate: boolean
  eventId: string
  feedbackItem?: WikiFeedbackItem | null
}

export async function handleIncomingWecomEvent(
  event: IncomingEvent,
  options: { botId?: string | null; contexts?: ContextConfig[] } = {}
): Promise<WecomEventProcessResult> {
  const stored = await WecomEventRepository.createFromIncoming(event, options.botId)
  if (stored.duplicate) return { duplicate: true, eventId: stored.event.id }

  try {
    let feedbackItem: WikiFeedbackItem | null = null
    if (event.eventType === 'feedback_event') {
      feedbackItem = await createFeedbackItem(event, stored.event.id, options.contexts)
    }
    await WecomEventRepository.markProcessed(stored.event.id)
    return { duplicate: false, eventId: stored.event.id, feedbackItem }
  } catch (err) {
    await WecomEventRepository.markError(stored.event.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

export function parseIncomingEventPayload(payload: unknown): IncomingEvent | null {
  return parseWecomEventBody(payload)
}

async function createFeedbackItem(
  event: IncomingEvent,
  eventId: string,
  contexts?: ContextConfig[]
): Promise<WikiFeedbackItem> {
  const feedback = extractFeedbackPayload(event.eventPayload)
  const responseRun = feedback.id ? await BotResponseRunRepository.findByFeedbackId(feedback.id) : null
  const context = responseRun?.contextId
    ? contexts?.find((item) => item.id === responseRun.contextId) ?? await ContextRepository.findById(responseRun.contextId)
    : null
  const namespace = context ? firstWikiNamespace(context) : responseRun ? await namespaceFromRetrievalLogs(responseRun.id) : null
  const status = responseRun ? 'new' : 'unlinked'
  return WikiFeedbackRepository.create({
    eventId,
    responseRunId: responseRun?.id ?? null,
    namespace,
    feedbackType: feedback.type,
    content: feedback.content,
    inaccurateReasons: feedback.inaccurateReasons,
    classification: responseRun ? defaultClassification(feedback.type, feedback.inaccurateReasons) : 'unclassified',
    status,
    resolutionNote: responseRun ? null : (feedback.id ? `feedback id not linked: ${feedback.id}` : 'feedback id missing'),
  })
}

function extractFeedbackPayload(eventPayload: Record<string, any>): {
  id: string | null
  type: number | null
  content: string | null
  inaccurateReasons: number[]
} {
  const payload = eventPayload.feedback_event && typeof eventPayload.feedback_event === 'object'
    ? eventPayload.feedback_event
    : eventPayload
  const reasons = Array.isArray(payload.inaccurate_reason_list)
    ? payload.inaccurate_reason_list
    : []
  return {
    id: payload.id ? String(payload.id) : null,
    type: payload.type === undefined || payload.type === null ? null : Number(payload.type),
    content: payload.content ? String(payload.content) : null,
    inaccurateReasons: reasons.map(Number).filter(Number.isFinite),
  }
}

function firstWikiNamespace(context: ContextConfig): string | null {
  for (const cfg of context.mcpConfigs ?? []) {
    if (!cfg.enabled) continue
    const namespace = cfg.params?.namespace
    if (Array.isArray(namespace)) {
      const first = namespace.find((item): item is string => typeof item === 'string' && Boolean(item))
      if (first) return first
    } else if (typeof namespace === 'string' && namespace) {
      return namespace
    }
  }
  return null
}

async function namespaceFromRetrievalLogs(responseRunId: string): Promise<string | null> {
  const logs = await WikiRetrievalLogRepository.findByResponseRunId(responseRunId)
  return logs[0]?.namespace ?? null
}
