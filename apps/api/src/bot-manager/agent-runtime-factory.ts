import type { StructuredTool } from '@langchain/core/tools'
import type { ContextConfig } from '@wecom-platform/types'

export interface AgentRuntimeAssemblyInput {
  context: ContextConfig
  mcpTools: StructuredTool[]
  skillTools: StructuredTool[]
  systemPrompt: string
  skillPrompt: string
}

export interface AgentRuntimeAssembly {
  tools: StructuredTool[]
  systemPrompt: string
}

/** Pure capability assembly boundary; it owns no adapter, queue, session, or client. */
export function assembleAgentRuntime(input: AgentRuntimeAssemblyInput): AgentRuntimeAssembly {
  const seen = new Set<string>()
  const tools: StructuredTool[] = []
  for (const tool of [...input.mcpTools, ...input.skillTools]) {
    const originalName = tool.name
    let name = originalName
    let index = 2
    while (seen.has(name)) name = `${originalName}_${index++}`
    if (name !== originalName) (tool as any).name = name
    seen.add(name)
    tools.push(tool)
  }
  return {
    tools,
    systemPrompt: input.skillPrompt ? `${input.systemPrompt}\n\n# Skill Instructions\n\n${input.skillPrompt}` : input.systemPrompt,
  }
}
