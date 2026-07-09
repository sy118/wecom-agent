import type { IncomingEvent } from '@wecom-platform/types'
import { parseWecomEventBody } from '@wecom-platform/core'
import { WecomEventRepository } from '../db/wecom-event-repository.js'

export interface WecomEventProcessResult {
  duplicate: boolean
  eventId: string
}

export async function handleIncomingWecomEvent(
  event: IncomingEvent,
  options: { botId?: string | null } = {}
): Promise<WecomEventProcessResult> {
  const stored = await WecomEventRepository.createFromIncoming(event, options.botId)
  if (stored.duplicate) return { duplicate: true, eventId: stored.event.id }

  try {
    await WecomEventRepository.markProcessed(stored.event.id)
    return { duplicate: false, eventId: stored.event.id }
  } catch (err) {
    await WecomEventRepository.markError(stored.event.id, err instanceof Error ? err.message : String(err))
    throw err
  }
}

export function parseIncomingEventPayload(payload: unknown): IncomingEvent | null {
  return parseWecomEventBody(payload)
}
