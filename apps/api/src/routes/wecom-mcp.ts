import { Router } from 'express'
import { WecomMcpService, WECOM_MCP_TOOL_CATALOG } from '../services/wecom-mcp-service.js'
import { ApprovalRepository } from '../db/approval-repository.js'
import { WecomMcpToolRepository } from '../db/wecom-mcp-tool-repository.js'
import { resolveTenantId } from '../db/tenant-repository.js'

export const wecomMcpRouter: Router = Router()

const service = new WecomMcpService()

function tenantOf(req: { headers: Record<string, any> }): string {
  const raw = req.headers['x-tenant-id']
  return resolveTenantId(raw)
}

wecomMcpRouter.get('/catalog', (_req, res) => {
  res.json(WECOM_MCP_TOOL_CATALOG)
})

wecomMcpRouter.get('/tools', async (req, res) => {
  res.json(await service.listTools(tenantOf(req)))
})

wecomMcpRouter.post('/register', async (req, res) => {
  const tools = await service.ensureRegistered(tenantOf(req))
  res.json({ ok: true, tools })
})

wecomMcpRouter.post('/tools/:module/:name/invoke', async (req, res) => {
  const tenantId = tenantOf(req)
  const actorUserId = typeof req.body?.actorUserId === 'string' ? req.body.actorUserId : null
  const params = req.body?.params && typeof req.body.params === 'object' ? req.body.params : {}
  const result = await service.checkAndInvoke(req.params.module, req.params.name, {
    tenantId,
    actorUserId,
    botId: typeof req.body?.botId === 'string' ? req.body.botId : null,
    runId: typeof req.body?.runId === 'string' ? req.body.runId : null,
    params,
  })
  res.json(result)
})

wecomMcpRouter.post('/tools/:module/:name/enable', async (req, res) => {
  const tenantId = tenantOf(req)
  const enabled = Boolean(req.body?.enabled)
  const tool = await WecomMcpToolRepository.findByModuleAndName(tenantId, req.params.module, req.params.name)
  if (!tool) { res.status(404).json({ error: '工具不存在' }); return }
  await WecomMcpToolRepository.setEnabled(tenantId, req.params.module, req.params.name, enabled)
  res.json({ ok: true, enabled })
})

wecomMcpRouter.get('/approvals', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'pending'
  res.json(await ApprovalRepository.findByTenant(tenantOf(req), status as any))
})

wecomMcpRouter.post('/approvals/:id/decide', async (req, res) => {
  const decision = req.body?.decision
  const approverUserId = typeof req.body?.approverUserId === 'string' ? req.body.approverUserId : null
  if (decision !== 'approved' && decision !== 'rejected') {
    res.status(400).json({ error: 'decision 必须是 approved 或 rejected' }); return
  }
  if (!approverUserId) { res.status(400).json({ error: 'approverUserId 必填' }); return }
  const approval = await service.decideApproval(req.params.id, decision, approverUserId, req.body?.reason ?? null)
  if (!approval) { res.status(404).json({ error: '审批请求不存在或已处理' }); return }
  res.json(approval)
})

wecomMcpRouter.post('/expire-overdue', async (req, res) => {
  const expired = await service.expireOverdue(tenantOf(req))
  res.json({ ok: true, expired: expired.length })
})
