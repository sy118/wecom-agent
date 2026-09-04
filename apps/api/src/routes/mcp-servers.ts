import { Router } from 'express'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import type { McpServerConfig, McpServerTransportType } from '@wecom-platform/types'
import { probeMcpServer } from '@wecom-platform/core'

export const mcpServersRouter: Router = Router({ mergeParams: true })

type McpServerPayload = Omit<McpServerConfig, 'id'> | Partial<Omit<McpServerConfig, 'id' | 'botId'>>

const transportTypes = new Set<McpServerTransportType>(['sse', 'stdio', 'streamable-http'])
const paramTypes = new Set(['string', 'string[]', 'number', 'boolean'])

function refreshMcpServersInBackground(reason: string): void {
  void botManager.refreshMcpServers().catch((error) => {
    console.error(`[MCP] Failed to refresh MCP servers after ${reason}:`, error)
  })
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([key, entry]) => typeof key === 'string' && typeof entry === 'string')
}

function assertStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`${field} must be a string array`)
  }
  return value
}

function assertStringRecord(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {}
  if (!isStringRecord(value)) throw new Error(`${field} must be an object with string values`)
  return value
}

function assertParamSchema(value: unknown): McpServerConfig['paramSchema'] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('paramSchema must be an array')

  const seenKeys = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`paramSchema[${index}] must be an object`)
    }
    const record = item as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key.trim() : ''
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const type = record.type
    if (!key) throw new Error(`paramSchema[${index}].key is required`)
    if (seenKeys.has(key)) throw new Error(`paramSchema key "${key}" is duplicated`)
    if (!label) throw new Error(`paramSchema[${index}].label is required`)
    if (typeof type !== 'string' || !paramTypes.has(type)) throw new Error(`paramSchema[${index}].type is invalid`)
    seenKeys.add(key)
    return {
      key,
      label,
      type: type as NonNullable<McpServerConfig['paramSchema']>[number]['type'],
      ...(typeof record.description === 'string' && record.description.trim() ? { description: record.description.trim() } : {}),
    }
  })
}

function assertUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`)
  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }
}

function normalizeMcpServerPayload(payload: McpServerPayload): McpServerPayload {
  const transportType = payload.transportType
  if (!transportType || !transportTypes.has(transportType)) throw new Error('transportType is invalid')

  const base = {
    ...payload,
    args: assertStringArray(payload.args, 'args'),
    env: assertStringRecord(payload.env, 'env'),
    headers: assertStringRecord(payload.headers, 'headers'),
    paramSchema: assertParamSchema(payload.paramSchema),
  }

  if (transportType === 'sse') {
    return {
      ...base,
      url: assertUrl(payload.url, 'url'),
      command: null,
      args: [],
      env: {},
    }
  }

  if (transportType === 'stdio') {
    if (typeof payload.command !== 'string' || payload.command.trim() === '') throw new Error('command is required')
    return {
      ...base,
      url: null,
      command: payload.command.trim(),
      headers: {},
    }
  }

  return {
    ...base,
    url: assertUrl(payload.url, 'url'),
    command: null,
    args: [],
    env: {},
  }
}

mcpServersRouter.get('/', async (req, res) => {
  res.json(await McpServerRepository.findAll())
})

mcpServersRouter.post('/:id/test', async (req, res) => {
  const server = await McpServerRepository.findById(req.params.id)
  if (!server) { res.status(404).json({ error: 'MCP server not found' }); return }
  try {
    res.json(await probeMcpServer(server))
  } catch {
    res.status(500).json({ error: 'MCP probe failed' })
  }
})

mcpServersRouter.post('/', async (req, res) => {
  try {
    const data = normalizeMcpServerPayload({ ...req.body, botId: null }) as Omit<McpServerConfig, 'id'>
    const server = await McpServerRepository.create(data)
    refreshMcpServersInBackground(`create ${server.name}`)
    res.status(201).json(server)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid MCP server payload' })
  }
})

mcpServersRouter.put('/:id', async (req, res) => {
  try {
    const data = normalizeMcpServerPayload(req.body) as Partial<Omit<McpServerConfig, 'id' | 'botId'>>
    const server = await McpServerRepository.update(req.params.id, data)
    if (!server) { res.status(404).json({ error: 'MCP server not found' }); return }
    refreshMcpServersInBackground(`update ${server.name}`)
    res.json(server)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid MCP server payload' })
  }
})

mcpServersRouter.delete('/:id', async (req, res) => {
  await McpServerRepository.delete(req.params.id)
  refreshMcpServersInBackground(`delete ${req.params.id}`)
  res.status(204).send()
})
