import assert from 'node:assert/strict'
import test from 'node:test'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { WecomAdapter } from './wecom-adapter.js'
import { __testConfiguredPositiveInt, __testCreateTimeoutResponse, __testExtractLastNonEmptyAiText, __testWithCollectedFallback, __testWrapToolsForAgent } from './agent-engine.js'

test('AgentEngine reads positive integer timeout environment values', () => {
  const previous = process.env.AGENT_TIMEOUT_MS
  process.env.AGENT_TIMEOUT_MS = '900000'

  try {
    assert.equal(__testConfiguredPositiveInt('AGENT_TIMEOUT_MS', 600_000), 900_000)
  } finally {
    if (previous === undefined) delete process.env.AGENT_TIMEOUT_MS
    else process.env.AGENT_TIMEOUT_MS = previous
  }
})

test('AgentEngine timeout response prefers partial AI text', () => {
  const response = __testCreateTimeoutResponse([
    new HumanMessage('question'),
    new AIMessage('阶段性结果'),
  ])

  assert.match(response, /阶段性结果/)
  assert.match(response, /缩小查询范围/)
})

test('AgentEngine extracts the last non-empty AI text', () => {
  const result = __testExtractLastNonEmptyAiText([
    new HumanMessage('question'),
    new AIMessage('useful answer'),
    new AIMessage(''),
  ])

  assert.equal(result, 'useful answer')
})

test('AgentEngine recursion fallback prefers collected intermediate messages', () => {
  const history = [new HumanMessage('original question')]
  const collected = [new AIMessage('partial answer from tool flow')]

  const result = __testWithCollectedFallback(history, collected)

  assert.equal(result.messages?.length, 1)
  assert.equal(result.messages?.[0]?.content, 'partial answer from tool flow')
})

test('AgentEngine converts tool errors into model-readable output', async () => {
  const [tool] = __testWrapToolsForAgent([
    {
      name: 'execute_sql',
      invoke: async () => {
        throw new Error('MCP error -32001: TimeoutError')
      },
    } as any,
  ], 100)

  const output = await (tool as any).invoke({ sql: 'SHOW COLUMNS FROM cm_order_entry_tasklock' })

  assert.match(String(output), /\[工具调用失败: execute_sql\]/)
  assert.match(String(output), /请不要重复调用/)
})

test('AgentEngine times out slow tool calls before the whole agent invoke timeout', async () => {
  const [tool] = __testWrapToolsForAgent([
    {
      name: 'slow_tool',
      invoke: async (_input: unknown, config?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        config?.signal?.addEventListener('abort', () => reject(new Error('aborted by test')), { once: true })
      }),
    } as any,
  ], 10)

  const startedAt = Date.now()
  const output = await (tool as any).invoke({})

  assert.ok(Date.now() - startedAt < 500)
  assert.match(String(output), /\[工具调用失败: slow_tool\]/)
})

test('WecomAdapter parses text quote with current text message', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test' })
  const parsed = await adapter.__testParseFrame({
    body: {
      msgid: 'm1',
      msgtype: 'text',
      chatid: 'chat-1',
      chattype: 'group',
      from: { userid: 'u1' },
      text: { content: '@bot 当前问题' },
      quote: { msgtype: 'text', text: { content: '@bot 被引用内容' } },
    },
  })

  assert.deepEqual(parsed?.content, [
    { type: 'text', text: '> 引用消息:\n被引用内容' },
    { type: 'text', text: '当前消息:\n当前问题' },
  ])
})

test('WecomAdapter degrades quoted image when vision is disabled', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test', visionEnabled: false })
  const parsed = await adapter.__testParseFrame({
    body: {
      msgid: 'm2',
      msgtype: 'text',
      chatid: 'chat-1',
      chattype: 'group',
      from: { userid: 'u1' },
      text: { content: '当前问题' },
      quote: { msgtype: 'image', image: { url: 'https://example.test/a.jpg', aeskey: 'bad' } },
    },
  })

  assert.deepEqual(parsed?.content, [
    { type: 'text', text: '> 引用消息:\n[引用图片]' },
    { type: 'text', text: '当前消息:\n当前问题' },
  ])
})

test('WecomAdapter preserves quoted image decrypt failure marker', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 500 }) as Response

  try {
    const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test', visionEnabled: true })
    const parsed = await adapter.__testParseFrame({
      body: {
        msgid: 'm3',
        msgtype: 'text',
        chatid: 'chat-1',
        chattype: 'group',
        from: { userid: 'u1' },
        text: { content: '当前问题' },
        quote: { msgtype: 'image', image: { url: 'https://example.test/a.jpg', aeskey: Buffer.alloc(32).toString('base64') } },
      },
    })

    assert.deepEqual(parsed?.content, [
      { type: 'text', text: '> 引用消息:\n[引用图片]' },
      { type: 'text', text: '[图片解密失败]' },
      { type: 'text', text: '当前消息:\n当前问题' },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('WecomAdapter parses enter_chat event separately from messages', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test' })
  const parsed = await adapter.__testParseEventFrame({
    body: {
      msgid: 'e1',
      msgtype: 'event',
      create_time: 1700000000,
      aibotid: 'aibot-1',
      chattype: 'single',
      from: { corpid: 'corp-1', userid: 'user-1' },
      event: { eventtype: 'enter_chat' },
    },
  })

  assert.equal(parsed?.eventType, 'enter_chat')
  assert.equal(parsed?.chatKey, 'wecom:user:user-1')
  assert.equal(parsed?.userId, 'user-1')
})

test('WecomAdapter parses template_card_event payload', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test' })
  const parsed = await adapter.__testParseEventFrame({
    body: {
      msgid: 'e2',
      msgtype: 'event',
      chatid: 'chat-1',
      chattype: 'group',
      response_url: 'https://example.test/response',
      from: { userid: 'user-1' },
      event: {
        eventtype: 'template_card_event',
        template_card_event: { card_type: 'button_interaction', event_key: 'approve', task_id: 'task-1' },
      },
    },
  })

  assert.equal(parsed?.eventType, 'template_card_event')
  assert.equal(parsed?.chatKey, 'wecom:group:chat-1')
  assert.equal(parsed?.responseUrl, 'https://example.test/response')
  assert.equal(parsed?.eventPayload.template_card_event.event_key, 'approve')
})

test('WecomAdapter parses feedback_event payload', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test' })
  const parsed = await adapter.__testParseEventFrame({
    body: {
      msgid: 'e3',
      msgtype: 'event',
      chatid: 'chat-1',
      chattype: 'group',
      from: { userid: 'user-1' },
      event: {
        eventtype: 'feedback_event',
        feedback_event: { id: 'feedback-1', type: 2, content: '不完整', inaccurate_reason_list: [2] },
      },
    },
  })

  assert.equal(parsed?.eventType, 'feedback_event')
  assert.equal(parsed?.eventPayload.feedback_event.id, 'feedback-1')
  assert.deepEqual(parsed?.eventPayload.feedback_event.inaccurate_reason_list, [2])
})

test('WecomAdapter preserves unknown event types for safe storage', async () => {
  const adapter = new WecomAdapter({ botId: 'bot', secret: 'secret', wsUrl: 'ws://example.test' })
  const parsed = await adapter.__testParseEventFrame({
    body: {
      msgid: 'e4',
      msgtype: 'event',
      from: { userid: 'user-1' },
      event: { eventtype: 'future_event', future_event: { value: 1 } },
    },
  })

  assert.equal(parsed?.eventType, 'future_event')
  assert.equal(parsed?.eventPayload.future_event.value, 1)
})
