import {
  AuditLogRepository,
  CommandConfirmationRepository,
  CommandPermissionRepository,
  WecomUserRepository,
} from '../db/wecom-access-repository.js'
import { logStructured } from '../services/observability.js'
import type { AuditResult, WecomUserRole } from '@wecom-platform/types'
import type { ParsedWecomCommand, WecomCommandKey } from './wecom-command-parser.js'

export type WecomCommandStatus =
  | 'success'
  | 'argument_error'
  | 'unknown_command'
  | 'permission_denied'
  | 'confirmation_required'
  | 'confirmation_error'
  | 'not_found'
  | 'not_implemented'
  | 'system_error'

export interface WecomCommandRuntime {
  botId: string
  chatKey: string
  chatId: string
  userId: string
}

export interface WecomCommandExecutionResult {
  commandKey: WecomCommandKey
  ok: boolean
  status: WecomCommandStatus
  message: string
}

export interface WecomCommandActor {
  wecomUserId: string
  role: WecomUserRole
  mapped: boolean
}

export interface WecomCommandHandlerResult extends WecomCommandExecutionResult {
  auditReason?: string | null
  auditPayload?: Record<string, any>
}

export interface WecomCommandHandlers {
  handle?(command: ParsedWecomCommand, runtime: WecomCommandRuntime, actor: WecomCommandActor): Promise<WecomCommandHandlerResult | null>
}

interface CommandHelpItem {
  commandKey: WecomCommandKey
  usage: string
  description: string
}

const COMMAND_HELP: CommandHelpItem[] = [
  { commandKey: 'help', usage: '/help', description: '查看可用命令' },
  { commandKey: 'ctx.current', usage: '/ctx current', description: '查看当前上下文' },
  { commandKey: 'ctx.list', usage: '/ctx list', description: '列出可切换上下文' },
  { commandKey: 'ctx.use', usage: '/ctx use <contextId|contextName>', description: '切换当前上下文' },
  { commandKey: 'ctx.reset', usage: '/ctx reset', description: '恢复默认上下文路由' },
  { commandKey: 'image.generate', usage: '/image <prompt>', description: '创建图片生成任务' },
  { commandKey: 'task.status', usage: '/task status <taskId>', description: '查询生成任务状态' },
  { commandKey: 'task.result', usage: '/task result <taskId>', description: '获取生成任务结果' },
  { commandKey: 'confirm', usage: '/confirm <token>', description: '确认一次管理操作' },
  { commandKey: 'admin.ctx.grant', usage: '/admin ctx grant <wecomUserId> <contextId>', description: '授权用户使用上下文' },
  { commandKey: 'admin.ctx.revoke', usage: '/admin ctx delete <wecomUserId> <contextId>', description: '删除用户可切换上下文' },
  { commandKey: 'admin.user.upsert', usage: '/admin user upsert <wecomUserId> [role]', description: '创建或更新企微用户' },
  { commandKey: 'admin.command.set', usage: '/admin command set <commandKey> <role> <on|off>', description: '调整命令权限' },
]

function validationMessage(command: ParsedWecomCommand): string | null {
  switch (command.commandKey) {
    case 'ctx.use':
      return command.args[0] ? null : '缺少上下文参数。正确格式：/ctx use <contextId|contextName>'
    case 'image.generate':
      return command.args.join(' ').trim() ? null : '缺少图片描述。正确格式：/image <prompt>'
    case 'task.status':
      return command.args[0] ? null : '缺少任务 ID。正确格式：/task status <taskId>'
    case 'task.result':
      return command.args[0] ? null : '缺少任务 ID。正确格式：/task result <taskId>'
    case 'confirm':
      return command.args[0] ? null : '缺少确认令牌。正确格式：/confirm <token>'
    case 'admin.ctx.grant':
      return command.args.length >= 2 ? null : '缺少授权参数。正确格式：/admin ctx grant <wecomUserId> <contextId>'
    case 'admin.ctx.revoke':
      return command.args.length >= 2 ? null : '缺少删除参数。正确格式：/admin ctx delete <wecomUserId> <contextId>'
    case 'admin.user.upsert':
      return command.args[0] ? null : '缺少企微用户 ID。正确格式：/admin user upsert <wecomUserId> [role]'
    case 'admin.command.set':
      return command.args.length >= 3 ? null : '缺少命令权限参数。正确格式：/admin command set <commandKey> <role> <on|off>'
    default:
      return null
  }
}

function auditResultFor(status: WecomCommandStatus): AuditResult {
  if (status === 'success' || status === 'confirmation_required') return 'success'
  if (status === 'permission_denied') return 'denied'
  return 'failure'
}

export class WecomCommandExecutor {
  constructor(private handlers: WecomCommandHandlers = {}) {}

  async execute(command: ParsedWecomCommand, runtime: WecomCommandRuntime): Promise<WecomCommandExecutionResult> {
    try {
      return await this.executeInner(command, runtime)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'system_error' as const,
        message: '命令执行时发生错误，请稍后重试。',
      }
      await this.audit(command, runtime, result.status, reason)
      return result
    }
  }

  private async executeInner(command: ParsedWecomCommand, runtime: WecomCommandRuntime): Promise<WecomCommandExecutionResult> {
    if (!command.isKnown) {
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'unknown_command' as const,
        message: `未知命令：/${command.commandText}\n发送 /help 查看可用命令。`,
      }
      await this.audit(command, runtime, result.status, 'unknown_command')
      return result
    }

    const actor = await WecomUserRepository.findByWecomUserId(runtime.botId, runtime.userId)
    if (actor?.status === 'disabled') {
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied' as const,
        message: '你当前无权使用机器人命令，请联系管理员。',
      }
      await this.audit(command, runtime, result.status, 'user_disabled')
      return result
    }

    const role: WecomUserRole = actor?.role ?? 'user'
    const commandActor: WecomCommandActor = {
      wecomUserId: runtime.userId,
      role,
      mapped: Boolean(actor),
    }
    const permission = await CommandPermissionRepository.check(runtime.botId, command.commandKey, role)
    if (!permission.allowed) {
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'permission_denied' as const,
        message: '你没有执行该命令的权限。',
      }
      await this.audit(command, runtime, result.status, 'command_permission_denied', { role })
      return result
    }

    const invalid = validationMessage(command)
    if (invalid) {
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'argument_error' as const,
        message: invalid,
      }
      await this.audit(command, runtime, result.status, invalid, { role })
      return result
    }

    if (command.commandKey === 'help') {
      const result = {
        commandKey: command.commandKey,
        ok: true,
        status: 'success' as const,
        message: await this.helpMessage(runtime.botId, role),
      }
      await this.audit(command, runtime, result.status, null, { role })
      return result
    }

    if (command.commandKey === 'confirm') {
      return this.confirm(command, runtime, role)
    }

    const handled = await this.handlers.handle?.(command, runtime, commandActor)
    if (handled) {
      await this.audit(command, runtime, handled.status, handled.auditReason ?? null, {
        role,
        ...(handled.auditPayload ?? {}),
      })
      return {
        commandKey: handled.commandKey,
        ok: handled.ok,
        status: handled.status,
        message: handled.message,
      }
    }

    if (permission.requireConfirm || command.commandKey.startsWith('admin.')) {
      const confirmation = await CommandConfirmationRepository.create({
        botId: runtime.botId,
        chatKey: runtime.chatKey,
        chatId: runtime.chatId,
        wecomUserId: runtime.userId,
        commandKey: command.commandKey,
        payload: { raw: command.raw, args: command.args },
      })
      const result = {
        commandKey: command.commandKey,
        ok: true,
        status: 'confirmation_required' as const,
        message: [
          '该操作需要二次确认，确认前不会写入任何变更。',
          `命令：/${command.commandText}`,
          `确认命令：/confirm ${confirmation.token}`,
          '令牌 5 分钟内有效，仅原操作人可确认。',
        ].join('\n'),
      }
      await this.audit(command, runtime, result.status, null, { role, confirmationId: confirmation.id })
      return result
    }

    const result = {
      commandKey: command.commandKey,
      ok: false,
      status: 'not_implemented' as const,
      message: '命令已识别，具体业务能力将在后续迭代接入。',
    }
    await this.audit(command, runtime, result.status, 'not_implemented', { role })
    return result
  }

  private async confirm(command: ParsedWecomCommand, runtime: WecomCommandRuntime, role: WecomUserRole): Promise<WecomCommandExecutionResult> {
    const token = command.args[0]
    const consumed = await CommandConfirmationRepository.consume(token, runtime.userId)
    if (consumed.error) {
      const message = consumed.error === 'expired'
        ? '确认令牌已过期，请重新发起操作。'
        : consumed.error === 'actor_mismatch'
          ? '确认人与原操作人不一致，已拒绝执行。'
          : consumed.error === 'consumed'
            ? '确认令牌已被使用。'
            : '确认令牌不存在。'
      const result = {
        commandKey: command.commandKey,
        ok: false,
        status: 'confirmation_error' as const,
        message,
      }
      await this.audit(command, runtime, result.status, consumed.error, { role, token })
      return result
    }

    const result = {
      commandKey: command.commandKey,
      ok: true,
      status: 'success' as const,
      message: '确认已通过，具体管理操作将在对应业务命令接入后执行。',
    }
    await this.audit(command, runtime, result.status, null, {
      role,
      token,
      confirmedCommandKey: consumed.confirmation?.commandKey,
    })
    return result
  }

  private async helpMessage(botId: string, role: WecomUserRole): Promise<string> {
    const visible: CommandHelpItem[] = []
    for (const item of COMMAND_HELP) {
      const permission = await CommandPermissionRepository.check(botId, item.commandKey, role)
      if (permission.allowed) visible.push(item)
    }
    if (visible.length === 0) return '当前没有可用命令。'
    return [
      '可用命令：',
      ...visible.map((item) => `${item.usage} - ${item.description}`),
    ].join('\n')
  }

  private async audit(
    command: ParsedWecomCommand,
    runtime: WecomCommandRuntime,
    status: WecomCommandStatus,
    reason?: string | null,
    extraPayload: Record<string, any> = {}
  ): Promise<void> {
    logStructured('wecom.command', {
      botId: runtime.botId,
      chatKey: runtime.chatKey,
      actorUserId: runtime.userId,
      commandKey: command.commandKey,
      status,
      reason: reason ?? null,
    })
    await AuditLogRepository.create({
      botId: runtime.botId,
      actorUserId: runtime.userId,
      chatKey: runtime.chatKey,
      action: command.commandKey === 'unknown' ? 'command.unknown' : command.commandKey,
      targetType: targetTypeFor(command.commandKey),
      targetId: command.args[0] ?? null,
      result: auditResultFor(status),
      reason: reason ?? null,
      payload: {
        raw: command.raw,
        args: command.args,
        status,
        ...extraPayload,
      },
    })
  }
}

function targetTypeFor(commandKey: WecomCommandKey): string | null {
  if (commandKey.startsWith('ctx.') || commandKey.startsWith('admin.ctx.')) return 'context'
  if (commandKey.startsWith('task.')) return 'generation_task'
  if (commandKey === 'image.generate') return 'generation_task'
  if (commandKey.startsWith('admin.user.')) return 'wecom_user'
  if (commandKey.startsWith('admin.command.')) return 'command_permission'
  if (commandKey === 'confirm') return 'command_confirmation'
  return null
}
