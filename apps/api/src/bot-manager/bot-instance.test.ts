import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import type { StructuredTool } from '@langchain/core/tools'
import type { BotConfig, SkillDefinition } from '@wecom-platform/types'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-bot-instance-'))
process.env.DB_PATH = join(tempDir, 'bot-instance-test.db')

const [
  botInstanceModule,
  { db, initDb },
] = await Promise.all([
  import('./bot-instance.js'),
  import('../db/client.js'),
])

const {
  BotInstance,
  degradeVisionContent,
  getVisionFallbackSessionMessages,
  isVisionFallbackError,
  shouldSkipRuntimeToolsForDify,
} = botInstanceModule

await initDb()

after(async () => {
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

function makeBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: 'bot-1',
    name: 'Bot',
    wecomBotId: 'wecom-bot',
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
    status: 'stopped',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

async function makeSkill(name: string, scripts: string[] = []): Promise<SkillDefinition> {
  const bundlePath = join(tempDir, name)
  await mkdir(bundlePath, { recursive: true })
  await writeFile(join(bundlePath, 'SKILL.md'), `---
name: ${name}
description: ${name} description
---

# ${name}

Use ${name}.
`)
  for (const script of scripts) {
    const fullPath = join(bundlePath, ...script.split('/'))
    await mkdir(join(fullPath, '..'), { recursive: true })
    await writeFile(fullPath, "process.stdout.write('ok')\n")
  }
  return {
    id: name,
    botId: 'bot-1',
    name,
    description: `${name} description`,
    enabled: true,
    bundlePath,
    bundleHash: `${name}-hash`,
    metadata: { name, description: `${name} description` },
    resourceIndex: {
      skillMdPath: 'SKILL.md',
      scripts,
      references: [],
      assets: [],
      otherFiles: [],
      totalFiles: scripts.length + 1,
      totalBytes: 1,
    },
    permissionPolicy: { scriptsEnabled: false },
    createdAt: 1,
    updatedAt: 1,
  }
}

function makeInstance(skills: SkillDefinition[] = []) {
  return new BotInstance({
    bot: makeBot(),
    contexts: [],
    bindings: [],
    mcpServers: [],
    skills,
    db: db as any,
  })
}

test('Vision fallback retries without prior session history', () => {
  const priorMessages = [
    { role: 'human' as const, content: '上一张图是什么?', timestamp: 1 },
    { role: 'ai' as const, content: '这是旧图答案', timestamp: 2 },
  ]

  const fallbackMessages = getVisionFallbackSessionMessages(priorMessages)

  assert.deepEqual(fallbackMessages, [])
  assert.notEqual(fallbackMessages, priorMessages)
})

test('Vision fallback recognizes multimodal rejection status codes', () => {
  assert.equal(isVisionFallbackError({ response: { status: 400 } }), true)
  assert.equal(isVisionFallbackError({ status: 422 }), true)
  assert.equal(isVisionFallbackError({ status: 500 }), false)
})

test('Vision fallback keeps current prompt text and image marker', () => {
  const degraded = degradeVisionContent([
    { type: 'text', text: '识别' },
    { type: 'image', url: 'https://example.invalid/a.jpg' },
  ])

  assert.equal(degraded, '识别\n[图片: https://example.invalid/a.jpg]')
})

test('BotInstance merges MCP and Skill tools with stable conflict suffixes', () => {
  const instance = makeInstance()
  try {
    const mcpTools = [
      { name: 'lookup' },
      { name: 'search' },
    ] as unknown as StructuredTool[]
    const skillTools = [
      { name: 'lookup' },
      { name: 'summarize' },
    ] as unknown as StructuredTool[]

    const merged = (instance as any).mergeTools(mcpTools, skillTools) as StructuredTool[]

    assert.deepEqual(merged.map((tool) => tool.name), ['lookup', 'search', 'lookup_2', 'summarize'])
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance resolves one generic Skill script tool for enabled script bundles', async () => {
  const scriptSkill = await makeSkill('script-skill', ['scripts/echo.js'])
  const docSkill = await makeSkill('doc-skill')
  const instance = makeInstance([scriptSkill, docSkill])
  try {
    const tools = (instance as any).resolveSkillTools(
      [
        { skillId: scriptSkill.id, enabled: true, params: {} },
        { skillId: docSkill.id, enabled: true, params: {} },
      ],
      {
        botId: 'bot-1',
        contextId: 'context-1',
        chatKey: 'chat-1',
        content: 'hello',
      }
    ) as StructuredTool[]

    assert.deepEqual(tools.map((tool) => tool.name), ['run_skill_script'])
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance force-calls Wiki autoSearch policy with namespace', async () => {
  const instance = makeInstance()
  try {
    const calls: any[] = []
    ;(instance as any).toolPool.set('wiki-mcp', [
      {
        name: 'wiki_search',
        invoke: async (input: any) => {
          calls.push(input)
          return 'matched refund.md'
        },
      },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'wiki-mcp',
        enabled: true,
        forceCall: true,
        params: { namespace: 'product', retrievalPolicy: 'autoSearch' },
      },
    ], 'refund policy')

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { query: 'refund policy', namespace: 'product', cross_ns: false })
    assert.match(prompt, /matched refund\.md/)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance force-calls Wiki fixedPage policy with max chars', async () => {
  const instance = makeInstance()
  try {
    const calls: any[] = []
    ;(instance as any).toolPool.set('wiki-mcp', [
      {
        name: 'wiki_read',
        invoke: async (input: any) => {
          calls.push(input)
          return '# SOP'
        },
      },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'wiki-mcp',
        enabled: true,
        params: { namespace: 'product', retrievalPolicy: 'fixedPage', forceCallPage: 'rules/sop.md', maxChars: 1200 },
      },
    ], 'hello')

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { path: 'rules/sop.md', namespace: 'product', max_chars: 1200 })
    assert.match(prompt, /# SOP/)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance skips Wiki manual policy force results', async () => {
  const instance = makeInstance()
  try {
    ;(instance as any).toolPool.set('wiki-mcp', [
      { name: 'wiki_search', invoke: async () => 'should not run' },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'wiki-mcp',
        enabled: true,
        params: { namespace: 'product', retrievalPolicy: 'manual' },
      },
    ], 'hello')

    assert.equal(prompt, 'base prompt')
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance keeps original prompt when Wiki MCP tools are unavailable', async () => {
  const instance = makeInstance()
  try {
    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'wiki-mcp',
        enabled: true,
        params: { namespace: 'product', retrievalPolicy: 'autoSearch' },
      },
    ], 'refund policy')

    assert.equal(prompt, 'base prompt')
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('Dify provider reports runtime tool skip only when runtime configs exist', () => {
  assert.equal(shouldSkipRuntimeToolsForDify('dify', [], []), false)
  assert.equal(shouldSkipRuntimeToolsForDify('dify', [{ mcpServerId: 'mcp-1', enabled: true, params: {} }], []), true)
  assert.equal(shouldSkipRuntimeToolsForDify('dify', [], [{ skillId: 'skill-1', enabled: true, params: {} }]), true)
  assert.equal(shouldSkipRuntimeToolsForDify('openai-compatible', [], [{ skillId: 'skill-1', enabled: true, params: {} }]), false)
})
