import { spawn } from 'child_process'
import { dirname, isAbsolute, relative, resolve } from 'path'
import { DynamicStructuredTool } from '@langchain/core/tools'
import type { StructuredTool } from '@langchain/core/tools'
import type {
  IncomingContent,
  SkillAuditRecord,
  SkillConfig,
  SkillDefinition,
  SkillPermissionPolicy,
  ScriptSkillManifest,
} from '@wecom-platform/types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024
const DEFAULT_MAX_CONCURRENT_RUNS = 1
const runningBySkill = new Map<string, number>()

export interface SkillRuntimeContext {
  botId: string
  contextId: string | null
  chatKey: string | null
  content?: string | IncomingContent[]
  audit?: (record: Omit<SkillAuditRecord, 'id' | 'createdAt'>) => void | Promise<void>
}

export interface ScriptSkillExecutionInput {
  skill: SkillDefinition
  config: SkillConfig
  input: unknown
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

function sanitizeToolName(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'skill'
}

export function buildSkillToolName(skill: SkillDefinition): string {
  const manifest = getScriptManifest(skill)
  const base = sanitizeToolName(manifest?.toolName ?? skill.name)
  const suffix = sanitizeToolName(skill.id).slice(0, 8)
  return `skill_${base}_${suffix}`
}

function getPolicy(skill: SkillDefinition): Required<Pick<SkillPermissionPolicy, 'timeoutMs' | 'maxOutputBytes' | 'maxConcurrentRuns'>> & SkillPermissionPolicy {
  return {
    ...skill.permissionPolicy,
    timeoutMs: skill.permissionPolicy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: skill.permissionPolicy.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxConcurrentRuns: skill.permissionPolicy.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS,
  }
}

function getScriptManifest(skill: SkillDefinition): ScriptSkillManifest | null {
  return skill.type === 'script' && skill.manifest.script ? skill.manifest.script : null
}

function isShellLike(value: string): boolean {
  return /[;&|`<>]/.test(value)
}

function resolveEntry(manifest: ScriptSkillManifest): string {
  const base = manifest.cwd ? resolve(manifest.cwd) : process.cwd()
  return isAbsolute(manifest.entry) ? resolve(manifest.entry) : resolve(base, manifest.entry)
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function validateScriptSkill(skill: SkillDefinition): { manifest?: ScriptSkillManifest; error?: string } {
  const manifest = getScriptManifest(skill)
  if (!manifest) return { error: 'Script skill manifest is missing script configuration' }
  if (manifest.runtime !== 'node' && manifest.runtime !== 'python') return { error: `Unsupported script runtime: ${manifest.runtime}` }
  if (!manifest.entry || isShellLike(manifest.entry)) return { error: 'Script entry must be a plain file path, not a shell command' }
  return { manifest }
}

async function writeAudit(
  context: SkillRuntimeContext,
  skill: SkillDefinition,
  status: SkillAuditRecord['status'],
  durationMs: number,
  input: unknown,
  output: string | null,
  error: string | null
): Promise<void> {
  try {
    await context.audit?.({
      skillId: skill.id,
      botId: context.botId,
      contextId: context.contextId,
      chatKey: context.chatKey,
      status,
      durationMs,
      inputPreview: preview(input),
      outputPreview: preview(output),
      error: preview(error),
    })
  } catch (err) {
    console.error('[SkillRunner] Failed to write audit log:', err)
  }
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

function makeBlockedResult(message: string): string {
  return `[Skill blocked] ${message}`
}

export async function executeScriptSkill({ skill, config, input, context }: ScriptSkillExecutionInput): Promise<string> {
  const startedAt = Date.now()
  const policy = getPolicy(skill)

  if (!policy.scriptsEnabled) {
    const message = 'Script execution is disabled by policy'
    await writeAudit(context, skill, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const validation = validateScriptSkill(skill)
  if (!validation.manifest) {
    const message = validation.error ?? 'Invalid script skill manifest'
    await writeAudit(context, skill, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const currentRuns = runningBySkill.get(skill.id) ?? 0
  if (currentRuns >= policy.maxConcurrentRuns) {
    const message = `Concurrency limit reached for skill ${skill.name}`
    await writeAudit(context, skill, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  const entry = resolveEntry(validation.manifest)
  const allowedReadPaths = policy.allowedReadPaths ?? []
  if (allowedReadPaths.length > 0 && !allowedReadPaths.some((root) => isInside(entry, root))) {
    const message = 'Script entry is outside allowed read paths'
    await writeAudit(context, skill, 'blocked', Date.now() - startedAt, input, null, message)
    return makeBlockedResult(message)
  }

  runningBySkill.set(skill.id, currentRuns + 1)
  try {
    const command = validation.manifest.runtime === 'node' ? process.execPath : (process.env.PYTHON_BIN ?? 'python')
    const cwd = validation.manifest.cwd ? resolve(validation.manifest.cwd) : dirname(entry)
    const payload = JSON.stringify({
      input,
      params: config.params ?? {},
      query: contentToText(context.content),
      skill: { id: skill.id, name: skill.name },
    })

    const output = await new Promise<{ status: SkillAuditRecord['status']; stdout: string; stderr: string }>((resolvePromise) => {
      let stdout = ''
      let stderr = ''
      let outputBytes = 0
      let timedOut = false
      const child = spawn(command, [entry], { cwd, env: buildEnv(policy), shell: false, windowsHide: true })
      const timer = setTimeout(() => {
        timedOut = true
        child.kill()
      }, policy.timeoutMs)

      const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
        outputBytes += chunk.length
        const remaining = policy.maxOutputBytes - (target === 'stdout' ? Buffer.byteLength(stdout) : Buffer.byteLength(stderr))
        if (remaining > 0) {
          const next = chunk.toString('utf8').slice(0, remaining)
          if (target === 'stdout') stdout += next
          else stderr += next
        }
      }

      child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
      child.on('error', (err) => {
        stderr += err.message
      })
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
    await writeAudit(context, skill, output.status, Date.now() - startedAt, input, result, error)
    if (output.status === 'success') return result || `[Skill ${skill.name}] completed with no output`
    return `[Skill ${output.status}] ${error ?? 'Script execution failed'}`
  } finally {
    const nextRuns = Math.max(0, (runningBySkill.get(skill.id) ?? 1) - 1)
    if (nextRuns === 0) runningBySkill.delete(skill.id)
    else runningBySkill.set(skill.id, nextRuns)
  }
}

export function buildSkillPromptAdditions(skills: SkillDefinition[], configs: SkillConfig[]): string {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const parts: string[] = []
  for (const cfg of configs) {
    if (!cfg.enabled) continue
    const skill = byId.get(cfg.skillId)
    if (!skill?.enabled || skill.type !== 'prompt') continue
    const prompt = skill.manifest.prompt?.trim()
    if (!prompt) continue
    parts.push(`## Skill: ${skill.name}\n${prompt}`)
  }
  return parts.join('\n\n')
}

export function appendSkillPrompts(systemPrompt: string, additions: string): string {
  if (!additions.trim()) return systemPrompt
  return `${systemPrompt}\n\n# Skill Instructions\n\n${additions}`
}

export function createSkillTools(
  skills: SkillDefinition[],
  configs: SkillConfig[],
  context: SkillRuntimeContext
): StructuredTool[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const tools: StructuredTool[] = []
  for (const cfg of configs) {
    if (!cfg.enabled) continue
    const skill = byId.get(cfg.skillId)
    const manifest = skill ? getScriptManifest(skill) : null
    if (!skill?.enabled || !manifest) continue
    const schema = manifest.inputSchema ?? {
      type: 'object',
      properties: { query: { type: 'string', description: 'User query or task input' } },
      additionalProperties: true,
    }
    tools.push(new DynamicStructuredTool({
      name: buildSkillToolName(skill),
      description: manifest.description ?? skill.description ?? `${skill.name} skill`,
      schema,
      func: async (input: unknown) => executeScriptSkill({ skill, config: cfg, input, context }),
    }) as StructuredTool)
  }
  return tools
}

export function __testResetSkillConcurrency(): void {
  runningBySkill.clear()
}
