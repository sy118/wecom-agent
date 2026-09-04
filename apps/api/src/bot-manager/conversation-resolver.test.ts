import assert from 'node:assert/strict'
import test from 'node:test'
import { ConversationResolver } from './conversation-resolver.js'
import type { Binding, ContextConfig } from '@wecom-platform/types'

function context(id: string, isDefault = false): ContextConfig {
  return { id, botId: 'bot', name: id, systemPrompt: '', mcpConfigs: [], skillConfigs: [], sessionTtlMin: 30, isDefault, createdAt: 1, updatedAt: 1 }
}

const fallback = context('fallback', true)
const bound = context('bound')
const runtime = context('runtime')
const binding: Binding = { id: 'binding', botId: 'bot', contextId: bound.id, chatKey: 'wecom:group:1', chatName: null, chatType: 'group', createdAt: 1 }

test('ConversationResolver applies runtime, binding, unbound, and needs-binding precedence', () => {
  const resolver = new ConversationResolver([fallback, bound, runtime], [binding], { allowUnboundAccess: true })
  assert.deepEqual(resolver.resolve(binding.chatKey, runtime), { context: runtime, source: 'runtime', access: 'allowed' })
  assert.deepEqual(resolver.resolve(binding.chatKey), { context: bound, source: 'binding', access: 'allowed' })
  assert.deepEqual(resolver.resolve('wecom:user:1'), { context: fallback, source: 'unbound', access: 'allowed' })

  resolver.setPolicy({ allowUnboundAccess: false })
  assert.deepEqual(resolver.resolve('wecom:user:1'), { context: null, source: 'none', access: 'needs-binding' })
})

test('ConversationResolver reports no-context when unbound access has no default', () => {
  const resolver = new ConversationResolver([context('plain')], [], { allowUnboundAccess: true })
  assert.deepEqual(resolver.resolve('wecom:group:missing'), { context: null, source: 'none', access: 'no-context' })
})
