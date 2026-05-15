import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { BotConfig, BotStatus, BotProvider, StreamingMode } from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function rowToConfig(row: Record<string, unknown>): BotConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    wecomBotId: row.wecom_bot_id as string,
    wecomBotSecret: row.wecom_bot_secret as string,
    wecomWsUrl: row.wecom_ws_url as string,
    llmApiKey: row.llm_api_key as string,
    llmBaseUrl: row.llm_base_url as string,
    llmModel: row.llm_model as string,
    provider: (row.provider as BotProvider) ?? 'openai-compatible',
    streamingMode: (row.streaming_mode as StreamingMode) ?? 'none',
    difyBaseUrl: (row.dify_base_url as string | null) ?? null,
    difyApiKey: (row.dify_api_key as string | null) ?? null,
    difyAppId: (row.dify_app_id as string | null) ?? null,
    visionEnabled: Boolean(row.vision_enabled),
    status: row.status as BotStatus,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const BotRepository = {
  async findAll(): Promise<BotConfig[]> {
    const res = await db.execute('SELECT * FROM bots ORDER BY created_at DESC')
    return res.rows.map(rowToConfig)
  },

  async findById(id: string): Promise<BotConfig | null> {
    const res = await db.execute({ sql: 'SELECT * FROM bots WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToConfig(res.rows[0]) : null
  },

  async findByStatus(status: BotStatus): Promise<BotConfig[]> {
    const res = await db.execute({ sql: 'SELECT * FROM bots WHERE status = ?', args: [status] })
    return res.rows.map(rowToConfig)
  },

  async create(data: Omit<BotConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<BotConfig> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO bots (id, name, wecom_bot_id, wecom_bot_secret, wecom_ws_url, llm_api_key, llm_base_url, llm_model,
              provider, streaming_mode, dify_base_url, dify_api_key, dify_app_id, vision_enabled, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)`,
      args: [
        id, data.name, data.wecomBotId, data.wecomBotSecret, data.wecomWsUrl,
        data.llmApiKey, data.llmBaseUrl, data.llmModel,
        data.provider ?? 'openai-compatible',
        data.streamingMode ?? 'none',
        data.difyBaseUrl ?? null,
        data.difyApiKey ?? null,
        data.difyAppId ?? null,
        data.visionEnabled ? 1 : 0,
        now, now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<BotConfig, 'id' | 'createdAt'>>): Promise<BotConfig | null> {
    const now = Date.now()
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [now]
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.wecomBotId !== undefined) { fields.push('wecom_bot_id = ?'); args.push(data.wecomBotId) }
    if (data.wecomBotSecret !== undefined) { fields.push('wecom_bot_secret = ?'); args.push(data.wecomBotSecret) }
    if (data.wecomWsUrl !== undefined) { fields.push('wecom_ws_url = ?'); args.push(data.wecomWsUrl) }
    if (data.llmApiKey !== undefined) { fields.push('llm_api_key = ?'); args.push(data.llmApiKey) }
    if (data.llmBaseUrl !== undefined) { fields.push('llm_base_url = ?'); args.push(data.llmBaseUrl) }
    if (data.llmModel !== undefined) { fields.push('llm_model = ?'); args.push(data.llmModel) }
    if (data.provider !== undefined) { fields.push('provider = ?'); args.push(data.provider) }
    if (data.streamingMode !== undefined) { fields.push('streaming_mode = ?'); args.push(data.streamingMode) }
    if (data.difyBaseUrl !== undefined) { fields.push('dify_base_url = ?'); args.push(data.difyBaseUrl) }
    if (data.difyApiKey !== undefined) { fields.push('dify_api_key = ?'); args.push(data.difyApiKey) }
    if (data.difyAppId !== undefined) { fields.push('dify_app_id = ?'); args.push(data.difyAppId) }
    if (data.visionEnabled !== undefined) { fields.push('vision_enabled = ?'); args.push(data.visionEnabled ? 1 : 0) }
    args.push(id)
    await db.execute({ sql: `UPDATE bots SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async updateStatus(id: string, status: BotStatus): Promise<void> {
    await db.execute({ sql: 'UPDATE bots SET status = ?, updated_at = ? WHERE id = ?', args: [status, Date.now(), id] })
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM bots WHERE id = ?', args: [id] })
  },
}
