import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { SkillDefinition, SkillManifest, SkillParamSchemaItem, SkillPermissionPolicy, SkillType } from '@wecom-platform/types'
import type { InValue } from '@libsql/client'

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value as string) as T
  } catch {
    return fallback
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? {})
}

function serializeParamSchema(value: SkillParamSchemaItem[] | undefined): string | null {
  return value && value.length > 0 ? JSON.stringify(value) : null
}

function rowToSkill(row: Record<string, unknown>): SkillDefinition {
  return {
    id: row.id as string,
    botId: row.bot_id as string,
    name: row.name as string,
    description: row.description as string,
    type: row.type as SkillType,
    enabled: Boolean(row.enabled),
    manifest: parseJson<SkillManifest>(row.manifest_json, {}),
    paramSchema: parseJson<SkillParamSchemaItem[] | undefined>(row.param_schema, undefined),
    permissionPolicy: parseJson<SkillPermissionPolicy>(row.permission_policy, {}),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const SkillRepository = {
  async findByBotId(botId: string): Promise<SkillDefinition[]> {
    const res = await db.execute({ sql: 'SELECT * FROM skills WHERE bot_id = ? ORDER BY created_at DESC', args: [botId] })
    return res.rows.map(rowToSkill)
  },

  async findEnabledByBotId(botId: string): Promise<SkillDefinition[]> {
    const res = await db.execute({ sql: 'SELECT * FROM skills WHERE bot_id = ? AND enabled = 1 ORDER BY created_at DESC', args: [botId] })
    return res.rows.map(rowToSkill)
  },

  async findById(id: string): Promise<SkillDefinition | null> {
    const res = await db.execute({ sql: 'SELECT * FROM skills WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToSkill(res.rows[0]) : null
  },

  async create(data: Omit<SkillDefinition, 'id' | 'createdAt' | 'updatedAt'>): Promise<SkillDefinition> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO skills (id, bot_id, name, description, type, enabled, manifest_json, param_schema, permission_policy, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId,
        data.name,
        data.description ?? '',
        data.type,
        data.enabled ? 1 : 0,
        serializeJson(data.manifest),
        serializeParamSchema(data.paramSchema),
        serializeJson(data.permissionPolicy ?? {}),
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<SkillDefinition, 'id' | 'botId' | 'createdAt' | 'updatedAt'>>): Promise<SkillDefinition | null> {
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [Date.now()]
    if (data.name !== undefined) { fields.push('name = ?'); args.push(data.name) }
    if (data.description !== undefined) { fields.push('description = ?'); args.push(data.description) }
    if (data.type !== undefined) { fields.push('type = ?'); args.push(data.type) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    if (data.manifest !== undefined) { fields.push('manifest_json = ?'); args.push(serializeJson(data.manifest)) }
    if (data.paramSchema !== undefined) { fields.push('param_schema = ?'); args.push(serializeParamSchema(data.paramSchema)) }
    if (data.permissionPolicy !== undefined) { fields.push('permission_policy = ?'); args.push(serializeJson(data.permissionPolicy)) }
    args.push(id)
    await db.execute({ sql: `UPDATE skills SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM skills WHERE id = ?', args: [id] })
  },
}
