import { randomBytes, randomUUID } from 'crypto'
import { db } from './client.js'
import type {
  GeneratedFile,
  GenerationTask,
  GenerationTaskStatus,
  GenerationTaskType,
  ModelCapability,
  ModelConfig,
  WecomUserRole,
} from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function boolValue(value: unknown): boolean {
  return Number(value ?? 0) === 1
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

function parseJsonArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function rowToModelConfig(row: Record<string, unknown>): ModelConfig {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    name: row.name as string,
    provider: row.provider as ModelConfig['provider'],
    modelName: row.model_name as string,
    capability: row.capability as ModelCapability,
    baseUrl: (row.base_url as string | null) ?? null,
    apiKey: (row.api_key as string | null) ?? null,
    defaultParams: parseJsonObject(row.default_params),
    enabled: boolValue(row.enabled),
    timeoutMs: nullableNumber(row.timeout_ms),
    quotaPerUserDaily: nullableNumber(row.quota_per_user_daily),
    maxConcurrent: nullableNumber(row.max_concurrent),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToGenerationTask(row: Record<string, unknown>): GenerationTask {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    taskType: row.task_type as GenerationTaskType,
    status: row.status as GenerationTaskStatus,
    ownerUserId: row.owner_user_id as string,
    chatKey: row.chat_key as string,
    chatId: row.chat_id as string,
    contextId: (row.context_id as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    inputPayload: parseJsonObject(row.input_payload),
    outputFileIds: parseJsonArray(row.output_file_ids),
    previewSummary: (row.preview_summary as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    cost: nullableNumber(row.cost),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    startedAt: nullableNumber(row.started_at),
    finishedAt: nullableNumber(row.finished_at),
  }
}

function rowToGeneratedFile(row: Record<string, unknown>): GeneratedFile {
  return {
    id: row.id as string,
    taskId: (row.task_id as string | null) ?? null,
    botId: (row.bot_id as string | null) ?? null,
    ownerUserId: (row.owner_user_id as string | null) ?? null,
    chatKey: (row.chat_key as string | null) ?? null,
    fileType: row.file_type as string,
    storagePath: row.storage_path as string,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: nullableNumber(row.size_bytes),
    accessToken: row.access_token as string,
    expiresAt: nullableNumber(row.expires_at),
    createdAt: Number(row.created_at),
  }
}

function newAccessToken(): string {
  return randomBytes(18).toString('base64url')
}

export const ModelConfigRepository = {
  async create(data: {
    botId?: string | null
    name: string
    provider: ModelConfig['provider']
    modelName: string
    capability: ModelCapability
    baseUrl?: string | null
    apiKey?: string | null
    defaultParams?: Record<string, any>
    enabled?: boolean
    timeoutMs?: number | null
    quotaPerUserDaily?: number | null
    maxConcurrent?: number | null
  }): Promise<ModelConfig> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO model_configs
              (id, bot_id, name, provider, model_name, capability, base_url, api_key, default_params,
               enabled, timeout_ms, quota_per_user_daily, max_concurrent, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId ?? null,
        data.name,
        data.provider,
        data.modelName,
        data.capability,
        data.baseUrl ?? null,
        data.apiKey ?? null,
        JSON.stringify(data.defaultParams ?? {}),
        data.enabled === false ? 0 : 1,
        data.timeoutMs ?? null,
        data.quotaPerUserDaily ?? null,
        data.maxConcurrent ?? null,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<ModelConfig | null> {
    const res = await db.execute({ sql: 'SELECT * FROM model_configs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToModelConfig(res.rows[0]) : null
  },

  async list(botId?: string | null, capability?: ModelCapability): Promise<ModelConfig[]> {
    const clauses: string[] = []
    const args: InValue[] = []
    if (botId !== undefined) {
      clauses.push('(bot_id = ? OR bot_id IS NULL)')
      args.push(botId)
    }
    if (capability) {
      clauses.push('capability = ?')
      args.push(capability)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const res = await db.execute({
      sql: `SELECT * FROM model_configs ${where} ORDER BY bot_id IS NULL ASC, updated_at DESC`,
      args,
    })
    return res.rows.map(rowToModelConfig)
  },

  async findEnabledByCapability(botId: string, capability: ModelCapability): Promise<ModelConfig | null> {
    const res = await db.execute({
      sql: `SELECT * FROM model_configs
            WHERE (bot_id = ? OR bot_id IS NULL) AND capability = ? AND enabled = 1
            ORDER BY bot_id IS NULL ASC, updated_at DESC
            LIMIT 1`,
      args: [botId, capability],
    })
    return res.rows[0] ? rowToModelConfig(res.rows[0]) : null
  },

  async update(id: string, data: Partial<Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ModelConfig | null> {
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [Date.now()]
    if (data.botId !== undefined) { fields.push('bot_id = ?'); args.push(data.botId) }
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.provider !== undefined) { fields.push('provider = ?'); args.push(data.provider) }
    if (data.modelName !== undefined) { fields.push('model_name = ?'); args.push(data.modelName) }
    if (data.capability !== undefined) { fields.push('capability = ?'); args.push(data.capability) }
    if (data.baseUrl !== undefined) { fields.push('base_url = ?'); args.push(data.baseUrl) }
    if (data.apiKey !== undefined) { fields.push('api_key = ?'); args.push(data.apiKey) }
    if (data.defaultParams !== undefined) { fields.push('default_params = ?'); args.push(JSON.stringify(data.defaultParams)) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    if (data.timeoutMs !== undefined) { fields.push('timeout_ms = ?'); args.push(data.timeoutMs) }
    if (data.quotaPerUserDaily !== undefined) { fields.push('quota_per_user_daily = ?'); args.push(data.quotaPerUserDaily) }
    if (data.maxConcurrent !== undefined) { fields.push('max_concurrent = ?'); args.push(data.maxConcurrent) }
    args.push(id)
    await db.execute({ sql: `UPDATE model_configs SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },
}

export const GenerationTaskRepository = {
  async create(data: {
    botId: string
    taskType: GenerationTaskType
    ownerUserId: string
    chatKey: string
    chatId: string
    contextId?: string | null
    modelId?: string | null
    inputPayload?: Record<string, any>
    previewSummary?: string | null
  }): Promise<GenerationTask> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO generation_tasks
              (id, bot_id, task_type, status, owner_user_id, chat_key, chat_id, context_id, model_id,
               input_payload, output_file_ids, preview_summary, error, cost, created_at, updated_at, started_at, finished_at)
            VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, '[]', ?, NULL, NULL, ?, ?, NULL, NULL)`,
      args: [
        id,
        data.botId,
        data.taskType,
        data.ownerUserId,
        data.chatKey,
        data.chatId,
        data.contextId ?? null,
        data.modelId ?? null,
        JSON.stringify(data.inputPayload ?? {}),
        data.previewSummary ?? null,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<GenerationTask | null> {
    const res = await db.execute({ sql: 'SELECT * FROM generation_tasks WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToGenerationTask(res.rows[0]) : null
  },

  async listByOwner(botId: string, ownerUserId: string, limit = 50): Promise<GenerationTask[]> {
    const res = await db.execute({
      sql: `SELECT * FROM generation_tasks
            WHERE bot_id = ? AND owner_user_id = ?
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [botId, ownerUserId, limit],
    })
    return res.rows.map(rowToGenerationTask)
  },

  async countByOwnerSince(botId: string, ownerUserId: string, taskType: GenerationTaskType, since: number): Promise<number> {
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM generation_tasks
            WHERE bot_id = ? AND owner_user_id = ? AND task_type = ? AND created_at >= ?`,
      args: [botId, ownerUserId, taskType, since],
    })
    return Number(res.rows[0]?.cnt ?? 0)
  },

  async countRunningByModel(botId: string, modelId: string): Promise<number> {
    const res = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM generation_tasks
            WHERE bot_id = ? AND model_id = ? AND status = 'running'`,
      args: [botId, modelId],
    })
    return Number(res.rows[0]?.cnt ?? 0)
  },

  async listRunnable(limit = 20, enabledTypes?: GenerationTaskType[]): Promise<GenerationTask[]> {
    const args: InValue[] = ['pending', limit]
    let typeClause = ''
    if (enabledTypes && enabledTypes.length > 0) {
      typeClause = `AND task_type IN (${enabledTypes.map(() => '?').join(', ')})`
      args.splice(1, 0, ...enabledTypes)
    }
    const res = await db.execute({
      sql: `SELECT * FROM generation_tasks
            WHERE status = ? ${typeClause}
            ORDER BY created_at ASC
            LIMIT ?`,
      args,
    })
    return res.rows.map(rowToGenerationTask)
  },

  async markRunning(id: string, now = Date.now()): Promise<GenerationTask | null> {
    await db.execute({
      sql: `UPDATE generation_tasks
            SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE id = ? AND status = 'pending'`,
      args: [now, now, id],
    })
    return this.findById(id)
  },

  async markSucceeded(id: string, outputFileIds: string[], cost?: number | null, now = Date.now()): Promise<GenerationTask | null> {
    await db.execute({
      sql: `UPDATE generation_tasks
            SET status = 'succeeded', output_file_ids = ?, cost = ?, error = NULL, finished_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [JSON.stringify(outputFileIds), cost ?? null, now, now, id],
    })
    return this.findById(id)
  },

  async markFailed(id: string, error: string, now = Date.now()): Promise<GenerationTask | null> {
    await db.execute({
      sql: `UPDATE generation_tasks
            SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [error, now, now, id],
    })
    return this.findById(id)
  },

  async appendOutputFile(id: string, fileId: string): Promise<GenerationTask | null> {
    const task = await this.findById(id)
    if (!task) return null
    if (task.outputFileIds.includes(fileId)) return task
    const outputFileIds = [...task.outputFileIds, fileId]
    await db.execute({
      sql: 'UPDATE generation_tasks SET output_file_ids = ?, updated_at = ? WHERE id = ?',
      args: [JSON.stringify(outputFileIds), Date.now(), id],
    })
    return this.findById(id)
  },

  async updatePreviewSummary(id: string, previewSummary: string | null): Promise<GenerationTask | null> {
    await db.execute({
      sql: 'UPDATE generation_tasks SET preview_summary = ?, updated_at = ? WHERE id = ?',
      args: [previewSummary, Date.now(), id],
    })
    return this.findById(id)
  },

  async canAccess(taskId: string, wecomUserId: string, role: WecomUserRole): Promise<boolean> {
    const task = await this.findById(taskId)
    if (!task) return false
    if (role === 'admin' || role === 'manager') return true
    return task?.ownerUserId === wecomUserId
  },
}

export const GeneratedFileRepository = {
  async create(data: {
    taskId?: string | null
    botId?: string | null
    ownerUserId?: string | null
    chatKey?: string | null
    fileType: string
    storagePath: string
    mimeType?: string | null
    sizeBytes?: number | null
    accessToken?: string
    expiresAt?: number | null
  }): Promise<GeneratedFile> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO generated_files
              (id, task_id, bot_id, owner_user_id, chat_key, file_type, storage_path, mime_type,
               size_bytes, access_token, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.taskId ?? null,
        data.botId ?? null,
        data.ownerUserId ?? null,
        data.chatKey ?? null,
        data.fileType,
        data.storagePath,
        data.mimeType ?? null,
        data.sizeBytes ?? null,
        data.accessToken ?? newAccessToken(),
        data.expiresAt ?? null,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<GeneratedFile | null> {
    const res = await db.execute({ sql: 'SELECT * FROM generated_files WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToGeneratedFile(res.rows[0]) : null
  },

  async findByAccessToken(accessToken: string, now = Date.now()): Promise<GeneratedFile | null> {
    const res = await db.execute({
      sql: `SELECT * FROM generated_files
            WHERE access_token = ? AND (expires_at IS NULL OR expires_at > ?)
            LIMIT 1`,
      args: [accessToken, now],
    })
    return res.rows[0] ? rowToGeneratedFile(res.rows[0]) : null
  },

  async listByTask(taskId: string): Promise<GeneratedFile[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM generated_files WHERE task_id = ? ORDER BY created_at ASC',
      args: [taskId],
    })
    return res.rows.map(rowToGeneratedFile)
  },

  async listExpired(now = Date.now(), limit = 100): Promise<GeneratedFile[]> {
    const res = await db.execute({
      sql: `SELECT * FROM generated_files
            WHERE expires_at IS NOT NULL AND expires_at <= ?
            ORDER BY expires_at ASC
            LIMIT ?`,
      args: [now, limit],
    })
    return res.rows.map(rowToGeneratedFile)
  },

  async deleteExpired(now = Date.now()): Promise<number> {
    const expired = await this.listExpired(now, 1000)
    if (expired.length === 0) return 0
    await db.execute({
      sql: `DELETE FROM generated_files WHERE id IN (${expired.map(() => '?').join(', ')})`,
      args: expired.map((file) => file.id),
    })
    return expired.length
  },

  async canAccess(fileId: string, wecomUserId: string, role: WecomUserRole): Promise<boolean> {
    const file = await this.findById(fileId)
    if (!file) return false
    if (role === 'admin' || role === 'manager') return true
    return file?.ownerUserId === wecomUserId
  },
}
