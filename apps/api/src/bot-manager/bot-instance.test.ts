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
  { BotRepository },
  { ContextRepository },
  { ActiveContextRepository, CommandPermissionRepository, ContextAccessRepository, WecomUserRepository },
  { GeneratedFileRepository, GenerationTaskRepository, ModelConfigRepository },
  { BotResponseRunRepository },
  { generationTaskRunner },
] = await Promise.all([
  import('./bot-instance.js'),
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/context-repository.js'),
  import('../db/wecom-access-repository.js'),
  import('../db/generation-repository.js'),
  import('../db/bot-response-run-repository.js'),
  import('../services/generation-task-runner.js'),
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

async function makePersistedContext(botId: string, name: string, overrides: Partial<ContextConfig> = {}) {
  return ContextRepository.create({
    botId,
    name,
    systemPrompt: `${name} prompt`,
    mcpConfigs: [],
    skillConfigs: [],
    sessionTtlMin: 30,
    isDefault: false,
    ...overrides,
  })
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(await assertion(), true)
}

function makeFakeAdapter() {
  const sent: Array<{ chatId: string; text: string }> = []
  const cards: Array<{ chatId: string; card: Record<string, any> }> = []
  const media: Array<{ chatId: string; mediaType: string; filename: string; bytes: Uint8Array }> = []
  const updates: Array<{ event: any; card: Record<string, any>; userIds?: string[] }> = []
  const streams: Array<{ text: string; feedbackId?: string | null; finish?: boolean }> = []
  return {
    sent,
    cards,
    media,
    updates,
    streams,
    isReconnecting: () => false,
    sendMessage: async (chatId: string, text: string) => { sent.push({ chatId, text }) },
    sendTemplateCard: async (chatId: string, card: Record<string, any>) => { cards.push({ chatId, card }) },
    sendMediaMessage: async (chatId: string, mediaType: string, file: { bytes: Uint8Array; filename: string }) => {
      media.push({ chatId, mediaType, filename: file.filename, bytes: file.bytes })
    },
    updateTemplateCard: async (event: any, card: Record<string, any>, userIds?: string[]) => {
      updates.push({ event, card, userIds })
    },
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

test('BotInstance handles slash commands before context routing and LLM flow', async () => {
  const bot = await makePersistedBot()
  const instance = makeInstanceForBot(bot, [])
  const adapter = makeFakeAdapter()
  let invoked = false
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithTools: async () => {
        invoked = true
        return 'should not be called'
      },
    }

    await (instance as any).handleMessage({
      chatId: 'cmd-chat-id',
      chatKey: `wecom:user:cmd-${Date.now()}`,
      chatType: 'single',
      userId: 'cmd-user',
      content: '/unknown',
      rawBody: { msgid: `cmd-${Date.now()}` },
    })

    assert.equal(invoked, false)
    assert.equal(adapter.sent.length, 1)
    assert.match(adapter.sent[0].text, /未知命令/)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance context commands switch immediately and isolate sessions', async () => {
  const bot = await makePersistedBot()
  const boundContext = await makePersistedContext(bot.id, 'Bound')
  const targetContext = await makePersistedContext(bot.id, 'Target')
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'user-a', role: 'user' })
  await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: targetContext.id,
    wecomUserId: 'user-a',
  })

  const chatKey = `wecom:group:ctx-${Date.now()}`
  const instance = new BotInstance({
    bot,
    contexts: [boundContext, targetContext],
    bindings: [makeBinding({ botId: bot.id, chatKey, contextId: boundContext.id })],
    mcpServers: [],
    skills: [],
    db: db as any,
  })
  const adapter = makeFakeAdapter()
  let usedPrompt = ''
  let messageCount = -1
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithTools: async (messages: unknown[], _content: unknown, systemPrompt: string) => {
        usedPrompt = systemPrompt
        messageCount = messages.length
        return 'context answer'
      },
    }
    await (instance as any).sessions.getOrCreate(chatKey, boundContext.id, 30)
    await (instance as any).sessions.setDifyConversationId(chatKey, 'old-conversation')

    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-a',
      content: `/ctx use ${targetContext.id}`,
      rawBody: { msgid: `ctx-use-${Date.now()}` },
    })

    assert.equal(adapter.sent.some((item) => item.text.includes(targetContext.name)), true)
    const active = await ActiveContextRepository.findForChat(bot.id, chatKey)
    assert.equal(active?.contextId, targetContext.id)
    assert.equal(active?.scope, 'chat')
    assert.equal(active?.wecomUserId, null)
    assert.equal((await (instance as any).sessions.getAll()).filter((session: any) => session.chatKey === chatKey).length, 0)

    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-a',
      content: 'hello after switch',
      rawBody: { msgid: `ctx-normal-${Date.now()}` },
    })
    await waitFor(() => usedPrompt === targetContext.systemPrompt)

    assert.equal(usedPrompt, targetContext.systemPrompt)
    assert.equal(messageCount, 0)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance sends context selection cards and handles template card events', async () => {
  const bot = await makePersistedBot()
  const currentContext = await makePersistedContext(bot.id, 'Card Current', { isDefault: true })
  const targetContext = await makePersistedContext(bot.id, 'Card Target')
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'card-user', role: 'user' })
  await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: currentContext.id,
    wecomUserId: 'card-user',
  })
  await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: targetContext.id,
    wecomUserId: 'card-user',
  })

  const chatKey = `wecom:user:card-${Date.now()}`
  const instance = makeInstanceForBot(bot, [currentContext, targetContext])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    await (instance as any).handleMessage({
      chatId: 'card-chat-id',
      chatKey,
      chatType: 'single',
      userId: 'card-user',
      content: '/ctx list',
      rawBody: { msgid: `ctx-list-card-${Date.now()}` },
    })

    assert.equal(adapter.cards.length, 1)
    assert.equal(adapter.cards[0].card.card_type, 'multiple_interaction')
    assert.equal(adapter.cards[0].card.submit_button.key, 'ctx_use_submit')
    assert.equal(adapter.cards[0].card.select_list[0].selected_id, currentContext.id)

    await (instance as any).handleEvent({
      msgId: `ctx-card-event-${Date.now()}`,
      eventType: 'template_card_event',
      aibotId: bot.wecomBotId,
      chatId: 'card-chat-id',
      chatKey,
      chatType: 'single',
      userId: 'card-user',
      corpid: null,
      responseUrl: null,
      createTime: Date.now(),
      rawBody: {},
      eventPayload: {
        eventtype: 'template_card_event',
        template_card_event: {
          card_type: 'multiple_interaction',
          event_key: 'ctx_use_submit',
          task_id: adapter.cards[0].card.task_id,
          selected_items: {
            selected_item: [
              {
                question_key: 'ctx_id',
                option_ids: { option_id: [targetContext.id] },
              },
            ],
          },
        },
      },
    })

    assert.equal((await ActiveContextRepository.findForUser(bot.id, chatKey, 'card-user'))?.contextId, targetContext.id)
    assert.equal(adapter.updates.some((item) => item.card.main_title?.title === '操作已完成'), true)
    assert.equal(adapter.sent.some((item) => item.text.includes(targetContext.name)), true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance sends menu cards for help and enter-chat events', async () => {
  const bot = await makePersistedBot()
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'menu-user', role: 'user' })
  const instance = makeInstanceForBot(bot, [])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    await (instance as any).handleMessage({
      chatId: 'menu-chat-id',
      chatKey: 'wecom:user:menu-user',
      chatType: 'single',
      userId: 'menu-user',
      content: '/help',
      rawBody: { msgid: `help-menu-${Date.now()}` },
    })
    assert.equal(adapter.cards.some((item) => item.card.card_type === 'button_interaction'), true)
    assert.equal(adapter.cards.some((item) => item.card.button_list?.some((button: any) => button.key === 'menu_ctx_list')), true)
    assert.equal(adapter.cards[0].card.button_list.length, 4)
    assert.equal(adapter.cards.some((item) => item.card.button_list?.some((button: any) => button.key === 'menu_help')), true)
    assert.equal(adapter.cards.some((item) => item.card.button_list?.some((button: any) => button.key === 'menu_image_help')), false)
    assert.equal(adapter.cards.some((item) => item.card.horizontal_content_list?.some((row: any) => row.value === '/image 描述')), true)
    assert.equal(adapter.sent.length, 0)

    await (instance as any).handleEvent({
      msgId: `enter-menu-${Date.now()}`,
      eventType: 'enter_chat',
      aibotId: bot.wecomBotId,
      chatId: 'menu-chat-id',
      chatKey: 'wecom:user:menu-user',
      chatType: 'single',
      userId: 'menu-user',
      corpid: null,
      responseUrl: null,
      createTime: Date.now(),
      rawBody: {},
      eventPayload: { eventtype: 'enter_chat' },
    })
    assert.equal(adapter.cards.length >= 2, true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance executes admin maintenance commands from WeCom text commands', async () => {
  const bot = await makePersistedBot()
  const context = await makePersistedContext(bot.id, 'Admin Context')
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'admin-user', role: 'admin' })
  const instance = makeInstanceForBot(bot, [context])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter

    await (instance as any).handleMessage({
      chatId: 'admin-chat-id',
      chatKey: 'wecom:user:admin-user',
      chatType: 'single',
      userId: 'admin-user',
      content: '/admin user upsert target-user manager active 张三',
      rawBody: { msgid: `admin-user-upsert-${Date.now()}` },
    })
    assert.equal((await WecomUserRepository.findByWecomUserId(bot.id, 'target-user'))?.role, 'manager')
    assert.equal(adapter.sent.some((item) => item.text.includes('已维护企微用户')), true)

    await (instance as any).handleMessage({
      chatId: 'admin-chat-id',
      chatKey: 'wecom:user:admin-user',
      chatType: 'single',
      userId: 'admin-user',
      content: `/admin ctx grant target-user ${context.id}`,
      rawBody: { msgid: `admin-ctx-grant-${Date.now()}` },
    })
    assert.equal((await ContextAccessRepository.hasAccess(bot.id, 'target-user', context.id)), true)

    await (instance as any).handleMessage({
      chatId: 'admin-chat-id',
      chatKey: 'wecom:user:admin-user',
      chatType: 'single',
      userId: 'admin-user',
      content: '/admin command set image.generate manager off',
      rawBody: { msgid: `admin-command-set-${Date.now()}` },
    })
    assert.equal((await CommandPermissionRepository.check(bot.id, 'image.generate', 'manager')).allowed, false)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance does not clear sessions on failed context switch and shares group runtime context', async () => {
  const bot = await makePersistedBot()
  const boundContext = await makePersistedContext(bot.id, 'Group Bound')
  const targetContext = await makePersistedContext(bot.id, 'Group Target')
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'user-a', role: 'user' })
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'user-b', role: 'user' })
  await ContextAccessRepository.grant({
    botId: bot.id,
    contextId: targetContext.id,
    wecomUserId: 'user-a',
  })

  const chatKey = `wecom:group:isolated-${Date.now()}`
  const instance = new BotInstance({
    bot,
    contexts: [boundContext, targetContext],
    bindings: [makeBinding({ botId: bot.id, chatKey, contextId: boundContext.id })],
    mcpServers: [],
    skills: [],
    db: db as any,
  })
  const adapter = makeFakeAdapter()
  const prompts: string[] = []
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithTools: async (_messages: unknown[], _content: unknown, systemPrompt: string) => {
        prompts.push(systemPrompt)
        return 'group answer'
      },
    }
    const existing = await (instance as any).sessions.getOrCreate(chatKey, boundContext.id, 30)

    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-b',
      content: `/ctx use ${targetContext.id}`,
      rawBody: { msgid: `ctx-denied-${Date.now()}` },
    })
    assert.equal(adapter.sent.some((item) => item.text.includes('没有切换权限') || item.text.includes('未找到可访问')), true)
    assert.equal((await (instance as any).sessions.get(chatKey))?.id, existing.id)

    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-a',
      content: `/ctx use ${targetContext.id}`,
      rawBody: { msgid: `ctx-user-a-${Date.now()}` },
    })
    const active = await ActiveContextRepository.findForChat(bot.id, chatKey)
    assert.equal(active?.contextId, targetContext.id)
    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-b',
      content: 'hello from user b',
      rawBody: { msgid: `ctx-user-b-normal-${Date.now()}` },
    })
    await waitFor(() => prompts.includes(targetContext.systemPrompt))

    assert.equal(prompts.includes(targetContext.systemPrompt), true)

    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-a',
      content: '/ctx reset',
      rawBody: { msgid: `ctx-reset-${Date.now()}` },
    })
    assert.equal(await ActiveContextRepository.findForChat(bot.id, chatKey), null)
    await (instance as any).handleMessage({
      chatId: 'ctx-chat-id',
      chatKey,
      chatType: 'group',
      userId: 'user-b',
      content: 'hello after reset',
      rawBody: { msgid: `ctx-user-b-reset-${Date.now()}` },
    })
    await waitFor(() => prompts.includes(boundContext.systemPrompt))
    assert.equal(prompts.includes(boundContext.systemPrompt), true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance handles task status and result commands with owner permissions', async () => {
  const bot = await makePersistedBot()
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'owner-user', role: 'user' })
  await WecomUserRepository.upsert({ botId: bot.id, wecomUserId: 'other-user', role: 'user' })
  const task = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'image',
    ownerUserId: 'owner-user',
    chatKey: 'chat-1',
    chatId: 'chat-id',
  })
  const resultPath = join(tempDir, `result-${Date.now()}.png`)
  await writeFile(resultPath, Buffer.from('fake-png'))
  const file = await GeneratedFileRepository.create({
    taskId: task.id,
    botId: bot.id,
    ownerUserId: 'owner-user',
    chatKey: 'chat-1',
    fileType: 'image',
    storagePath: resultPath,
    mimeType: 'image/png',
    accessToken: 'task-result-token',
  })
  await GenerationTaskRepository.markSucceeded(task.id, [file.id])

  const instance = makeInstanceForBot(bot, [])
  const adapter = makeFakeAdapter()
  try {
    ;(instance as any).adapter = adapter
    ;(instance as any).engine = {
      invokeWithTools: async () => 'should not be called',
    }

    await (instance as any).handleMessage({
      chatId: 'task-chat-id',
      chatKey: 'wecom:user:task-owner',
      chatType: 'single',
      userId: 'owner-user',
      content: `/task status ${task.id}`,
      rawBody: { msgid: `task-status-${Date.now()}` },
    })
    await (instance as any).handleMessage({
      chatId: 'task-chat-id',
      chatKey: 'wecom:user:task-owner',
      chatType: 'single',
      userId: 'owner-user',
      content: `/task result ${task.id}`,
      rawBody: { msgid: `task-result-${Date.now()}` },
    })
    await (instance as any).handleMessage({
      chatId: 'task-chat-id',
      chatKey: 'wecom:user:task-other',
      chatType: 'single',
      userId: 'other-user',
      content: `/task status ${task.id}`,
      rawBody: { msgid: `task-denied-${Date.now()}` },
    })

    assert.equal(adapter.sent.some((item) => item.text.includes('状态：succeeded')), true)
    assert.equal(adapter.media.some((item) => item.chatId === 'task-chat-id' && item.mediaType === 'image'), true)
    assert.equal(adapter.sent.some((item) => item.text.includes('已发送 1 个结果文件到当前会话')), true)
    assert.equal(adapter.sent.some((item) => item.text.includes('没有查看该任务的权限')), true)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance validates image command model configuration and quota before creating tasks', async () => {
  const noModelBot = await makePersistedBot()
  await WecomUserRepository.upsert({ botId: noModelBot.id, wecomUserId: 'image-user', role: 'user' })
  const noModelInstance = makeInstanceForBot(noModelBot, [])
  const noModelAdapter = makeFakeAdapter()
  try {
    ;(noModelInstance as any).adapter = noModelAdapter
    await (noModelInstance as any).handleMessage({
      chatId: 'image-chat-id',
      chatKey: 'wecom:user:image-no-model',
      chatType: 'single',
      userId: 'image-user',
      content: '/image a launch poster',
      rawBody: { msgid: `image-no-model-${Date.now()}` },
    })
    assert.equal(noModelAdapter.sent.some((item) => item.text.includes('未配置可用的图片生成模型')), true)
  } finally {
    ;(noModelInstance as any).sessions.destroy()
  }

  const quotaBot = await makePersistedBot()
  await WecomUserRepository.upsert({ botId: quotaBot.id, wecomUserId: 'image-user', role: 'user' })
  await ModelConfigRepository.create({
    botId: quotaBot.id,
    name: 'Quota model',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    baseUrl: 'https://image.example.invalid/v1',
    apiKey: 'key',
    enabled: true,
    quotaPerUserDaily: 0,
  })
  const quotaInstance = makeInstanceForBot(quotaBot, [])
  const quotaAdapter = makeFakeAdapter()
  try {
    ;(quotaInstance as any).adapter = quotaAdapter
    await (quotaInstance as any).handleMessage({
      chatId: 'image-chat-id',
      chatKey: 'wecom:user:image-quota',
      chatType: 'single',
      userId: 'image-user',
      content: '/image a launch poster',
      rawBody: { msgid: `image-quota-${Date.now()}` },
    })
    assert.equal(quotaAdapter.sent.some((item) => item.text.includes('额度已用完')), true)
  } finally {
    ;(quotaInstance as any).sessions.destroy()
  }

  const successBot = await makePersistedBot()
  await WecomUserRepository.upsert({ botId: successBot.id, wecomUserId: 'image-user', role: 'user' })
  await ModelConfigRepository.create({
    botId: successBot.id,
    name: 'Image model',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    baseUrl: 'https://image.example.invalid/v1',
    apiKey: 'key',
    enabled: true,
  })
  const successInstance = makeInstanceForBot(successBot, [])
  const successAdapter = makeFakeAdapter()
  const originalEnqueue = generationTaskRunner.enqueue.bind(generationTaskRunner)
  try {
    ;(successInstance as any).adapter = successAdapter
    ;(generationTaskRunner as any).enqueue = () => {}
    await (successInstance as any).handleMessage({
      chatId: 'image-chat-id',
      chatKey: 'wecom:user:image-success',
      chatType: 'single',
      userId: 'image-user',
      content: '/image a launch poster',
      rawBody: { msgid: `image-success-${Date.now()}` },
    })
    assert.equal(successAdapter.cards.some((item) => item.card.task_id?.startsWith('gen_task_')), true)
    assert.equal(successAdapter.cards.some((item) => item.card.button_list?.some((button: any) => button.key === 'task_result')), true)
    assert.equal(successAdapter.sent.length, 0)
  } finally {
    ;(generationTaskRunner as any).enqueue = originalEnqueue
    ;(successInstance as any).sessions.destroy()
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

test('BotInstance retries MCP tool once after HTTP session invalidation', async () => {
  const instance = makeInstance()
  try {
    let originalCalls = 0
    let reloadCalls = 0
    let replacementCalls = 0
    const originalTool = {
      name: 'query',
      invoke: async () => {
        originalCalls++
        throw new Error('Streamable HTTP error: Error POSTing to endpoint: {"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found. Re-initialize."},"id":null}')
      },
    } as unknown as StructuredTool
    const replacementTool = {
      name: 'query',
      invoke: async (input: any, config: any) => {
        replacementCalls++
        assert.equal(config.metadata.mcpSessionRetry, true)
        return `fresh:${input.q}`
      },
    } as unknown as StructuredTool
    ;(instance as any).reloadMcpServerToolPool = async (serverId: string) => {
      reloadCalls++
      assert.equal(serverId, 'gitnexus')
      return [replacementTool]
    }

    const [wrapped] = (instance as any).wrapMcpTools('gitnexus', [originalTool]) as StructuredTool[]
    const result = await (wrapped.invoke as any)({ q: 'hello' })

    assert.equal(result, 'fresh:hello')
    assert.equal(originalCalls, 1)
    assert.equal(reloadCalls, 1)
    assert.equal(replacementCalls, 1)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance does not retry MCP session invalidation more than once', async () => {
  const instance = makeInstance()
  try {
    let reloadCalls = 0
    const originalTool = {
      name: 'query',
      invoke: async () => {
        throw new Error('No valid session. Send a POST to initialize.')
      },
    } as unknown as StructuredTool
    ;(instance as any).reloadMcpServerToolPool = async () => {
      reloadCalls++
      return []
    }

    const [wrapped] = (instance as any).wrapMcpTools('gitnexus', [originalTool]) as StructuredTool[]
    await assert.rejects(
      () => (wrapped.invoke as any)({}, { metadata: { mcpSessionRetry: true } }),
      /No valid session/
    )

    assert.equal(reloadCalls, 0)
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
    assert.match(texts, /已用时间：\d+ 秒/)
    assert.doesNotMatch(texts, /▰|▱/)
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

test('BotInstance force-calls enabled MCP tools with query schemas', async () => {
  const instance = makeInstance()
  try {
    const calls: any[] = []
    ;(instance as any).toolPool.set('search-mcp', [
      {
        name: 'search_docs',
        schema: { shape: { query: {} } },
        invoke: async (input: any) => {
          calls.push(input)
          return 'matched refund policy'
        },
      },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'search-mcp',
        enabled: true,
        forceCall: true,
        params: {},
      },
    ], 'refund policy')

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], { query: 'refund policy' })
    assert.match(prompt, /matched refund policy/)
  } finally {
    ;(instance as any).sessions.destroy()
  }
})

test('BotInstance skips MCP force call when forceCall is disabled', async () => {
  const instance = makeInstance()
  try {
    const calls: any[] = []
    ;(instance as any).toolPool.set('search-mcp', [
      {
        name: 'search_docs',
        schema: { shape: { query: {} } },
        invoke: async (input: unknown) => {
          calls.push(input)
          return 'should not run'
        },
      },
    ])

    const prompt = await (instance as any).executeForceCallMcps('base prompt', [
      {
        mcpServerId: 'search-mcp',
        enabled: true,
        params: {},
      },
    ], 'hello')

    assert.equal(calls.length, 0)
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
