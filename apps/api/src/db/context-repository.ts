import { randomUUID } from 'crypto'
import { db } from './client.js'
import { getEnvDefaultSessionTtlMin } from '../config/session-ttl.js'
import type { ContextConfig, McpConfig, SkillConfig } from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function parseJsonArray<T>(value: unknown): T[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value as string)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function rowToConfig(row: Record<string, unknown>): ContextConfig {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    name: row.name as string,
    systemPrompt: row.system_prompt as string,
    mcpConfigs: parseJsonArray<McpConfig>(row.mcp_configs),
    skillConfigs: parseJsonArray<SkillConfig>(row.skill_configs),
    sessionTtlMin: row.session_ttl_min as number,
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const ContextRepository = {
  async findAll(): Promise<ContextConfig[]> {
    const res = await db.execute('SELECT * FROM contexts ORDER BY created_at DESC')
    return res.rows.map(rowToConfig)
  },

  async findByBotId(botId: string): Promise<ContextConfig[]> {
    const res = await db.execute({ sql: 'SELECT * FROM contexts WHERE bot_id = ? ORDER BY created_at DESC', args: [botId] })
    return res.rows.map(rowToConfig)
  },

  async findById(id: string): Promise<ContextConfig | null> {
    const res = await db.execute({ sql: 'SELECT * FROM contexts WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToConfig(res.rows[0]) : null
  },

  async findDefault(botId: string): Promise<ContextConfig | null> {
    const res = await db.execute({ sql: 'SELECT * FROM contexts WHERE bot_id = ? AND is_default = 1 LIMIT 1', args: [botId] })
    return res.rows[0] ? rowToConfig(res.rows[0]) : null
  },

  async create(data: Omit<ContextConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<ContextConfig> {
    const id = randomUUID()
    const now = Date.now()
    const sessionTtlMin = data.sessionTtlMin ?? getEnvDefaultSessionTtlMin()
    if (data.isDefault) {
      await db.execute({ sql: 'UPDATE contexts SET is_default = 0, updated_at = ? WHERE bot_id = ? AND is_default = 1', args: [now, data.botId] })
    }
    await db.execute({
      sql: `INSERT INTO contexts (id, bot_id, name, system_prompt, mcp_configs, skill_configs, session_ttl_min, is_default, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId,
        data.name,
        data.systemPrompt,
        JSON.stringify(data.mcpConfigs ?? []),
        JSON.stringify(data.skillConfigs ?? []),
        sessionTtlMin,
        data.isDefault ? 1 : 0,
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<ContextConfig, 'id' | 'botId' | 'createdAt'>>): Promise<ContextConfig | null> {
    const existing = await this.findById(id)
    if (!existing) return null
    const now = Date.now()
    if (data.isDefault) {
      await db.execute({ sql: 'UPDATE contexts SET is_default = 0, updated_at = ? WHERE bot_id = ? AND is_default = 1', args: [now, existing.botId] })
    }
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [now]
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.systemPrompt !== undefined) { fields.push('system_prompt = ?'); args.push(data.systemPrompt) }
    if (data.mcpConfigs !== undefined) { fields.push('mcp_configs = ?'); args.push(JSON.stringify(data.mcpConfigs)) }
    if (data.skillConfigs !== undefined) { fields.push('skill_configs = ?'); args.push(JSON.stringify(data.skillConfigs)) }
    if (data.sessionTtlMin !== undefined) { fields.push('session_ttl_min = ?'); args.push(data.sessionTtlMin) }
    if (data.isDefault !== undefined) { fields.push('is_default = ?'); args.push(data.isDefault ? 1 : 0) }
    args.push(id)
    await db.execute({ sql: `UPDATE contexts SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM contexts WHERE id = ?', args: [id] })
  },
}
