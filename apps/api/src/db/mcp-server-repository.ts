import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { McpServerConfig, McpServerTransportType, ParamSchemaItem } from '@wecom-platform/types'
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

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value as string)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : []
  } catch {
    return []
  }
}

function serializeStringArray(value: string[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value as string)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.entries(parsed).every(([key, entry]) => typeof key === 'string' && typeof entry === 'string')
      ? parsed as Record<string, string>
      : {}
  } catch {
    return {}
  }
}

function serializeStringRecord(value: Record<string, string> | undefined): string | null {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value) : null
}

function rowToConfig(row: Record<string, unknown>): McpServerConfig {
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    name: row.name as string,
    url: (row.url as string | null) ?? null,
    transportType: row.transport_type as McpServerTransportType,
    enabled: Boolean(row.enabled),
    command: (row.command as string | null) ?? null,
    args: parseStringArray(row.args_json),
    env: parseStringRecord(row.env_json),
    headers: parseStringRecord(row.headers_json),
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
      sql: `INSERT INTO mcp_servers (
        id, bot_id, name, url, transport_type, enabled, param_schema, command, args_json, env_json, headers_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId,
        data.name,
        data.url ?? null,
        data.transportType,
        data.enabled ? 1 : 0,
        serializeParamSchema(data.paramSchema),
        data.command ?? null,
        serializeStringArray(data.args),
        serializeStringRecord(data.env),
        serializeStringRecord(data.headers),
      ],
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
    if (data.command !== undefined) { fields.push('command = ?'); args.push(data.command) }
    if (data.args !== undefined) { fields.push('args_json = ?'); args.push(serializeStringArray(data.args)) }
    if (data.env !== undefined) { fields.push('env_json = ?'); args.push(serializeStringRecord(data.env)) }
    if (data.headers !== undefined) { fields.push('headers_json = ?'); args.push(serializeStringRecord(data.headers)) }
    if (fields.length === 0) return this.findById(id)
    args.push(id)
    await db.execute({ sql: `UPDATE mcp_servers SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM mcp_servers WHERE id = ?', args: [id] })
  },
}
