import { randomUUID } from 'crypto'
import { db } from './client.js'

export interface WikiNamespace {
  id: string
  name: string
  displayName: string
  path: string
  description: string | null
  gitEnabled: boolean
  autoCompile: boolean
  compileSchedule: string | null
  createdAt: number
  updatedAt: number
}

function rowToNamespace(row: Record<string, unknown>): WikiNamespace {
  return {
    id: row.id as string,
    name: row.name as string,
    displayName: row.display_name as string,
    path: row.path as string,
    description: (row.description as string | null) ?? null,
    gitEnabled: Boolean(row.git_enabled),
    autoCompile: Boolean(row.auto_compile),
    compileSchedule: (row.compile_schedule as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export const WikiNamespaceRepository = {
  async findAll(): Promise<WikiNamespace[]> {
    const res = await db.execute('SELECT * FROM wiki_namespaces ORDER BY created_at ASC')
    return res.rows.map(rowToNamespace)
  },

  async findById(id: string): Promise<WikiNamespace | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_namespaces WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToNamespace(res.rows[0]) : null
  },

  async findByName(name: string): Promise<WikiNamespace | null> {
    const res = await db.execute({ sql: 'SELECT * FROM wiki_namespaces WHERE name = ?', args: [name] })
    return res.rows[0] ? rowToNamespace(res.rows[0]) : null
  },

  async create(data: Omit<WikiNamespace, 'id' | 'createdAt' | 'updatedAt'>): Promise<WikiNamespace> {
    const id = randomUUID()
    const now = Date.now()
    await db.execute({
      sql: `INSERT INTO wiki_namespaces (id, name, display_name, path, description, git_enabled, auto_compile, compile_schedule, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, data.name, data.displayName, data.path,
        data.description ?? null,
        data.gitEnabled ? 1 : 0,
        data.autoCompile ? 1 : 0,
        data.compileSchedule ?? null,
        now, now,
      ],
    })
    return (await this.findById(id))!
  },

  async update(id: string, data: Partial<Omit<WikiNamespace, 'id' | 'createdAt'>>): Promise<WikiNamespace | null> {
    const fields: string[] = ['updated_at = ?']
    const args: unknown[] = [Date.now()]
    if (data.displayName !== undefined) { fields.push('display_name = ?'); args.push(data.displayName) }
    if (data.path !== undefined) { fields.push('path = ?'); args.push(data.path) }
    if (data.description !== undefined) { fields.push('description = ?'); args.push(data.description) }
    if (data.gitEnabled !== undefined) { fields.push('git_enabled = ?'); args.push(data.gitEnabled ? 1 : 0) }
    if (data.autoCompile !== undefined) { fields.push('auto_compile = ?'); args.push(data.autoCompile ? 1 : 0) }
    if (data.compileSchedule !== undefined) { fields.push('compile_schedule = ?'); args.push(data.compileSchedule) }
    args.push(id)
    await db.execute({ sql: `UPDATE wiki_namespaces SET ${fields.join(', ')} WHERE id = ?`, args: args as import('@libsql/client').InValue[] })
    return this.findById(id)
  },

  async delete(id: string): Promise<void> {
    await db.execute({ sql: 'DELETE FROM wiki_namespaces WHERE id = ?', args: [id] })
  },
}
