import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { SkillBundleMetadata, SkillDefinition, SkillPermissionPolicy, SkillResourceIndex } from '@wecom-platform/types'
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

const emptyResourceIndex: SkillResourceIndex = {
  skillMdPath: 'SKILL.md',
  scripts: [],
  references: [],
  assets: [],
  otherFiles: [],
  totalFiles: 0,
  totalBytes: 0,
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeMetadata(row: Record<string, unknown>): SkillBundleMetadata {
  const parsed = parseJson<Partial<SkillBundleMetadata>>(row.metadata_json, {})
  return {
    ...parsed,
    name: typeof parsed.name === 'string' && parsed.name ? parsed.name : row.name as string,
    description: typeof parsed.description === 'string' && parsed.description ? parsed.description : row.description as string,
  }
}

function normalizeResourceIndex(value: unknown): SkillResourceIndex {
  const parsed = parseJson<Partial<SkillResourceIndex>>(value, {})
  const scripts = stringArray(parsed.scripts)
  const references = stringArray(parsed.references)
  const assets = stringArray(parsed.assets)
  const otherFiles = stringArray(parsed.otherFiles)
  return {
    ...emptyResourceIndex,
    ...parsed,
    skillMdPath: typeof parsed.skillMdPath === 'string' && parsed.skillMdPath ? parsed.skillMdPath : emptyResourceIndex.skillMdPath,
    scripts,
    references,
    assets,
    otherFiles,
    totalFiles: typeof parsed.totalFiles === 'number' ? parsed.totalFiles : scripts.length + references.length + assets.length + otherFiles.length,
    totalBytes: typeof parsed.totalBytes === 'number' ? parsed.totalBytes : 0,
  }
}

function rowToSkill(row: Record<string, unknown>): SkillDefinition {
  const metadata = normalizeMetadata(row)
  return {
    id: row.id as string,
    botId: (row.bot_id as string | null) ?? null,
    name: row.name as string,
    description: row.description as string,
    enabled: Boolean(row.enabled),
    bundlePath: (row.bundle_path as string | null) ?? '',
    bundleHash: (row.bundle_hash as string | null) ?? '',
    metadata,
    resourceIndex: normalizeResourceIndex(row.resource_index_json),
    permissionPolicy: parseJson<SkillPermissionPolicy>(row.permission_policy, {}),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export type CreateSkillBundleInput = Omit<SkillDefinition, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
export type UpdateSkillBundleInput = Partial<Pick<SkillDefinition, 'description' | 'enabled' | 'bundlePath' | 'bundleHash' | 'metadata' | 'resourceIndex' | 'permissionPolicy'>>

export const SkillRepository = {
  async findAll(): Promise<SkillDefinition[]> {
    const res = await db.execute('SELECT * FROM skills ORDER BY created_at DESC')
    return res.rows.map(rowToSkill)
  },

  async findById(id: string): Promise<SkillDefinition | null> {
    const res = await db.execute({ sql: 'SELECT * FROM skills WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToSkill(res.rows[0]) : null
  },

  async create(data: CreateSkillBundleInput): Promise<SkillDefinition> {
    const id = data.id ?? randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO skills
              (id, bot_id, name, description, enabled, bundle_path, bundle_hash,
               metadata_json, resource_index_json, permission_policy, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        data.botId,
        data.name,
        data.description,
        data.enabled ? 1 : 0,
        data.bundlePath,
        data.bundleHash,
        serializeJson(data.metadata),
        serializeJson(data.resourceIndex),
        serializeJson(data.permissionPolicy ?? {}),
        now,
        now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: UpdateSkillBundleInput): Promise<SkillDefinition | null> {
    const fields: string[] = ['updated_at = ?']
    const args: InValue[] = [Date.now()]
    if (data.description !== undefined) { fields.push('description = ?'); args.push(data.description) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); args.push(data.enabled ? 1 : 0) }
    if (data.bundlePath !== undefined) { fields.push('bundle_path = ?'); args.push(data.bundlePath) }
    if (data.bundleHash !== undefined) { fields.push('bundle_hash = ?'); args.push(data.bundleHash) }
    if (data.metadata !== undefined) {
      fields.push('metadata_json = ?')
      args.push(serializeJson(data.metadata))
      fields.push('name = ?')
      args.push(data.metadata.name)
      fields.push('description = ?')
      args.push(data.metadata.description)
    }
    if (data.resourceIndex !== undefined) { fields.push('resource_index_json = ?'); args.push(serializeJson(data.resourceIndex)) }
    if (data.permissionPolicy !== undefined) { fields.push('permission_policy = ?'); args.push(serializeJson(data.permissionPolicy)) }
    args.push(id)
    await db.execute({ sql: `UPDATE skills SET ${fields.join(', ')} WHERE id = ?`, args })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM skills WHERE id = ?', args: [id] })
  },
}
