import { randomUUID } from 'crypto'
import { db } from './client.js'
import type { AgentTemplate, AgentTemplateManifest, TemplateRevision } from '@wecom-platform/types'

function rowToTemplate(row: Record<string, unknown>): AgentTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    category: (row.category as string) ?? 'general',
    author: (row.author as string | null) ?? null,
    status: (row.status as AgentTemplate['status']) ?? 'active',
    tenantId: row.tenant_id as string,
    currentVersion: Number(row.current_version ?? 1),
    usageCount: Number(row.usage_count ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToRevision(row: Record<string, unknown>): TemplateRevision {
  return {
    id: row.id as string,
    templateId: row.template_id as string,
    version: Number(row.version),
    manifest: row.manifest_json ? JSON.parse(row.manifest_json as string) : ({} as AgentTemplateManifest),
    createdAt: Number(row.created_at),
  }
}

export const TemplateRepository = {
  async create(data: {
    name: string
    description?: string
    category?: string
    author?: string | null
    tenantId: string
    manifest: AgentTemplateManifest
  }): Promise<AgentTemplate> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO agent_templates
              (id, name, description, category, author, status, tenant_id, current_version,
               usage_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'active', ?, 1, 0, ?, ?)`,
      args: [
        id,
        data.name,
        data.description ?? '',
        data.category ?? 'general',
        data.author ?? null,
        data.tenantId,
        now,
        now,
      ],
    })
    await db.execute({
      sql: `INSERT INTO template_revisions (id, template_id, version, manifest_json, created_at)
            VALUES (?, ?, 1, ?, ?)`,
      args: [randomUUID(), id, JSON.stringify(data.manifest), now],
    })
    return (await this.findById(id))!
  },

  async findById(id: string): Promise<AgentTemplate | null> {
    const res = await db.execute({ sql: 'SELECT * FROM agent_templates WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToTemplate(res.rows[0]) : null
  },

  async findByTenant(
    tenantId: string,
    options: { category?: string; search?: string; status?: string; limit?: number } = {}
  ): Promise<AgentTemplate[]> {
    const where: string[] = ['tenant_id = ?']
    const args: Array<string | number | null> = [tenantId]
    if (options.category) { where.push('category = ?'); args.push(options.category) }
    if (options.status) { where.push('status = ?'); args.push(options.status) }
    if (options.search) {
      where.push('(name LIKE ? OR description LIKE ?)')
      const pattern = `%${options.search}%`
      args.push(pattern, pattern)
    }
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
    const res = await db.execute({
      sql: `SELECT * FROM agent_templates WHERE ${where.join(' AND ')} ORDER BY usage_count DESC, updated_at DESC LIMIT ?`,
      args: [...args, limit],
    })
    return res.rows.map(rowToTemplate)
  },

  async listRevisions(templateId: string): Promise<TemplateRevision[]> {
    const res = await db.execute({
      sql: 'SELECT * FROM template_revisions WHERE template_id = ? ORDER BY version DESC',
      args: [templateId],
    })
    return res.rows.map(rowToRevision)
  },

  async getRevision(templateId: string, version: number): Promise<TemplateRevision | null> {
    const res = await db.execute({
      sql: 'SELECT * FROM template_revisions WHERE template_id = ? AND version = ?',
      args: [templateId, version],
    })
    return res.rows[0] ? rowToRevision(res.rows[0]) : null
  },

  async publishNewVersion(id: string, manifest: AgentTemplateManifest): Promise<AgentTemplate> {
    const template = await this.findById(id)
    if (!template) throw new Error(`模板不存在：${id}`)
    const nextVersion = template.currentVersion + 1
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO template_revisions (id, template_id, version, manifest_json, created_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [randomUUID(), id, nextVersion, JSON.stringify(manifest), now],
    })
    await db.execute({
      sql: `UPDATE agent_templates SET current_version = ?, updated_at = ? WHERE id = ?`,
      args: [nextVersion, now, id],
    })
    return (await this.findById(id))!
  },

  async incrementUsage(id: string): Promise<void> {
    await db.execute({ sql: 'UPDATE agent_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?', args: [Date.now(), id] })
  },

  async updateStatus(id: string, status: AgentTemplate['status']): Promise<AgentTemplate | null> {
    await db.execute({ sql: 'UPDATE agent_templates SET status = ?, updated_at = ? WHERE id = ?', args: [status, Date.now(), id] })
    return this.findById(id)
  },

  async updateMeta(id: string, data: { name?: string; description?: string; category?: string }): Promise<AgentTemplate | null> {
    const now = Date.now()
    await db.execute({
      sql: `UPDATE agent_templates
            SET name = COALESCE(?, name), description = COALESCE(?, description),
                category = COALESCE(?, category), updated_at = ?
            WHERE id = ?`,
      args: [data.name ?? null, data.description ?? null, data.category ?? null, now, id],
    })
    return this.findById(id)
  },
}
