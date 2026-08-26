import { Router } from 'express'
import { db } from '../db/client.js'
import { resolveTenantId, TenantRepository } from '../db/tenant-repository.js'
import { AuditRepository } from '../db/audit-repository.js'
import { ApprovalRepository } from '../db/approval-repository.js'
import { getUsageBreakdown, getTemplateRanking } from '../services/usage-stats-service.js'

export const governanceRouter: Router = Router()

function tenantOf(req: { headers: Record<string, any> }): string {
  return resolveTenantId(req.headers['x-tenant-id'])
}

function userIdOf(req: { headers: Record<string, any> }): string | null {
  const actor = req.headers['x-user-id']
  return typeof actor === 'string' && actor.trim() ? actor.trim() : null
}

function isAdmin(req: { headers: Record<string, any> }): boolean {
  const role = req.headers['x-user-role']
  return role === 'admin'
}

async function denyNonAdmin(req: any, res: any, action: string): Promise<boolean> {
  if (isAdmin(req)) return false
  await AuditRepository.record({
    tenantId: tenantOf(req),
    actorUserId: userIdOf(req),
    action,
    targetType: 'governance',
    result: 'denied',
    reason: '非管理员访问管理接口',
  }).catch(() => {})
  res.status(403).json({ error: '仅管理员可执行该操作' })
  return true
}

governanceRouter.get('/summary', async (req, res) => {
  const tenantId = tenantOf(req)
  const [bots, approvals, tools, tenants] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) AS cnt FROM bots WHERE tenant_id = ?', args: [tenantId] }),
    ApprovalRepository.findByTenant(tenantId, 'pending'),
    db.execute({ sql: 'SELECT COUNT(*) AS cnt FROM wecom_mcp_tools WHERE tenant_id = ? AND enabled = 1', args: [tenantId] }),
    TenantRepository.findAll(),
  ])
  res.json({
    tenantId,
    botCount: Number(bots.rows[0]?.cnt ?? 0),
    pendingApprovals: approvals.length,
    enabledMcpTools: Number(tools.rows[0]?.cnt ?? 0),
    tenants,
  })
})

governanceRouter.get('/usage', async (req, res) => {
  const tenantId = tenantOf(req)
  const from = typeof req.query.from === 'string' ? Number(req.query.from) : null
  const to = typeof req.query.to === 'string' ? Number(req.query.to) : null
  const botId = typeof req.query.botId === 'string' && req.query.botId ? req.query.botId : null
  const breakdown = await getUsageBreakdown({ tenantId, botId, from, to })
  const ranking = await getTemplateRanking(tenantId)
  res.json({ ...breakdown, templateRanking: ranking })
})

governanceRouter.get('/audit-logs', async (req, res) => {
  const tenantId = tenantOf(req)
  const rows = await AuditRepository.query({
    tenantId,
    actorUserId: typeof req.query.actor === 'string' ? req.query.actor : null,
    action: typeof req.query.action === 'string' ? req.query.action : null,
    targetType: typeof req.query.targetType === 'string' ? req.query.targetType : null,
    from: typeof req.query.from === 'string' ? Number(req.query.from) : null,
    to: typeof req.query.to === 'string' ? Number(req.query.to) : null,
    limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
  })
  res.json(rows)
})

governanceRouter.get('/audit-logs/export', async (req, res) => {
  if (await denyNonAdmin(req, res, 'audit.export')) return
  const tenantId = tenantOf(req)
  const { rows } = await AuditRepository.query({ tenantId, limit: 2000 })
  const header = ['time', 'actor', 'action', 'targetType', 'targetId', 'result', 'reason']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push([
      new Date(row.createdAt).toISOString(),
      csvEscape(row.actorUserId ?? ''),
      csvEscape(row.action),
      csvEscape(row.targetType ?? ''),
      csvEscape(row.targetId ?? ''),
      row.result,
      csvEscape(row.reason ?? ''),
    ].join(','))
  }
  await AuditRepository.record({
    tenantId,
    actorUserId: userIdOf(req),
    action: 'audit.export',
    targetType: 'audit_logs',
    result: 'success',
    payload: { rows: rows.length },
  }).catch(() => {})
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="audit-${tenantId}-${Date.now()}.csv"`)
  res.send(`\uFEFF${lines.join('\n')}`)
})

governanceRouter.get('/tenants', async (req, res) => {
  res.json(await TenantRepository.findAll())
})

governanceRouter.post('/tenants', async (req, res) => {
  if (await denyNonAdmin(req, res, 'tenant.create')) return
  if (typeof req.body?.name !== 'string' || !req.body.name.trim()) {
    res.status(400).json({ error: 'name 必填' }); return
  }
  const tenant = await TenantRepository.create({ name: req.body.name.trim() })
  await AuditRepository.record({
    tenantId: tenant.id,
    actorUserId: userIdOf(req),
    action: 'tenant.create',
    targetType: 'tenant_profile',
    targetId: tenant.id,
    result: 'success',
  }).catch(() => {})
  res.status(201).json(tenant)
})

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}