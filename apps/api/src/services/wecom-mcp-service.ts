import { execFile } from 'child_process'
import { promisify } from 'util'
import { ApprovalRepository } from '../db/approval-repository.js'
import { AuditRepository } from '../db/audit-repository.js'
import { WecomMcpToolRepository } from '../db/wecom-mcp-tool-repository.js'
import type { ApprovalRequest, WecomMcpToolMetadata } from '@wecom-platform/types'

const execFileAsync = promisify(execFile)

export interface WecomMcpToolDefinition {
  module: string
  name: string
  description: string
  scope: string
  write: boolean
  approvalRequired: boolean
}

export interface McpInvokeContext {
  tenantId: string
  actorUserId: string | null
  botId?: string | null
  runId?: string | null
  params: Record<string, any>
}

export type McpInvokeStatus = 'ok' | 'denied' | 'pending_approval' | 'expired' | 'not_configured' | 'error'

export interface McpInvokeResult {
  ok: boolean
  status: McpInvokeStatus
  approvalId?: string
  output?: unknown
  reason?: string
}

export type WecomMcpExecutor = (tool: WecomMcpToolMetadata, params: Record<string, any>) => Promise<unknown>

const SENSITIVE_PARAM_KEYS = new Set(['token', 'secret', 'password', 'aeskey', 'cookie', 'authorization'])

/** 企微 5.0.10 CLI+MCP 支持模块的工具注册清单（scope=read/write，写操作默认需审批）。 */
export const WECOM_MCP_TOOL_CATALOG: WecomMcpToolDefinition[] = [
  { module: '文档', name: 'doc.list', description: '列出文档', scope: 'doc:read', write: false, approvalRequired: false },
  { module: '文档', name: 'doc.create', description: '创建文档', scope: 'doc:write', write: true, approvalRequired: true },
  { module: '文档', name: 'doc.edit', description: '编辑文档', scope: 'doc:write', write: true, approvalRequired: true },
  { module: '表格', name: 'sheet.list', description: '列出表格', scope: 'sheet:read', write: false, approvalRequired: false },
  { module: '表格', name: 'sheet.summary', description: '汇总表格数据', scope: 'sheet:read', write: false, approvalRequired: false },
  { module: '表格', name: 'sheet.update', description: '更新表格单元格', scope: 'sheet:write', write: true, approvalRequired: true },
  { module: '邮件', name: 'mail.list', description: '查询邮件', scope: 'mail:read', write: false, approvalRequired: false },
  { module: '邮件', name: 'mail.draft', description: '生成邮件草稿', scope: 'mail:write', write: true, approvalRequired: false },
  { module: '邮件', name: 'mail.send', description: '发送邮件', scope: 'mail:write', write: true, approvalRequired: true },
  { module: '会议', name: 'meeting.list', description: '查询会议', scope: 'meeting:read', write: false, approvalRequired: false },
  { module: '会议', name: 'meeting.create', description: '创建会议', scope: 'meeting:write', write: true, approvalRequired: true },
  { module: '日程', name: 'calendar.list', description: '查询日程', scope: 'calendar:read', write: false, approvalRequired: false },
  { module: '日程', name: 'calendar.remind', description: '创建日程提醒', scope: 'calendar:write', write: true, approvalRequired: true },
  { module: '通讯录', name: 'contact.search', description: '查询通讯录成员', scope: 'contact:read', write: false, approvalRequired: false },
  { module: '通讯录', name: 'contact.detail', description: '查看成员详情', scope: 'contact:read', write: false, approvalRequired: false },
  { module: '通讯录', name: 'contact.update', description: '更新成员资料', scope: 'contact:write', write: true, approvalRequired: true },
  { module: '文件', name: 'file.list', description: '列出文件', scope: 'file:read', write: false, approvalRequired: false },
  { module: '文件', name: 'file.upload', description: '上传文件', scope: 'file:write', write: true, approvalRequired: true },
  { module: '消息', name: 'msg.search', description: '检索消息记录', scope: 'msg:read', write: false, approvalRequired: false },
  { module: '审批', name: 'approval.list', description: '查询审批记录', scope: 'approval:read', write: false, approvalRequired: false },
  { module: '客户', name: 'crm.search', description: '查询客户信息', scope: 'crm:read', write: false, approvalRequired: false },
]

function configuredModules(): Set<string> {
  const raw = process.env.WECOM_CLI_MCP_MODULES
  if (!raw) return new Set(WECOM_MCP_TOOL_CATALOG.map((tool) => tool.module))
  return new Set(raw.split(',').map((m) => m.trim()).filter(Boolean))
}

function configuredBoolean(envKey: string, fallback: boolean): boolean {
  const raw = process.env[envKey]
  if (raw === undefined || raw === '') return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

function maskParams(params: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    result[key] = SENSITIVE_PARAM_KEYS.has(key.toLowerCase()) && value !== undefined ? '***' : value
  }
  return result
}

async function defaultExecutor(tool: WecomMcpToolMetadata, params: Record<string, any>): Promise<unknown> {
  const command = process.env.WECOM_CLI_MCP_COMMAND
  if (!command) {
    const err = new Error('WECOM_CLI_MCP_COMMAND 未配置') as Error & { code?: string }
    err.code = 'NOT_CONFIGURED'
    throw err
  }
  const argv = command.split(/\s+/).filter(Boolean)
  const bin = argv[0]
  const baseArgs = argv.slice(1)
  const args = [...baseArgs, '--module', tool.module, '--tool', tool.name, '--json', JSON.stringify(params)]
  const { stdout } = await execFileAsync(bin, args, { timeout: 30_000 })
  try {
    return JSON.parse(stdout)
  } catch {
    return { raw: stdout.slice(0, 4000) }
  }
}

export class WecomMcpService {
  private executor: WecomMcpExecutor

  constructor(executor?: WecomMcpExecutor) {
    this.executor = executor ?? defaultExecutor
  }

  /** 按配置授权模块注册/刷新工具元数据；未启用的模块不暴露任何工具。 */
  async ensureRegistered(tenantId: string): Promise<WecomMcpToolMetadata[]> {
    const enabled = configuredBoolean('WECOM_CLI_MCP_ENABLED', false)
    if (!enabled) return this.listTools(tenantId)
    const allowedModules = configuredModules()
    for (const def of WECOM_MCP_TOOL_CATALOG) {
      if (!allowedModules.has(def.module)) continue
      await WecomMcpToolRepository.upsert({
        module: def.module,
        name: def.name,
        description: def.description,
        scope: def.scope,
        write: def.write,
        approvalRequired: def.approvalRequired,
        enabled: true,
        tenantId,
        expiresAt: null,
      })
    }
    return this.listTools(tenantId)
  }

  async listTools(tenantId: string): Promise<WecomMcpToolMetadata[]> {
    return WecomMcpToolRepository.findByTenant(tenantId)
  }

  async expireOverdue(tenantId: string, now = Date.now()): Promise<WecomMcpToolMetadata[]> {
    return WecomMcpToolRepository.expireDueAuthorizations(now)
  }

  /** 调用前统一策略：租户隔离 + 有效期 + 启用状态 + 写操作审批门。 */
  async checkAndInvoke(module: string, name: string, ctx: McpInvokeContext): Promise<McpInvokeResult> {
    const tool = await WecomMcpToolRepository.findByModuleAndName(ctx.tenantId, module, name)
    if (!tool) {
      await this.audit(ctx, module, name, 'denied', 'tool_not_registered', null)
      return { ok: false, status: 'denied', reason: '工具未注册或不属于当前租户' }
    }
    if (tool.expiresAt && tool.expiresAt < Date.now()) {
      await WecomMcpToolRepository.setEnabled(ctx.tenantId, module, name, false)
      await this.audit(ctx, module, name, 'denied', 'authorization_expired', null)
      return { ok: false, status: 'expired', reason: '授权已过期，请重新授权' }
    }
    if (!tool.enabled) {
      await this.audit(ctx, module, name, 'denied', 'tool_disabled', null)
      return { ok: false, status: 'denied', reason: '工具已停用' }
    }

    const approvalGate = configuredBoolean('APPROVAL_GATE_ENABLED', false)
    if (tool.write && tool.approvalRequired && approvalGate) {
      const approval = await ApprovalRepository.create({
        runId: ctx.runId ?? null,
        tenantId: ctx.tenantId,
        botId: ctx.botId ?? null,
        toolName: name,
        scope: tool.scope,
        requesterUserId: ctx.actorUserId,
      })
      await this.audit(ctx, module, name, 'success', 'approval_required', approval.id)
      return { ok: false, status: 'pending_approval', approvalId: approval.id, reason: '写操作需要审批，已挂起等待审批人处理' }
    }

    try {
      const output = await this.executor(tool, ctx.params)
      await this.audit(ctx, module, name, 'success', 'executed', null, output)
      return { ok: true, status: 'ok', output }
    } catch (err) {
      const code = (err as Error & { code?: string })?.code
      if (code === 'NOT_CONFIGURED') {
        await this.audit(ctx, module, name, 'failure', 'not_configured', null)
        return { ok: false, status: 'not_configured', reason: '企微 CLI 尚未配置' }
      }
      const message = err instanceof Error ? err.message : String(err)
      await this.audit(ctx, module, name, 'failure', message, null)
      return { ok: false, status: 'error', reason: message }
    }
  }

  async decideApproval(approvalId: string, decision: 'approved' | 'rejected', approverUserId: string, reason?: string | null): Promise<ApprovalRequest | null> {
    const approval = await ApprovalRepository.findById(approvalId)
    if (!approval) return null
    const decided = await ApprovalRepository.decide(approvalId, { status: decision, approverUserId, reason })
    await AuditRepository.record({
      tenantId: approval.tenantId,
      actorUserId: approverUserId,
      botId: approval.botId ?? undefined,
      action: `approval.${decision}`,
      targetType: 'approval_request',
      targetId: approvalId,
      result: 'success',
      reason: reason ?? null,
      payload: { toolName: approval.toolName, scope: approval.scope },
    }).catch(() => {})
    return decided
  }

  private async audit(
    ctx: McpInvokeContext,
    module: string,
    name: string,
    result: 'success' | 'failure' | 'denied',
    reason: string | null,
    approvalId: string | null,
    output?: unknown
  ): Promise<void> {
    await AuditRepository.record({
      tenantId: ctx.tenantId,
      actorUserId: ctx.actorUserId,
      botId: ctx.botId ?? undefined,
      action: 'wecom_mcp.invoke',
      targetType: `wecom_mcp:${module}`,
      targetId: name,
      result,
      reason,
      payload: {
        tool: name,
        module,
        approvalId,
        params: maskParams(ctx.params),
        outputPreview: output === undefined ? null : JSON.stringify(output).slice(0, 500),
      },
    }).catch(() => {})
  }
}

export function __testMaskParams(params: Record<string, any>): Record<string, any> {
  return maskParams(params)
}