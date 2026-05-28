import type { IncomingContent } from '@wecom-platform/types'

export type WecomCommandKey =
  | 'help'
  | 'ctx.current'
  | 'ctx.list'
  | 'ctx.use'
  | 'ctx.reset'
  | 'image.generate'
  | 'task.status'
  | 'task.result'
  | 'admin.ctx.grant'
  | 'admin.ctx.revoke'
  | 'admin.user.upsert'
  | 'admin.command.set'
  | 'confirm'
  | 'unknown'

export interface ParsedWecomCommand {
  raw: string
  commandText: string
  commandKey: WecomCommandKey
  base: string
  subcommand: string | null
  args: string[]
  isKnown: boolean
}

function contentToCommandText(content: string | IncomingContent[]): string | null {
  if (typeof content === 'string') return content.trim()
  const firstText = content.find((item) => item.type === 'text') as { type: 'text'; text: string } | undefined
  return firstText?.text.trim() ?? null
}

export function splitCommandArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of input.trim()) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (current) args.push(current)
  return args
}

export function parseWecomCommand(content: string | IncomingContent[]): ParsedWecomCommand | null {
  const text = contentToCommandText(content)
  if (!text?.startsWith('/')) return null

  const tokens = splitCommandArgs(text.slice(1))
  const base = (tokens.shift() ?? '').toLowerCase()
  const subcommand = tokens[0]?.toLowerCase() ?? null
  let commandKey: WecomCommandKey = 'unknown'
  let args = tokens

  if (base === 'help' || base === '?') {
    commandKey = 'help'
    args = tokens
  } else if (base === 'ctx') {
    const action = subcommand ?? 'current'
    args = subcommand ? tokens.slice(1) : []
    if (action === 'current') commandKey = 'ctx.current'
    else if (action === 'list') commandKey = 'ctx.list'
    else if (action === 'use') commandKey = 'ctx.use'
    else if (action === 'reset') commandKey = 'ctx.reset'
  } else if (base === 'image') {
    commandKey = 'image.generate'
    args = tokens
  } else if (base === 'task') {
    const action = subcommand ?? ''
    args = tokens.slice(1)
    if (action === 'status') commandKey = 'task.status'
    else if (action === 'result') commandKey = 'task.result'
  } else if (base === 'confirm') {
    commandKey = 'confirm'
    args = tokens
  } else if (base === 'admin') {
    const domain = tokens[0]?.toLowerCase()
    const action = tokens[1]?.toLowerCase()
    args = tokens.slice(2)
    if (domain === 'ctx' && action === 'grant') commandKey = 'admin.ctx.grant'
    else if (domain === 'ctx' && (action === 'delete' || action === 'revoke')) commandKey = 'admin.ctx.revoke'
    else if (domain === 'user' && action === 'upsert') commandKey = 'admin.user.upsert'
    else if (domain === 'command' && action === 'set') commandKey = 'admin.command.set'
  }

  return {
    raw: text,
    commandText: text.slice(1),
    commandKey,
    base,
    subcommand,
    args,
    isKnown: commandKey !== 'unknown',
  }
}
