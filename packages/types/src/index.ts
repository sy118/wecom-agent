// ─── Bot Configuration ────────────────────────────────────────────────────────

export type BotProvider = 'openai-compatible' | 'anthropic' | 'dify'
export type StreamingMode = 'none' | 'progressive' | 'typewriter'

export interface BotConfig {
  id: string
  name: string
  wecomBotId: string
  wecomBotSecret: string
  wecomWsUrl: string
  llmApiKey: string
  llmBaseUrl: string
  llmModel: string
  provider: BotProvider
  streamingMode: StreamingMode
  difyBaseUrl: string | null
  difyApiKey: string | null
  difyAppId: string | null
  visionEnabled: boolean
  status: BotStatus
  createdAt: number
  updatedAt: number
}

export type BotStatus = 'running' | 'stopped' | 'error'

// ─── MCP Config (per-context capability) ─────────────────────────────────────

export interface ParamSchemaItem {
  key: string
  label: string
  type: 'string' | 'string[]' | 'number' | 'boolean'
  description?: string
}

export interface McpConfig {
  mcpServerId: string
  enabled: boolean
  params: Record<string, any>
  forceCall?: boolean
}

// ─── Context Configuration ────────────────────────────────────────────────────

export interface ContextConfig {
  id: string
  botId: string
  name: string
  systemPrompt: string
  mcpConfigs: McpConfig[]
  skillConfigs: SkillConfig[]
  sessionTtlMin: number
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

// Skill configuration ---------------------------------------------------------

export type SkillRuntime = 'node' | 'python'
export type SkillAuditStatus = 'success' | 'error' | 'timeout' | 'blocked'

export interface SkillConfig {
  skillId: string
  enabled: boolean
  params: Record<string, any>
  forceUse?: boolean
  /** @deprecated Use forceUse for bundle Skills. Kept for older saved configs. */
  forceCall?: boolean
}

export interface SkillBundleMetadata {
  name: string
  description: string
  displayName?: string
  shortDescription?: string
  defaultPrompt?: string
  [key: string]: any
}

export interface SkillPermissionPolicy {
  scriptsEnabled?: boolean
  timeoutMs?: number
  maxOutputBytes?: number
  maxConcurrentRuns?: number
  allowedEnvKeys?: string[]
  allowedReadPaths?: string[]
  allowedWritePaths?: string[]
  networkAccess?: boolean
}

export interface SkillResourceIndex {
  skillMdPath: string
  scripts: string[]
  references: string[]
  assets: string[]
  otherFiles: string[]
  totalFiles: number
  totalBytes: number
}

export interface SkillDefinition {
  id: string
  botId: string | null
  name: string
  description: string
  enabled: boolean
  bundlePath: string
  bundleHash: string
  metadata: SkillBundleMetadata
  resourceIndex: SkillResourceIndex
  permissionPolicy: SkillPermissionPolicy
  createdAt: number
  updatedAt: number
}

export interface SkillAuditRecord {
  id: string
  skillId: string
  botId: string
  contextId: string | null
  chatKey: string | null
  status: SkillAuditStatus
  durationMs: number
  inputPreview: string | null
  outputPreview: string | null
  error: string | null
  createdAt: number
}

// ─── Binding ──────────────────────────────────────────────────────────────────

export interface Binding {
  id: string
  botId: string
  contextId: string
  chatKey: string
  chatName: string | null
  chatType: ChatType
  createdAt: number
}

export type ChatType = 'group' | 'user'

// ─── MCP Server ───────────────────────────────────────────────────────────────

export type McpServerTransportType = 'sse' | 'stdio' | 'streamable-http'

export interface McpServerConfig {
  id: string
  botId: string | null
  name: string
  url: string | null
  transportType: McpServerTransportType
  enabled: boolean
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  paramSchema?: ParamSchemaItem[]
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string
  chatKey: string
  contextId: string
  messages: SessionMessage[]
  difyConversationId?: string
  lastActiveAt: number
  expiresAt: number
}

export interface SessionMessage {
  role: 'human' | 'ai'
  content: string | IncomingContent[]
  timestamp: number
  responseRunId?: string | null
}

// ─── IM Adapter Interface (borrowed from Kite) ────────────────────────────────

export interface IncomingMessage {
  chatId: string
  chatKey: string
  chatType: 'single' | 'group'
  userId: string
  content: string | IncomingContent[]
  rawBody: unknown
}

export type WecomEventType =
  | 'enter_chat'
  | 'template_card_event'
  | 'feedback_event'
  | 'disconnected_event'
  | string

export type WecomEventStatus = 'pending' | 'processed' | 'duplicate' | 'error'

export interface IncomingEvent {
  msgId: string
  eventType: WecomEventType
  aibotId: string | null
  chatId: string | null
  chatKey: string
  chatType: 'single' | 'group'
  userId: string
  corpid: string | null
  responseUrl: string | null
  createTime: number | null
  eventPayload: Record<string, any>
  rawBody: unknown
}

export type IncomingContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }

export interface IMAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onEvent?(handler: (event: IncomingEvent) => Promise<void>): void
  /** Returns messageId if platform supports it (for later edit), otherwise void */
  sendMessage(chatId: string, text: string): Promise<void | string>
  /** Throws if platform does not support editing — caller must catch and fallback */
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
}

// ─── WeCom Event / Feedback Loop ──────────────────────────────────────────────

export interface WecomEventRecord {
  id: string
  msgId: string
  eventType: WecomEventType
  botId: string | null
  aibotId: string | null
  chatKey: string | null
  chatId: string | null
  chatType: 'single' | 'group' | null
  fromUserId: string | null
  fromCorpid: string | null
  responseUrl: string | null
  rawPayload: Record<string, any>
  status: WecomEventStatus
  error: string | null
  createTime: number | null
  createdAt: number
  processedAt: number | null
}

export type BotResponseRunStatus = 'pending' | 'sent' | 'error' | 'feedback_unavailable'

export interface BotResponseRun {
  id: string
  feedbackId: string | null
  botId: string
  contextId: string | null
  sessionId: string | null
  chatKey: string
  chatId: string
  userId: string | null
  questionPreview: string | null
  answerPreview: string | null
  provider: BotProvider
  model: string | null
  status: BotResponseRunStatus
  error: string | null
  difyConversationId: string | null
  feedbackAvailable: boolean
  createdAt: number
  updatedAt: number
}

export type WikiFeedbackStatus = 'new' | 'triaged' | 'drafted' | 'resolved' | 'ignored' | 'unlinked'
export type WikiFeedbackClassification = 'positive' | 'knowledge_gap' | 'retrieval_issue' | 'model_or_tool_issue' | 'ignored' | 'unclassified'

export interface WikiFeedbackItem {
  id: string
  eventId: string
  responseRunId: string | null
  namespace: string | null
  feedbackType: number | null
  content: string | null
  inaccurateReasons: number[]
  classification: WikiFeedbackClassification
  status: WikiFeedbackStatus
  assignedTargetPath: string | null
  draftId: string | null
  resolutionNote: string | null
  createdAt: number
  updatedAt: number
}

export interface AnnotationAnswer {
  id: string
  question: string
  answer: string
  namespace: string | null
  contextId: string | null
  sourceType: string
  sourceRef: string | null
  enabled: boolean
  hitCount: number
  createdAt: number
  updatedAt: number
}

// ─── LLM Config ───────────────────────────────────────────────────────────────

export interface LlmConfig {
  apiKey: string
  baseUrl: string
  model: string
  provider: BotProvider
}

// ─── Scheduled Task ───────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string
  botId: string
  name: string
  cronExpr: string
  promptTemplate: string
  targetChatKey: string
  targetChatId: string
  targetChatName: string | null
  contextId: string | null
  enabled: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

// ─── SSE Event ────────────────────────────────────────────────────────────────

export interface BotStatusEvent {
  type: 'bot_status'
  botId: string
  status: BotStatus
  error?: string
}
