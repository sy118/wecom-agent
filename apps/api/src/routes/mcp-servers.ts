import { Router } from 'express'
import { McpServerRepository } from '../db/mcp-server-repository.js'

export const mcpServersRouter: Router = Router({ mergeParams: true })

mcpServersRouter.get('/', async (req, res) => {
  res.json(await McpServerRepository.findAll())
})

mcpServersRouter.post('/', async (req, res) => {
  const data = { ...req.body, botId: null }
  res.status(201).json(await McpServerRepository.create(data))
})

mcpServersRouter.put('/:id', async (req, res) => {
  const server = await McpServerRepository.update(req.params.id, req.body)
  if (!server) { res.status(404).json({ error: 'MCP server not found' }); return }
  res.json(server)
})

mcpServersRouter.delete('/:id', async (req, res) => {
  await McpServerRepository.delete(req.params.id)
  res.status(204).send()
})
