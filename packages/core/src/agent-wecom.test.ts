import assert from 'node:assert/strict'
import test from 'node:test'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { WecomAdapter } from './wecom-adapter.js'
import { __testExtractLastNonEmptyAiText, __testWithCollectedFallback } from './agent-engine.js'

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
