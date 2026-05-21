import { Router } from 'express'
import { McpServerRepository } from '../db/mcp-server-repository.js'
import { botManager } from '../bot-manager/bot-manager.js'
import type { McpServerConfig, McpServerTransportType } from '@wecom-platform/types'

export const mcpServersRouter: Router = Router({ mergeParams: true })

type McpServerPayload = Omit<McpServerConfig, 'id'> | Partial<Omit<McpServerConfig, 'id' | 'botId'>>

const transportTypes = new Set<McpServerTransportType>(['sse', 'stdio', 'streamable-http'])

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
  }

  if (transportType === 'sse') {
    return {
      ...base,
      url: assertUrl(payload.url, 'url'),
      command: null,
      args: [],
      env: {},
      headers: {},
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

mcpServersRouter.post('/', async (req, res) => {
  try {
    const data = normalizeMcpServerPayload({ ...req.body, botId: null }) as Omit<McpServerConfig, 'id'>
    const server = await McpServerRepository.create(data)
    await botManager.refreshMcpServers()
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
    await botManager.refreshMcpServers()
    res.json(server)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid MCP server payload' })
  }
})

mcpServersRouter.delete('/:id', async (req, res) => {
  await McpServerRepository.delete(req.params.id)
  await botManager.refreshMcpServers()
  res.status(204).send()
})
