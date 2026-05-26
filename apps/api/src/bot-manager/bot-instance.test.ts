import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import type { StructuredTool } from '@langchain/core/tools'
import type { Binding, BotConfig, ContextConfig, McpServerConfig, SkillDefinition } from '@wecom-platform/types'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-bot-instance-'))
process.env.DB_PATH = join(tempDir, 'bot-instance-test.db')

const [
  botInstanceModule,
  { db, initDb },
  { WikiRetrievalLogRepository },
  { BotRepository },
  { BotResponseRunRepository },
] = await Promise.all([
  import('./bot-instance.js'),
  import('../db/client.js'),
  import('../db/wiki-retrieval-log-repository.js'),
  import('../db/bot-repository.js'),
  import('../db/bot-response-run-repository.js'),
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

function makeInstanceForBot(bot: BotConfig, contexts: ContextConfig[] = []) {
  return new BotInstance({
    bot,
    contexts,
    bindings: [],
    mcpServers: [],
    skills: [],
    db: db as any,
  })
}

async function makePersistedBot(overrides: Partial<Omit<BotConfig, 'id' | 'status' | 'createdAt' | 'updatedAt'>> = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return BotRepository.create({
    name: `Bot ${suffix}`,
    wecomBotId: `wecom-${suffix}`,
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
    ...overrides,
  })
}

function makeFakeAdapter() {
  const sent: Array<{ chatId: string; text: string }> = []
  const streams: Array<{ text: string; feedbackId?: string | null; finish?: boolean }> = []
  return {
    sent,
    streams,
    sendMessage: async (chatId: string, text: string) => { sent.push({ chatId, text }) },
    sendThinkingWithStream: async (_frame: any, text: string, feedbackId?: string | null) => {
      streams.push({ text, feedbackId, finish: false })
      return `stream-${streams.length}`
    },
    editMessage: async (_chatId: string, _streamId: string, text: string, finish = true) => {
      streams.push({ text, finish })
    },
  }
}

function makeContext(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return {
    id: 'context-1',
    botId: 'bot-1',
    name: 'Context',
    systemPrompt: 'Base prompt',
    mcpConfigs: [],
    skillConfigs: [],
    sessionTtlMin: 30,
    isDefault: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function makeBinding(overrides: Partial<Binding> = {}): Binding {
  return {
    id: 'binding-1',
    botId: 'bot-1',
    contextId: 'context-1',
    chatKey: 'wecom:group:old',
    chatName: 'Old chat',
    chatType: 'group',
    createdAt: 1,
    ...overrides,
  }
}

function makeMcpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'mcp-1',
    botId: null,
    name: 'mcp-1',
    url: 'http://127.0.0.1:1/sse',
    transportType: 'sse',
    enabled: false,
    paramSchema: [],
    ...overrides,
  }
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

test('BotInstance reloads runtime contexts and bindings', () => {
  const oldContext = makeContext({ id: 'old-context', isDefault: true })
  const oldBinding = makeBinding({ contextId: oldContext.id, chatKey: 'wecom:group:old' })
  const instance = new BotInstance({
    bot: makeBot(),
    contexts: [oldContext],
    bindings: [oldBinding],
    mcpServers: [],
    skills: [],
    db: db as any,
  })
  try {
    assert.equal((instance as any).defaultContext.id, oldContext.id)
    assert.equal((instance as any).bindingMap.get(oldBinding.chatKey), oldContext.id)

    const newContext = makeContext({ id: 'new-context', isDefault: true })
    const newBinding = makeBinding({ id: 'binding-2', contextId: newContext.id, chatKey: 'wecom:group:new' })
    ;(instance as any).discoveredChats.set(newBinding.chatKey, {
      chatKey: newBinding.chatKey,
      chatType: 'group',
      firstSeenAt: 1,
    })

    instance.reloadContexts([newContext])
    instance.reloadBindings([newBinding])

    assert.equal((instance as any).contextMap.has(oldContext.id), false)
    assert.equal((instance as any).defaultContext.id, newContext.id)
    assert.equal((instance as any).bindingMap.get(oldBinding.chatKey), undefined)
    assert.equal((instance as any).bindingMap.get(newBinding.chatKey), newContext.id)
    assert.equal((instance as any).discoveredChats.has(newBinding.chatKey), false)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance reloads runtime Skills and removes disabled entries', async () => {
  const skill = await makeSkill('runtime-skill', ['scripts/echo.js'])
  const instance = makeInstance([])
  try {
    instance.reloadSkills([skill])
    const enabledTools = (instance as any).resolveSkillTools(
      [{ skillId: skill.id, enabled: true, params: {} }],
      {
        botId: 'bot-1',
        contextId: 'context-1',
        chatKey: 'chat-1',
        content: 'hello',
      }
    ) as StructuredTool[]
    assert.deepEqual(enabledTools.map((tool) => tool.name), ['run_skill_script'])

    instance.reloadSkills([{ ...skill, enabled: false }])
    const disabledTools = (instance as any).resolveSkillTools(
      [{ skillId: skill.id, enabled: true, params: {} }],
      {
        botId: 'bot-1',
        contextId: 'context-1',
        chatKey: 'chat-1',
        content: 'hello',
      }
    ) as StructuredTool[]
    assert.deepEqual(disabledTools, [])
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance updates and removes individual runtime bindings', () => {
  const instance = makeInstance()
  try {
    instance.addBinding('wecom:group:runtime', 'context-1')
    assert.equal((instance as any).bindingMap.get('wecom:group:runtime'), 'context-1')

    instance.updateBinding('wecom:group:runtime', 'context-2')
    assert.equal((instance as any).bindingMap.get('wecom:group:runtime'), 'context-2')

    instance.removeBinding('wecom:group:runtime')
    assert.equal((instance as any).bindingMap.has('wecom:group:runtime'), false)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance reloads MCP server pools and drops removed servers', async () => {
  const instance = makeInstance()
  try {
    let closeCalls = 0
    ;(instance as any).toolPool.set('old-mcp', [{ name: 'old_tool' }])
    ;(instance as any).toolClients.set('old-mcp', { close: async () => { closeCalls++ } })

    await instance.reloadMcpServers([makeMcpServer({ id: 'disabled-mcp', enabled: false })])

    assert.equal((instance as any).toolPool.size, 0)
    assert.equal((instance as any).toolClients.size, 0)
    assert.equal(closeCalls, 1)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance keeps previous MCP tools when reload of an enabled server fails', async () => {
  const instance = makeInstance()
  const previousTools = [{ name: 'jira_search' }]
  let closeCalls = 0
  delete process.env.JIRA_PERSONAL_TOKEN
  try {
    ;(instance as any).toolPool.set('jira', previousTools)
    ;(instance as any).toolClients.set('jira', { close: async () => { closeCalls++ } })

    await instance.reloadMcpServers([
      makeMcpServer({
        id: 'jira',
        name: 'jira',
        enabled: true,
        url: null,
        transportType: 'stdio',
        command: 'uvx',
        args: ['mcp-atlassian'],
        env: { JIRA_PERSONAL_TOKEN: '${JIRA_PERSONAL_TOKEN}' },
        headers: {},
      }),
    ])

    assert.equal((instance as any).toolPool.get('jira'), previousTools)
    assert.equal((instance as any).toolClients.size, 1)
    assert.equal(closeCalls, 0)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance stop closes MCP tool clients', async () => {
  const instance = makeInstance()
  let closeCalls = 0
  ;(instance as any).adapter = { stop: async () => {} }
  ;(instance as any).toolClients.set('mcp-1', { close: async () => { closeCalls++ } })

  await instance.stop()

  assert.equal((instance as any).toolClients.size, 0)
  assert.equal(closeCalls, 1)
})

test('BotInstance records normal replies on the current response run', async () => {
  const bot = await makePersistedBot()
  const context = makeContext({ id: 'reply-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = { invokeWithTools: async () => 'tracked answer' }
    const chatKey = `wecom:user:normal-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-normal-reply',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-normal',
      chatKey,
      chatId: 'user-normal',
      userId: 'user-normal',
      questionPreview: 'question',
      provider: bot.provider,
      model: bot.llmModel,
    })

    await (instance as any).handleNone('user-normal', chatKey, 'question', [], 'prompt', [], { body: {} }, run)

    const updated = await BotResponseRunRepository.findById(run.id)
    const messages = await (instance as any).sessions.getMessagesByResponseRunId(run.id)
    assert.equal(updated?.status, 'sent')
    assert.equal(updated?.answerPreview, 'tracked answer')
    assert.equal(updated?.feedbackAvailable, true)
    assert.deepEqual(messages.map((msg: any) => msg.responseRunId), [run.id, run.id])
    assert.equal(adapter.streams[0].feedbackId, run.feedbackId)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance progressive mode sends privacy-safe heartbeat and final reply', async () => {
  const bot = await makePersistedBot({ streamingMode: 'progressive' })
  const context = makeContext({ id: 'progress-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithTools: async (_messages: unknown, _content: unknown, _prompt: string, _tools: unknown, callbacks: any) => {
        await callbacks.onToolStart()
        await callbacks.onToolEnd()
        return 'progress answer'
      },
    }
    const chatKey = `wecom:user:progress-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-progress-reply',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-progress',
      chatKey,
      chatId: 'user-progress',
      userId: 'user-progress',
      questionPreview: 'repo query filePath token headers env',
      provider: bot.provider,
      model: bot.llmModel,
    })

    await (instance as any).handleProgressive('user-progress', chatKey, 'question', [], 'prompt', [], { body: {} }, run)

    const texts = adapter.streams.map((item) => item.text).join('\n')
    assert.match(texts, /正在思考中|正在检索相关信息/)
    assert.match(texts, /已用/)
    assert.match(texts, /progress answer/)
    assert.doesNotMatch(texts, /repo query|filePath|token|headers|env/)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance progressive mode falls back when stream is unavailable', async () => {
  const bot = await makePersistedBot({ streamingMode: 'progressive' })
  const context = makeContext({ id: 'progress-fallback-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = {
      ...adapter,
      sendThinkingWithStream: async () => { throw new Error('stream unavailable') },
    }
    ;(instance as any).engine = { invokeWithTools: async () => 'fallback answer' }
    const chatKey = `wecom:user:progress-fallback-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-progress-fallback',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-progress-fallback',
      chatKey,
      chatId: 'user-progress-fallback',
      userId: 'user-progress-fallback',
      questionPreview: 'question',
      provider: bot.provider,
      model: bot.llmModel,
    })

    await (instance as any).handleProgressive('user-progress-fallback', chatKey, 'question', [], 'prompt', [], { body: {} }, run)

    assert.equal(adapter.sent.some((item) => item.text.includes('正在分析')), true)
    assert.equal(adapter.sent.some((item) => item.text === 'fallback answer'), true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance records typewriter replies on one response run', async () => {
  const bot = await makePersistedBot({ streamingMode: 'typewriter' })
  const context = makeContext({ id: 'typewriter-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithStream: async (_messages: unknown, _content: unknown, _prompt: string, _tools: unknown, callbacks: any) => {
        await callbacks.onToken('stream ')
        return 'stream answer'
      },
    }
    const chatKey = `wecom:user:typewriter-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-typewriter-reply',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-typewriter',
      chatKey,
      chatId: 'user-typewriter',
      userId: 'user-typewriter',
      questionPreview: 'question',
      provider: bot.provider,
      model: bot.llmModel,
    })

    await (instance as any).handleTypewriter('user-typewriter', chatKey, 'question', [], 'prompt', [], { body: {} }, run)

    const updated = await BotResponseRunRepository.findById(run.id)
    assert.equal(updated?.status, 'sent')
    assert.equal(updated?.answerPreview, 'stream answer')
    assert.equal(adapter.streams.filter((item) => item.feedbackId === run.feedbackId).length, 1)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance records Dify conversation id on the response run', async () => {
  const bot = await makePersistedBot({
    provider: 'dify',
    difyBaseUrl: 'https://dify.example.invalid',
    difyApiKey: 'dify-key',
    difyAppId: 'dify-app',
  })
  const context = makeContext({ id: 'dify-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).difyClient = { chat: async () => ({ answer: 'dify answer', conversationId: 'conv-1' }) }
    const chatKey = `wecom:user:dify-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-dify-reply',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-dify',
      chatKey,
      chatId: 'user-dify',
      userId: 'user-dify',
      questionPreview: 'question',
      provider: bot.provider,
      model: bot.difyAppId,
    })

    await (instance as any).handleDify('user-dify', chatKey, 'question', null, undefined, { body: {} }, run)

    const updated = await BotResponseRunRepository.findById(run.id)
    const session = await (instance as any).sessions.get(chatKey)
    assert.equal(updated?.status, 'sent')
    assert.equal(updated?.answerPreview, 'dify answer')
    assert.equal(updated?.difyConversationId, 'conv-1')
    assert.equal(session?.difyConversationId, 'conv-1')
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance marks response run errors when reply generation fails', async () => {
  const bot = await makePersistedBot()
  const context = makeContext({ id: 'error-context', botId: bot.id })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = { invokeWithTools: async () => { throw new Error('model failed') } }
    const chatKey = `wecom:user:error-${Date.now()}`
    await (instance as any).sessions.getOrCreate(chatKey, context.id, 30)
    const run = await BotResponseRunRepository.create({
      feedbackId: 'feedback-error-reply',
      botId: bot.id,
      contextId: context.id,
      sessionId: 'session-error',
      chatKey,
      chatId: 'user-error',
      userId: 'user-error',
      questionPreview: 'question',
      provider: bot.provider,
      model: bot.llmModel,
    })

    await (instance as any).handleNone('user-error', chatKey, 'question', [], 'prompt', [], undefined, run)

    const updated = await BotResponseRunRepository.findById(run.id)
    assert.equal(updated?.status, 'error')
    assert.match(updated?.error ?? '', /处理消息时发生错误/)
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
          return '[product] Refund (faq/refund.md)\nmatched refund.md'
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
    ], 'refund policy', { contextId: 'context-1', chatKey: 'wecom:group:test', responseRunId: 'run-1' })

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { query: 'refund policy', namespace: 'product', cross_ns: false })
    assert.match(prompt, /matched refund\.md/)
    const logs = await WikiRetrievalLogRepository.findByNamespace('product', { limit: 10 })
    assert.equal(logs.some((log) =>
      log.policy === 'autoSearch' &&
      log.query === 'refund policy' &&
      log.responseRunId === 'run-1' &&
      log.hitCount === 1 &&
      log.hitPaths.includes('faq/refund.md')
    ), true)
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
    const logs = await WikiRetrievalLogRepository.findByNamespace('product', { limit: 10 })
    assert.equal(logs.some((log) =>
      log.policy === 'fixedPage' &&
      log.query === 'rules/sop.md' &&
      log.hitCount === 1 &&
      log.hitPaths.includes('rules/sop.md')
    ), true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance keeps reply flow when Wiki retrieval logging fails', async () => {
  const instance = makeInstance()
  const originalCreate = WikiRetrievalLogRepository.create
  try {
    ;(WikiRetrievalLogRepository as any).create = async () => {
      throw new Error('log write failed')
    }
    ;(instance as any).toolPool.set('wiki-mcp', [
      {
        name: 'wiki_search',
        invoke: async () => '[support] SOP (rules/sop.md)\nmatched sop.md',
      },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'wiki-mcp',
        enabled: true,
        forceCall: true,
        params: { namespace: 'support', retrievalPolicy: 'autoSearch' },
      },
    ], 'sop')

    assert.match(prompt, /matched sop\.md/)
  } finally {
    ;(WikiRetrievalLogRepository as any).create = originalCreate
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
