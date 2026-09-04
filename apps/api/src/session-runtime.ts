import type { Client } from '@libsql/client'
import type { IncomingContent, Session, SessionMessage } from '@wecom-platform/types'
import { SessionStore } from './session-store.js'

export interface SessionHandle extends Session {
  readonly id: string
}

/** Session lifecycle boundary; persistence details remain in SessionStore. */
export class SessionRuntime {
  private readonly store: SessionStore

  constructor(db: Client, botId: string) {
    this.store = new SessionStore(db, botId)
  }

  open(chatKey: string, contextId: string, ttlMin: number): Promise<SessionHandle> {
    return this.store.getOrCreate(chatKey, contextId, ttlMin)
  }

  getOrCreate(chatKey: string, contextId: string, ttlMin: number): Promise<SessionHandle> {
    return this.open(chatKey, contextId, ttlMin)
  }

  appendMessage(sessionId: string, message: SessionMessage, responseRunId?: string | null): Promise<void> {
    return this.store.addMessage(sessionId, message, responseRunId)
  }

  addMessage(sessionId: string, message: SessionMessage, responseRunId?: string | null): Promise<void> {
    return this.appendMessage(sessionId, message, responseRunId)
  }

  setDifyConversationId(sessionId: string, conversationId: string): Promise<void> {
    return this.store.setDifyConversationId(sessionId, conversationId)
  }

  delete(chatKey: string): Promise<void> {
    return this.store.delete(chatKey)
  }

  getAll(): Promise<Session[]> {
    return this.store.getAll()
  }

  get(chatKey: string): Promise<Session | undefined> {
    return this.store.get(chatKey)
  }

  getMessagesByResponseRunId(responseRunId: string): Promise<SessionMessage[]> {
    return this.store.getMessagesByResponseRunId(responseRunId)
  }

  destroy(): void {
    this.store.destroy()
  }
}
