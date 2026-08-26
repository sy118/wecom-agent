import { db } from '../db/client.js'
import type { UsageStatsRow } from '@wecom-platform/types'

export interface UsageFilter {
  tenantId: string
  botId?: string | null
  from?: number | null
  to?: number | null
  limit?: number
}

export interface UsageBreakdown {
  byBot: UsageStatsRow[]
  byTemplate: UsageStatsRow[]
  total: UsageStatsRow
}

function configuredNumber(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

const COST_PER_MS = configuredNumber('USAGE_COST_PER_MS', 0)

function rowToStat(row: Record<string, unknown>, tenantId: string, key: string, value: string | null): UsageStatsRow {
  const taskCount = Number(row.task_count ?? 0)
  const successCount = Number(row.success_count ?? 0)
  const totalDurationMs = Number(row.total_duration_ms ?? 0)
  return {
    tenantId,
    botId: key === 'bot' ? value : null,
    skillId: key === 'skill' ? value : null,
    templateId: key === 'template' ? value : null,
    taskCount,
    successCount,
    successRate: taskCount > 0 ? Math.round((successCount / taskCount) * 10000) / 100 : 0,
    totalDurationMs,
    cost: Math.round(totalDurationMs * COST_PER_MS * 100) / 100,
  }
}

export async function getUsageBreakdown(filter: UsageFilter): Promise<UsageBreakdown> {
  const where: string[] = ['tenant_id = ?']
  const args: Array<string | number | null> = [filter.tenantId]
  if (filter.botId) { where.push('bot_id = ?'); args.push(filter.botId) }
  if (filter.from) { where.push('created_at >= ?'); args.push(filter.from) }
  if (filter.to) { where.push('created_at <= ?'); args.push(filter.to) }
  const whereSql = where.join(' AND ')
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)

  const byBotRes = await db.execute({
    sql: `SELECT bot_id AS grp, COUNT(*) AS task_count,
                 SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS success_count,
                 SUM(updated_at - created_at) AS total_duration_ms
          FROM bot_response_runs WHERE ${whereSql} GROUP BY bot_id ORDER BY task_count DESC LIMIT ?`,
    args: [...args, limit],
  })
  const byBot = byBotRes.rows.map((row) => rowToStat(row, filter.tenantId, 'bot', String(row.grp)))

  const byTemplateRes = await db.execute({
    sql: `SELECT COALESCE(t.id, '') AS grp, COUNT(*) AS task_count,
                 SUM(CASE WHEN r.status = 'sent' THEN 1 ELSE 0 END) AS success_count,
                 SUM(r.updated_at - r.created_at) AS total_duration_ms
          FROM bot_response_runs r
          LEFT JOIN bot_triggers bt ON bt.bot_id = r.bot_id
          LEFT JOIN agent_templates t ON t.name = bt.trigger AND t.tenant_id = r.tenant_id
          WHERE ${whereSql}
          GROUP BY t.id ORDER BY task_count DESC LIMIT ?`,
    args: [...args, limit],
  })
  const byTemplate = byTemplateRes.rows
    .filter((row) => row.grp)
    .map((row) => rowToStat(row, filter.tenantId, 'template', String(row.grp)))

  const totalRes = await db.execute({
    sql: `SELECT COUNT(*) AS task_count,
                 SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS success_count,
                 SUM(updated_at - created_at) AS total_duration_ms
          FROM bot_response_runs WHERE ${whereSql}`,
    args,
  })
  const total = rowToStat(totalRes.rows[0] ?? {}, filter.tenantId, 'total', null)
  return { byBot, byTemplate, total }
}

export async function getTemplateRanking(tenantId: string, limit = 20): Promise<Array<{
  id: string
  name: string
  category: string
  usageCount: number
}>> {
  const res = await db.execute({
    sql: `SELECT id, name, category, usage_count FROM agent_templates
          WHERE tenant_id = ? ORDER BY usage_count DESC, updated_at DESC LIMIT ?`,
    args: [tenantId, limit],
  })
  return res.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    usageCount: Number(row.usage_count ?? 0),
  }))
}