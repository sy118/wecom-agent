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

export interface McpServerConfig {
  id: string
  botId: string | null
  name: string
  url: string
  transportType: 'sse' | 'stdio'
  enabled: boolean
  paramSchema?: ParamSchemaItem[]
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
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

export type IncomingContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string }

export interface IMAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  /** Returns messageId if platform supports it (for later edit), otherwise void */
  sendMessage(chatId: string, text: string): Promise<void | string>
  /** Throws if platform does not support editing — caller must catch and fallback */
  editMessage(chatId: string, messageId: string, text: string): Promise<void>
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
