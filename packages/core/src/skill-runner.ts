import { spawn } from 'child_process'
import { readFileSync } from 'fs'
import { extname, isAbsolute, join, relative, resolve } from 'path'
import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredTool } from '@langchain/core/tools'
import type {
  IncomingContent,
  SkillAuditRecord,
  SkillConfig,
  SkillDefinition,
  SkillPermissionPolicy,
  SkillRuntime,
} from '@wecom-platform/types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_MAX_CONCURRENT_RUNS = 1
const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|credential)/i
const runningBySkill = new Map<string, number>()

export interface SkillRuntimeContext {
  botId: string
  contextId: string | null
  chatKey: string | null
  content?: string | IncomingContent[]
  audit?: (record: Omit<SkillAuditRecord, 'id' | 'createdAt'>) => void | Promise<void>
}

export interface SkillScriptToolInput {
  skillName: string
  scriptPath: string
  args?: string[]
  stdin?: string
}

export interface SkillScriptExecutionInput {
  skill: SkillDefinition
  config: SkillConfig
  input: SkillScriptToolInput
  context: SkillRuntimeContext
}

function contentToText(content: string | IncomingContent[] | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.map((item) => item.type === 'text' ? item.text : `[image: ${item.url}]`).join('\n')
}

function preview(value: unknown, max = 1000): string | null {
  if (value === undefined || value === null) return null
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function collectSecretValues(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const values: string[] = []
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof child === 'string' && child) {
      values.push(child)
      continue
    }
    values.push(...collectSecretValues(child))
  }
  return values
}

function redactString(value: string, secretValues: string[]): string {
  let redacted = value
  for (const secret of secretValues) {
    if (!secret) continue
    redacted = redacted.split(secret).join('******')
  }
  return redacted
}

function redactForAudit(value: unknown, secretValues: string[]): unknown {
  if (typeof value === 'string') return redactString(value, secretValues)
  if (Array.isArray(value)) return value.map((item) => redactForAudit(item, secretValues))
  if (!value || typeof value !== 'object') return value
  const redacted: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      redacted[key] = child === undefined || child === null || child === '' ? child : '******'
    } else {
      redacted[key] = redactForAudit(child, secretValues)
    }
  }
  return redacted
}

function getPolicy(skill: SkillDefinition): Required<Pick<SkillPermissionPolicy, 'timeoutMs' | 'maxOutputBytes' | 'maxConcurrentRuns'>> & SkillPermissionPolicy {
  return {
    ...skill.permissionPolicy,
    timeoutMs: skill.permissionPolicy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: skill.permissionPolicy.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxConcurrentRuns: skill.permissionPolicy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS,
  }
}

function isShellLikePath(value: string): boolean {
  return /[;&|`<>]/.test(value)
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function normalizeRelativeScriptPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
    throw new Error('scriptPath must be a relative path inside the Skill bundle')
  }
  if (/^[a-zA-Z]:/.test(normalized) || isAbsolute(normalized) || isShellLikePath(normalized)) {
    throw new Error('scriptPath must be a plain relative file path')
  }
  return normalized.split('/').filter(Boolean).join('/')
}

function scriptRuntimeForPath(scriptPath: string): SkillRuntime | null {
  const ext = extname(scriptPath).toLowerCase()
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'node'
  if (ext === '.py') return 'python'
  return null
}

function buildEnv(policy: SkillPermissionPolicy): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'COMSPEC']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  for (const key of policy.allowedEnvKeys ?? []) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  return env
}

async function writeAudit(
  context: SkillRuntimeContext,
  skill: SkillDefinition,
  config: SkillConfig,
  status: SkillAuditRecord['status'],
  durationMs: number,
  input: unknown,
  output: string | null,
  error: string | null
): Promise<void> {
  try {
    const secretValues = collectSecretValues(config.params ?? {})
    await context.audit?.({
      skillId: skill.id,
      botId: context.botId,
      contextId: context.contextId,
      chatKey: context.chatKey,
      status,
      durationMs,
      inputPreview: preview(redactForAudit(input, secretValues)),
      outputPreview: preview(redactForAudit(output, secretValues)),
      error: preview(redactForAudit(error, secretValues)),
    })
  } catch (err) {
    console.error('[SkillRunner] Failed to write audit log:', err)
  }
}

function makeBlockedResult(message: string): string {
  return `[Skill blocked] ${message}`
}

export function getEnabledSkillEntries(skills: SkillDefinition[], configs: SkillConfig[]): Array<{ skill: SkillDefinition; config: SkillConfig }> {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const entries: Array<{ skill: SkillDefinition; config: SkillConfig }> = []
  for (const cfg of configs) {
    if (!cfg.enabled) continue
    const skill = byId.get(cfg.skillId)
    if (!skill?.enabled) continue
    entries.push({ skill, config: cfg })
  }
  return entries
}

function isSkillTriggered(skill: SkillDefinition, config: SkillConfig, content: string | IncomingContent[] | undefined): boolean {
  if (config.forceUse || config.forceCall) return true
  const text = contentToText(content).toLowerCase()
  if (!text) return false
  const name = skill.name.toLowerCase()
  return text.includes(`$${name}`) || text.includes(name)
}

function readSkillMd(skill: SkillDefinition): string | null {
  try {
    return readFileSync(join(skill.bundlePath, 'SKILL.md'), 'utf8')
  } catch {
    return null
  }
}

export function buildSkillPromptAdditions(
  skills: SkillDefinition[],
  configs: SkillConfig[],
  content?: string | IncomingContent[]
): string {
  const entries = getEnabledSkillEntries(skills, configs)
  if (entries.length === 0) return ''

  const parts: string[] = [
    '## Available Skills',
    'The following folder-based Skills are enabled for this context. Use a Skill when the user explicitly names it with `$skill-name`, when the task clearly matches its description, or when it is marked for forced use.',
    ...entries.map(({ skill }) => `- $${skill.name}: ${skill.description}`),
  ]

  const loaded: string[] = []
  for (const { skill, config } of entries) {
    if (!isSkillTriggered(skill, config, content)) continue
    const skillMd = readSkillMd(skill)
    if (!skillMd) continue
    loaded.push(`## Loaded Skill: $${skill.name}\n${skillMd.trim()}`)
  }
  if (loaded.length > 0) {
    parts.push('## Loaded Skill Instructions', loaded.join('\n\n'))
  }
  return parts.join('\n\n')
}

export function appendSkillPrompts(systemPrompt: string, additions: string): string {
  if (!additions.trim()) return systemPrompt
  return `${systemPrompt}\n\n# Skill Instructions\n\n${additions}`
}

export async function executeSkillScript({ skill, config, input, context }: SkillScriptExecutionInput): Promise<string> {
  const startedAt = Date.now()
  const policy = getPolicy(skill)

  const globalScriptsEnabled = process.env.SKILL_SCRIPTS_ENABLED === 'true'
  if (!globalScriptsEnabled || !policy.scriptsEnabled) {
    const message = globalScriptsEnabled ? 'Script execution is disabled by policy' : 'Script execution is disabled globally'
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const currentRuns = runningBySkill.get(skill.id) ?? 0
  if (currentRuns >= policy.maxConcurrentRuns) {
    const message = `Concurrency limit reached for skill ${skill.name}`
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  let scriptPath: string
  try {
    scriptPath = normalizeRelativeScriptPath(input.scriptPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid scriptPath'
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  if (!skill.resourceIndex.scripts.includes(scriptPath)) {
    const message = 'scriptPath is not an indexed Skill script'
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const runtime = scriptRuntimeForPath(scriptPath)
  if (!runtime) {
    const message = 'Unsupported script runtime'
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const entry = resolve(skill.bundlePath, ...scriptPath.split('/'))
  if (!isInside(entry, skill.bundlePath)) {
    const message = 'Script entry is outside the Skill bundle'
    await writeAudit(context, skill, config, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  runningBySkill.set(skill.id, currentRuns + 1)
  try {
    const command = runtime === 'node' ? process.execPath : (process.env.PYTHON_BIN ?? 'python')
    const args = Array.isArray(input.args) ? input.args.map(String) : []
    const payload = input.stdin ?? JSON.stringify({
      params: config.params ?? {},
      query: contentToText(context.content),
      skill: { id: skill.id, name: skill.name },
    })

    const output = await new Promise<{ status: SkillAuditRecord['status']; stdout: string; stderr: string }>((resolvePromise) => {
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let timedOut = false
      const child = spawn(command, [entry, ...args], { cwd: skill.bundlePath, env: buildEnv(policy), shell: false, windowsHide: true })
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, policy.timeoutMs)

      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        outputBytes += chunk.length
        const current = target === 'stdout' ? stdout : stderr
        const remaining = policy.maxOutputBytes - Buffer.byteLength(current)
        if (remaining > 0) {
          const next = chunk.toString('utf8').slice(0, remaining)
          if (target === 'stdout') stdout += next
          else stderr += next
        }
      }

      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
      child.on('error', (err) => { stderr += err.message })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (outputBytes > policy.maxOutputBytes) stdout += '\n[output truncated]'
        const status = timedOut ? 'timeout' : code === 0 ? 'success' : 'error'
        resolvePromise({ status, stdout, stderr })
      })
      child.stdin.end(payload)
    })

    const result = output.stdout.trim() || output.stderr.trim() || ''
    const error = output.status === 'success' ? null : (output.stderr.trim() || output.status)
    await writeAudit(context, skill, config, output.status, Date.now() - startedAt, input, result, error)
    if (output.status === 'success') return result || `[Skill ${skill.name}] completed with no output`
    return `[Skill ${output.status}] ${error ?? 'Script execution failed'}`
  } finally {
    const nextRuns = Math.max(0, (runningBySkill.get(skill.id) ?? 1) - 1)
    if (nextRuns === 0) runningBySkill.delete(skill.id)
    else runningBySkill.set(skill.id, nextRuns)
  }
}

export function createSkillTools(
  skills: SkillDefinition[],
  configs: SkillConfig[],
  context: SkillRuntimeContext
): StructuredTool[] {
  const entries = getEnabledSkillEntries(skills, configs).filter(({ skill }) => skill.resourceIndex.scripts.length > 0)
  if (entries.length === 0) return []

  const byName = new Map<string, { skill: SkillDefinition; config: SkillConfig }>()
  for (const entry of entries) {
    byName.set(entry.skill.name, entry)
    byName.set(entry.skill.id, entry)
  }

  return [new DynamicStructuredTool({
    name: 'run_skill_script',
    description: `Run an indexed script from one of the enabled Skill bundles. Enabled skills: ${entries.map(({ skill }) => `$${skill.name}`).join(', ')}.`,
    schema: {
      type: 'object',
      properties: {
        skillName: { type: 'string', description: 'Skill name or id, for example "source-command-opsx-explore".' },
        scriptPath: { type: 'string', description: 'Relative script path inside the Skill bundle, for example "scripts/run.js".' },
        args: { type: 'array', items: { type: 'string' }, description: 'Optional argv strings passed without a shell.' },
        stdin: { type: 'string', description: 'Optional stdin payload. Defaults to JSON containing query, params, and skill.' },
      },
      required: ['skillName', 'scriptPath'],
      additionalProperties: false,
    },
    func: async (rawInput: unknown) => {
      const input = rawInput as SkillScriptToolInput
      const entry = byName.get(input.skillName)
      if (!entry) return makeBlockedResult(`Skill is not enabled for this context: ${input.skillName}`)
      return executeSkillScript({ skill: entry.skill, config: entry.config, input, context })
    },
  }) as StructuredTool]
}

export function __testResetSkillConcurrency(): void {
  runningBySkill.clear()
}
