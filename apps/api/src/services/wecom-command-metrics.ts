import { db } from '../db/client.js'
import { AuditLogRepository } from '../db/wecom-access-repository.js'

export async function getWecomCommandMetrics(botId: string): Promise<Record<string, any>> {
  const audits = await AuditLogRepository.listByBot(botId, 1000)
  const commandAudits = audits.filter((audit) =>
    audit.action.startsWith('ctx.') ||
    audit.action.startsWith('task.') ||
    audit.action.startsWith('admin.') ||
    audit.action === 'image.generate' ||
    audit.action === 'help' ||
    audit.action === 'confirm' ||
    audit.action === 'command.unknown'
  )
  const commandSuccess = commandAudits.filter((audit) => audit.result === 'success').length
  const contextSwitches = commandAudits.filter((audit) => audit.action === 'ctx.use')
  const contextSwitchSuccess = contextSwitches.filter((audit) => audit.result === 'success').length
  const denied = commandAudits.filter((audit) => audit.result === 'denied').length

  const taskStats = await db.execute({
    sql: `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN error LIKE '%rate%' OR error LIKE '%limit%' THEN 1 ELSE 0 END) AS rate_limited,
            AVG(CASE WHEN started_at IS NOT NULL AND finished_at IS NOT NULL THEN finished_at - started_at ELSE NULL END) AS avg_duration_ms,
            SUM(COALESCE(cost, 0)) AS total_cost
          FROM generation_tasks
          WHERE bot_id = ?`,
    args: [botId],
  })
  const row = taskStats.rows[0] ?? {}

  return {
    commands: {
      total: commandAudits.length,
      success: commandSuccess,
      denied,
      successRate: commandAudits.length === 0 ? 1 : commandSuccess / commandAudits.length,
    },
    contextSwitch: {
      total: contextSwitches.length,
      success: contextSwitchSuccess,
      successRate: contextSwitches.length === 0 ? 1 : contextSwitchSuccess / contextSwitches.length,
    },
    generationTasks: {
      total: Number(row.total ?? 0),
      failed: Number(row.failed ?? 0),
      failureRate: Number(row.total ?? 0) === 0 ? 0 : Number(row.failed ?? 0) / Number(row.total ?? 0),
      rateLimited: Number(row.rate_limited ?? 0),
      avgDurationMs: row.avg_duration_ms === null || row.avg_duration_ms === undefined ? null : Number(row.avg_duration_ms),
      totalCost: Number(row.total_cost ?? 0),
    },
  }
}
