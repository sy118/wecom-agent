import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'
import type { SkillDefinition } from '@wecom-platform/types'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-api-skill-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.SKILL_STORAGE_ROOT = join(tempDir, 'skills')
process.env.DEFAULT_SESSION_TTL_MIN = '45'

const [{ db, initDb }, { BotRepository }, { SkillRepository }, { SkillAuditRepository }, { BindingRepository }, { skillsRouter }, { contextsRouter }, { bindingsRouter }, { settingsRouter }] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/skill-repository.js'),
  import('../db/skill-audit-repository.js'),
  import('../db/binding-repository.js'),
  import('./skills.js'),
  import('./contexts.js'),
  import('./bindings.js'),
  import('./settings.js'),
])

let server: Server
let baseUrl = ''

before(async () => {
  await initDb()
  const app = express()
  app.use(express.json())
  app.use('/api/skills', skillsRouter)
  app.use('/api/settings', settingsRouter)
  app.use('/api/bots/:botId/contexts', contextsRouter)
  app.use('/api/bots/:botId/bindings', bindingsRouter)
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function createBot(name: string) {
  return BotRepository.create({
    name,
    wecomBotId: `${name}-wecom-id`,
    wecomBotSecret: 'wecom-secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'test-model',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
}

async function requestJson(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = response.status === 204 ? null : await response.json()
  return { response, body }
}

function appendSkillFile(form: FormData, path: string, content: string) {
  form.append('files', new Blob([content], { type: 'text/plain' }), path)
}

async function uploadSkill(name: string) {
  const form = new FormData()
  appendSkillFile(form, `${name}/SKILL.md`, `---
name: ${name}
description: ${name} description
---

# ${name}
`)
  appendSkillFile(form, `${name}/scripts/echo.js`, "process.stdout.write('ok')\n")
  const response = await fetch(`${baseUrl}/api/skills/upload`, { method: 'POST', body: form })
  return { response, body: await response.json() }
}

async function createBundleSkill(botId: string, name: string): Promise<SkillDefinition> {
  const bundlePath = join(tempDir, 'manual-skills', botId, name)
  await mkdir(bundlePath, { recursive: true })
  await writeFile(join(bundlePath, 'SKILL.md'), `---
name: ${name}
description: ${name} description
---
`)
  return SkillRepository.create({
    botId,
    name,
    description: `${name} description`,
    enabled: true,
    bundlePath,
    bundleHash: `${name}-hash`,
    metadata: { name, description: `${name} description` },
    resourceIndex: {
      skillMdPath: 'SKILL.md',
      scripts: [],
      references: [],
      assets: [],
      otherFiles: [],
      totalFiles: 1,
      totalBytes: 1,
    },
    permissionPolicy: {},
  })
}

test('SkillRepository persists bundle skills and skill audit logs', async () => {
  const bot = await createBot('repo-bot')
  const skill = await createBundleSkill(bot.id, 'repo-skill')

  const found = await SkillRepository.findById(skill.id)
  assert.equal(found?.metadata.name, 'repo-skill')

  const updated = await SkillRepository.update(skill.id, { enabled: false })
  assert.equal(updated?.enabled, false)

  await SkillAuditRepository.create({
    skillId: skill.id,
    botId: bot.id,
    contextId: 'context-1',
    chatKey: 'chat-1',
    status: 'success',
    durationMs: 12,
    inputPreview: '{"query":"hello"}',
    outputPreview: 'ok',
    error: null,
  })
  const audits = await SkillAuditRepository.findBySkillId(skill.id)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].status, 'success')
})

test('SkillRepository normalizes legacy Skill rows with empty bundle JSON', async () => {
  const bot = await createBot('legacy-skill-bot')
  const now = Date.now()
  await db.execute({
    sql: `INSERT INTO skills
            (id, bot_id, name, description, enabled, bundle_path, bundle_hash,
             metadata_json, resource_index_json, permission_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, NULL, NULL, '{}', '{}', '{}', ?, ?)`,
    args: ['legacy-skill', bot.id, 'legacy-skill', 'Legacy description', now, now],
  })

  const found = await SkillRepository.findById('legacy-skill')
  assert.equal(found?.metadata.name, 'legacy-skill')
  assert.deepEqual(found?.resourceIndex.scripts, [])
  assert.deepEqual(found?.resourceIndex.references, [])
  assert.equal(found?.resourceIndex.skillMdPath, 'SKILL.md')
})

test('Skill upload API installs bundle and previews SKILL.md', async () => {
  const created = await uploadSkill('api-skill')

  assert.equal(created.response.status, 201)
  assert.equal(created.body.name, 'api-skill')
  assert.equal(created.body.resourceIndex.scripts.length, 1)
  assert.equal(created.body.resourceIndex.skillMdPath, 'SKILL.md')

  const preview = await fetch(`${baseUrl}/api/skills/${created.body.id}/skill-md`)
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), /name: api-skill/)

  const updated = await requestJson(`/api/skills/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false, permissionPolicy: { scriptsEnabled: true } }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.enabled, false)
  assert.equal(updated.body.permissionPolicy.scriptsEnabled, true)

  const deleted = await requestJson(`/api/skills/${created.body.id}`, { method: 'DELETE' })
  assert.equal(deleted.response.status, 204)
})

test('Skill upload API accepts SKILL.md with BOM and leading blank lines', async () => {
  const form = new FormData()
  appendSkillFile(form, 'bom-skill/SKILL.md', `\uFEFF

---
name: bom-skill
description: bom skill description
---

# BOM Skill
`)

  const created = await fetch(`${baseUrl}/api/skills/upload`, { method: 'POST', body: form })
  const body = await created.json()

  assert.equal(created.status, 201)
  assert.equal(body.name, 'bom-skill')
  assert.equal(body.description, 'bom skill description')
})

test('Skill upload API rejects missing SKILL.md', async () => {
  const form = new FormData()
  appendSkillFile(form, 'bad/scripts/echo.js', "process.stdout.write('ok')\n")

  const response = await fetch(`${baseUrl}/api/skills/upload`, { method: 'POST', body: form })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.match(body.error, /SKILL\.md/)
})

test('Settings API edits platform default session TTL for future contexts only', async () => {
  const initial = await requestJson('/api/settings')
  assert.equal(initial.response.status, 200)
  assert.equal(initial.body.defaultSessionTtlMin, 45)

  const invalidValues = [0, 1441, 10.5, '30']
  for (const defaultSessionTtlMin of invalidValues) {
    const invalid = await requestJson('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ defaultSessionTtlMin }),
    })
    assert.equal(invalid.response.status, 400)
  }

  const updatedDefault = await requestJson('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultSessionTtlMin: 60 }),
  })
  assert.equal(updatedDefault.response.status, 200)
  assert.equal(updatedDefault.body.defaultSessionTtlMin, 60)

  const persisted = await requestJson('/api/settings')
  assert.equal(persisted.body.defaultSessionTtlMin, 60)

  const bot = await createBot('settings-default-ttl-bot')
  const omitted = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Omitted TTL after setting update',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      isDefault: false,
    }),
  })
  assert.equal(omitted.response.status, 201)
  assert.equal(omitted.body.sessionTtlMin, 60)

  const explicit = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Explicit TTL after setting update',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 12,
      isDefault: false,
    }),
  })
  assert.equal(explicit.response.status, 201)
  assert.equal(explicit.body.sessionTtlMin, 12)

  await requestJson('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultSessionTtlMin: 90 }),
  })
  const existing = await requestJson(`/api/bots/${bot.id}/contexts/${omitted.body.id}`)
  assert.equal(existing.body.sessionTtlMin, 60)
})

test('Context API uses configured default session TTL only when omitted', async () => {
  await requestJson('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultSessionTtlMin: 45 }),
  })
  const bot = await createBot('default-ttl-bot')

  const defaults = await requestJson(`/api/bots/${bot.id}/contexts/defaults`)
  assert.equal(defaults.response.status, 200)
  assert.equal(defaults.body.sessionTtlMin, 45)

  const omitted = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Omitted TTL',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      isDefault: false,
    }),
  })
  assert.equal(omitted.response.status, 201)
  assert.equal(omitted.body.sessionTtlMin, 45)

  const explicit = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Explicit TTL',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 12,
      isDefault: false,
    }),
  })
  assert.equal(explicit.response.status, 201)
  assert.equal(explicit.body.sessionTtlMin, 12)

  const invalid = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Invalid TTL',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 0,
      isDefault: false,
    }),
  })
  assert.equal(invalid.response.status, 400)
})

test('Binding API edits mutable fields and rejects chatKey changes', async () => {
  const bot = await createBot('binding-edit-bot')
  const firstContext = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'First Context',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 30,
      isDefault: false,
    }),
  })
  const secondContext = await requestJson(`/api/bots/${bot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Second Context',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [],
      sessionTtlMin: 30,
      isDefault: false,
    }),
  })
  const created = await requestJson(`/api/bots/${bot.id}/bindings`, {
    method: 'POST',
    body: JSON.stringify({
      chatKey: 'wecom:group:edit-me',
      chatName: 'Before',
      chatType: 'group',
      contextId: firstContext.body.id,
    }),
  })
  assert.equal(created.response.status, 201)

  const updated = await requestJson(`/api/bots/${bot.id}/bindings/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      chatKey: created.body.chatKey,
      chatName: 'After',
      chatType: 'user',
      contextId: secondContext.body.id,
    }),
  })
  assert.equal(updated.response.status, 200)
  assert.equal(updated.body.chatKey, 'wecom:group:edit-me')
  assert.equal(updated.body.chatName, 'After')
  assert.equal(updated.body.chatType, 'user')
  assert.equal(updated.body.contextId, secondContext.body.id)

  const rejectedChatKey = await requestJson(`/api/bots/${bot.id}/bindings/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      chatKey: 'wecom:group:changed',
      chatName: 'After',
      chatType: 'group',
      contextId: secondContext.body.id,
    }),
  })
  assert.equal(rejectedChatKey.response.status, 400)

  const rejectedContext = await requestJson(`/api/bots/${bot.id}/bindings/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      chatName: 'After',
      chatType: 'group',
      contextId: 'missing-context',
    }),
  })
  assert.equal(rejectedContext.response.status, 400)

  assert.equal((await BindingRepository.findById(bot.id, created.body.id))?.chatKey, 'wecom:group:edit-me')
})

test('Context API accepts global skillConfigs and masks sensitive params in responses', async () => {
  const ownerBot = await createBot('context-owner')
  const otherBot = await createBot('context-other')
  const ownerSkill = await createBundleSkill(ownerBot.id, 'owner-skill')
  const foreignSkill = await createBundleSkill(otherBot.id, 'foreign-skill')

  const rejected = await requestJson(`/api/bots/${ownerBot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Bad Context',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [{ skillId: 'missing-skill', enabled: true, params: {} }],
      sessionTtlMin: 30,
      isDefault: false,
    }),
  })
  assert.equal(rejected.response.status, 400)
  assert.match(rejected.body.error, /Invalid skillId/)

  const created = await requestJson(`/api/bots/${ownerBot.id}/contexts`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Good Context',
      systemPrompt: 'Base',
      mcpConfigs: [],
      skillConfigs: [
        { skillId: ownerSkill.id, enabled: true, forceUse: true, params: { apiToken: 'plain-token', visible: 'ok' } },
        { skillId: foreignSkill.id, enabled: true, params: {} },
      ],
      sessionTtlMin: 30,
      isDefault: false,
    }),
  })
  assert.equal(created.response.status, 201)
  assert.equal(created.body.skillConfigs[0].forceUse, true)
  assert.equal(created.body.skillConfigs[0].params.apiToken, '******')
  assert.equal(created.body.skillConfigs[0].params.visible, 'ok')
  assert.equal(created.body.skillConfigs[1].skillId, foreignSkill.id)

  const listed = await requestJson(`/api/bots/${ownerBot.id}/contexts`)
  assert.equal(listed.response.status, 200)
  assert.equal(listed.body[0].skillConfigs[0].params.apiToken, '******')
})
