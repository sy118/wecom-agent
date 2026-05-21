import type { BotResponseRun, SessionMessage } from '@wecom-platform/types'
import { BotResponseRunRepository } from '../db/bot-response-run-repository.js'
import { WikiRetrievalLogRepository, type WikiRetrievalLog } from '../db/wiki-retrieval-log-repository.js'
import { SessionStore } from '../session-store.js'
import { db } from '../db/client.js'

export interface ResponseRunEvidence {
  responseRun: BotResponseRun
  sessionMessages: SessionMessage[]
  retrievalLogs: WikiRetrievalLog[]
}

export async function getResponseRunEvidenceById(responseRunId: string): Promise<ResponseRunEvidence | null> {
  const responseRun = await BotResponseRunRepository.findById(responseRunId)
  if (!responseRun) return null
  return buildEvidence(responseRun)
}

export async function getResponseRunEvidenceByFeedbackId(feedbackId: string): Promise<ResponseRunEvidence | null> {
  const responseRun = await BotResponseRunRepository.findByFeedbackId(feedbackId)
  if (!responseRun) return null
  return buildEvidence(responseRun)
}

async function buildEvidence(responseRun: BotResponseRun): Promise<ResponseRunEvidence> {
  const sessions = new SessionStore(db, responseRun.botId)
  try {
    const [sessionMessages, retrievalLogs] = await Promise.all([
      sessions.getMessagesByResponseRunId(responseRun.id),
      WikiRetrievalLogRepository.findByResponseRunId(responseRun.id),
    ])
    return { responseRun, sessionMessages, retrievalLogs }
  } finally {
    sessions.destroy()
  }
}
