import assert from 'node:assert/strict'
import test from 'node:test'
import { __testBuildDifyChatBody, __testParseDifySseBlock } from './dify-client.js'

test('Dify chat body includes user and blocking response mode', () => {
  const body = __testBuildDifyChatBody('hello', null, 'wecom:group:chat-1', 'blocking')

  assert.equal(body.user, 'wecom:group:chat-1')
  assert.equal(body.response_mode, 'blocking')
  assert.equal(body.query, 'hello')
})

test('Dify chat body promotes image content to files', () => {
  const body = __testBuildDifyChatBody([
    { type: 'text', text: 'look' },
    { type: 'image', url: 'data:image/jpeg;base64,abc' },
  ], 'conv-1', 'user-1', 'streaming')

  assert.equal(body.response_mode, 'streaming')
  assert.equal(body.conversation_id, 'conv-1')
  assert.deepEqual(body.files, [
    { type: 'image', transfer_method: 'remote_url', url: 'data:image/jpeg;base64,abc' },
  ])
})

test('Dify SSE parser extracts event and JSON data', () => {
  const parsed = __testParseDifySseBlock('event: message\ndata: {"answer":"hi","conversation_id":"c1"}')

  assert.equal(parsed.event, 'message')
  assert.equal(parsed.data, '{"answer":"hi","conversation_id":"c1"}')
})

test('Dify chat body includes scheduled task user id', () => {
  const body = __testBuildDifyChatBody('scheduled prompt', null, 'wecom:scheduled:chat-1', 'blocking')

  assert.equal(body.user, 'wecom:scheduled:chat-1')
  assert.equal(body.query, 'scheduled prompt')
})
