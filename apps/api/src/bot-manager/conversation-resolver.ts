import type { Binding, ContextConfig } from '@wecom-platform/types'

export type ConversationAccess = 'allowed' | 'needs-binding' | 'no-context'
export type ConversationResolutionSource = 'runtime' | 'binding' | 'unbound' | 'default' | 'none'

export interface ConversationPolicy {
  allowUnboundAccess: boolean
}

export interface ConversationResolution {
  context: ContextConfig | null
  source: ConversationResolutionSource
  access: ConversationAccess
}

export class ConversationResolver {
  private contextMap: Map<string, ContextConfig>
  private bindingMap: Map<string, string>
  private policy: ConversationPolicy

  constructor(contexts: ContextConfig[], bindings: Binding[], policy: ConversationPolicy = { allowUnboundAccess: true }) {
    this.contextMap = new Map(contexts.map((context) => [context.id, context]))
    this.bindingMap = new Map(bindings.map((binding) => [binding.chatKey, binding.contextId]))
    this.policy = policy
  }

  setPolicy(policy: ConversationPolicy): void {
    this.policy = policy
  }

  updateContexts(contexts: ContextConfig[]): void {
    this.contextMap = new Map(contexts.map((context) => [context.id, context]))
  }

  updateBindings(bindings: Binding[]): void {
    this.bindingMap = new Map(bindings.map((binding) => [binding.chatKey, binding.contextId]))
  }

  resolve(chatKey: string, runtimeContext: ContextConfig | null = null): ConversationResolution {
    if (runtimeContext) return { context: runtimeContext, source: 'runtime', access: 'allowed' }

    const boundContext = this.contextMap.get(this.bindingMap.get(chatKey) ?? '')
    if (boundContext) return { context: boundContext, source: 'binding', access: 'allowed' }

    const defaultContext = [...this.contextMap.values()].find((context) => context.isDefault) ?? null
    if (this.policy.allowUnboundAccess && defaultContext) {
      return { context: defaultContext, source: 'unbound', access: 'allowed' }
    }
    if (!this.policy.allowUnboundAccess) return { context: null, source: 'none', access: 'needs-binding' }
    return { context: null, source: 'none', access: 'no-context' }
  }
}
