import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { McpServerConfig, ParamSchemaItem } from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function parseParamSchema(value: unknown): ParamSchemaItem[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value as string)
    return Array.isArray(parsed) ? parsed as ParamSchemaItem[] : undefined
  } catch {
    return undefined
  }
}

function serializeParamSchema(value: ParamSchemaItem[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null
}

function rowToConfig(row: Record<string, unknown>): McpServerConfig {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    name: row.name as string,
    url: row.url as string,
    transportType: row.transport_type as 'sse' | 'stdio',
    enabled: Boolean(row.enabled),
    paramSchema: parseParamSchema(row.param_schema),
  }
}

export const McpServerRepository = {
  async findAll(): Promise<McpServerConfig[]> {
    const res = await db.execute('SELECT * FROM mcp_servers ORDER BY name')
    return res.rows.map(rowToConfig)
  },

  async findById(id: string): Promise<McpServerConfig | null> {
    const res = await db.execute({ sql: 'SELECT * FROM mcp_servers WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToConfig(res.rows[0]) : null
  },

  async create(data: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const id = randomUUID()
    await db.execute({
      sql: 'INSERT INTO mcp_servers (id, bot_id, name, url, transport_type, enabled, param_schema) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, data.botId, data.name, data.url, data.transportType, data.enabled ? 1 : 0, serializeParamSchema(data.paramSchema)],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<McpServerConfig, 'id' | 'botId'>>): Promise<McpServerConfig | null> {
    const fields: string[] = []
    const args: InValue[] = []
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.url !== undefined) { fields.push('url = ?'); args.push(data.url) }
    if (data.transportType !== undefined) { fields.push('transport_type = ?'); args.push(data.transportType) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    if (data.paramSchema !== undefined) { fields.push('param_schema = ?'); args.push(serializeParamSchema(data.paramSchema)) }
    if (fields.length === 0) return this.findById(id)
    args.push(id)
    await db.execute({ sql: `UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM mcp_servers WHERE id = ?', args: [id] })
  },
}
