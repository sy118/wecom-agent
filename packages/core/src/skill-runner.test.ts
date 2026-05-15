import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import type { SkillAuditRecord, SkillConfig, SkillDefinition } from '@wecom-platform/types'
import {
  __testResetSkillConcurrency,
  appendSkillPrompts,
  buildSkillPromptAdditions,
  createSkillTools,
  executeSkillScript,
} from './skill-runner.js'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-skill-runner-'))
const previousScriptsEnabled = process.env.SKILL_SCRIPTS_ENABLED

after(async () => {
  __testResetSkillConcurrency()
  if (previousScriptsEnabled === undefined) delete process.env.SKILL_SCRIPTS_ENABLED
  else process.env.SKILL_SCRIPTS_ENABLED = previousScriptsEnabled
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

function enableScripts(): void {
  process.env.SKILL_SCRIPTS_ENABLED = 'true'
  __testResetSkillConcurrency()
}

async function makeBundle(name: string, skillMd: string, scripts: Record<string, string> = {}) {
  const bundlePath = join(tempDir, name)
  await mkdir(bundlePath, { recursive: true })
  await writeFile(join(bundlePath, 'SKILL.md'), skillMd)
  for (const [path, content] of Object.entries(scripts)) {
    const fullPath = join(bundlePath, ...path.split('/'))
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, content)
  }
  return bundlePath
}

function makeSkill(id: string, bundlePath: string, scripts: string[] = [], overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id,
    botId: 'bot-1',
    name: id,
    description: `${id} description`,
    enabled: true,
    bundlePath,
    bundleHash: `${id}-hash`,
    metadata: { name: id, description: `${id} description` },
    resourceIndex: {
      skillMdPath: 'SKILL.md',
      scripts,
      references: [],
      assets: [],
      otherFiles: [],
      totalFiles: scripts.length + 1,
      totalBytes: 1,
    },
    permissionPolicy: {
      scriptsEnabled: true,
      timeoutMs: 500,
      maxOutputBytes: 1024,
      maxConcurrentRuns: 1,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeConfig(skillId: string, params: Record<string, unknown> = {}, forceUse = false): SkillConfig {
  return { skillId, enabled: true, params, forceUse }
}

function makeAuditContext(records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[]) {
  return {
    botId: 'bot-1',
    contextId: 'context-1',
    chatKey: 'chat-1',
    content: 'hello from chat',
    audit: (record: Omit<SkillAuditRecord, 'id' | 'createdAt'>) => {
      records.push(record)
    },
  }
}

test('Skill prompt additions list metadata and load SKILL.md for explicit trigger', async () => {
  const bundlePath = await makeBundle('policy', `---
name: policy
description: Use policy checks.
---

# Policy Skill

Follow policy checks.
`)
  const skill = makeSkill('policy', bundlePath)
  const additions = buildSkillPromptAdditions([skill], [makeConfig('policy')], 'please use $policy')
  const systemPrompt = appendSkillPrompts('Base prompt', additions)

  assert.match(additions, /Available Skills/)
  assert.match(additions, /\$policy: policy description/)
  assert.match(systemPrompt, /Loaded Skill: \$policy/)
  assert.match(systemPrompt, /Follow policy checks/)
})

test('Skill prompt additions load SKILL.md when forceUse is enabled', async () => {
  const bundlePath = await makeBundle('forced', `---
name: forced
description: Always load this.
---

Forced guidance.
`)
  const skill = makeSkill('forced', bundlePath)
  const additions = buildSkillPromptAdditions([skill], [makeConfig('forced', {}, true)], 'ordinary message')

  assert.match(additions, /Forced guidance/)
})

test('createSkillTools exposes one generic script tool for enabled script bundles', async () => {
  const bundlePath = await makeBundle('tool-skill', '---\nname: tool-skill\ndescription: Has scripts.\n---\n', {
    'scripts/echo.js': "process.stdout.write('ok')\n",
  })
  const records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[] = []
  const tools = createSkillTools(
    [makeSkill('tool-skill', bundlePath, ['scripts/echo.js'])],
    [makeConfig('tool-skill')],
    makeAuditContext(records)
  )

  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'run_skill_script')
})

test('executeSkillScript returns stdout and writes redacted success audit', async () => {
  enableScripts()
  const bundlePath = await makeBundle('success', '---\nname: success\ndescription: Runs.\n---\n', {
    'scripts/success.js': `
let raw = ''
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  const payload = JSON.parse(raw)
  process.stdout.write(JSON.stringify({
    token: payload.params.apiToken,
    query: payload.query
  }))
})
`,
  })
  const records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[] = []
  const result = await executeSkillScript({
    skill: makeSkill('success', bundlePath, ['scripts/success.js']),
    config: makeConfig('success', { apiToken: 'plain-secret' }),
    input: { skillName: 'success', scriptPath: 'scripts/success.js' },
    context: makeAuditContext(records),
  })

  assert.match(result, /plain-secret/)
  assert.equal(records[0].status, 'success')
  assert.equal(records[0].outputPreview?.includes('plain-secret'), false)
  assert.match(records[0].outputPreview ?? '', /\*\*\*\*\*\*/)
})

test('executeSkillScript blocks when scripts are globally disabled', async () => {
  delete process.env.SKILL_SCRIPTS_ENABLED
  const bundlePath = await makeBundle('blocked', '---\nname: blocked\ndescription: Blocked.\n---\n', {
    'scripts/blocked.js': "process.stdout.write('should not run')\n",
  })
  const records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[] = []
  const result = await executeSkillScript({
    skill: makeSkill('blocked', bundlePath, ['scripts/blocked.js']),
    config: makeConfig('blocked'),
    input: { skillName: 'blocked', scriptPath: 'scripts/blocked.js' },
    context: makeAuditContext(records),
  })

  assert.match(result, /disabled globally/)
  assert.equal(records[0].status, 'blocked')
})

test('executeSkillScript times out long-running scripts', async () => {
  enableScripts()
  const bundlePath = await makeBundle('timeout', '---\nname: timeout\ndescription: Slow.\n---\n', {
    'scripts/timeout.js': 'setTimeout(() => {}, 2000)\n',
  })
  const records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[] = []
  const result = await executeSkillScript({
    skill: makeSkill('timeout', bundlePath, ['scripts/timeout.js'], { permissionPolicy: { scriptsEnabled: true, timeoutMs: 50 } }),
    config: makeConfig('timeout'),
    input: { skillName: 'timeout', scriptPath: 'scripts/timeout.js' },
    context: makeAuditContext(records),
  })

  assert.equal(result, '[Skill timeout] timeout')
  assert.equal(records[0].status, 'timeout')
})

test('executeSkillScript truncates output larger than policy maxOutputBytes', async () => {
  enableScripts()
  const bundlePath = await makeBundle('truncated', '---\nname: truncated\ndescription: Large.\n---\n', {
    'scripts/truncated.js': "process.stdout.write('abcdefghijklmnopqrstuvwxyz')\n",
  })
  const records: Omit<SkillAuditRecord, 'id' | 'createdAt'>[] = []
  const result = await executeSkillScript({
    skill: makeSkill('truncated', bundlePath, ['scripts/truncated.js'], { permissionPolicy: { scriptsEnabled: true, maxOutputBytes: 8 } }),
    config: makeConfig('truncated'),
    input: { skillName: 'truncated', scriptPath: 'scripts/truncated.js' },
    context: makeAuditContext(records),
  })

  assert.equal(result, 'abcdefgh\n[output truncated]')
  assert.equal(records[0].status, 'success')
  assert.equal(records[0].outputPreview, 'abcdefgh\n[output truncated]')
})
