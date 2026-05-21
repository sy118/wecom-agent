import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { initDb } from './db/client.js'
import { BotRepository } from './db/bot-repository.js'
import { botManager } from './bot-manager/bot-manager.js'
import { TaskScheduler } from './scheduler/task-scheduler.js'
import { authMiddleware } from './middleware/auth.js'
import { authRouter } from './routes/auth.js'
import { botsRouter } from './routes/bots.js'
import { contextsRouter } from './routes/contexts.js'
import { bindingsRouter } from './routes/bindings.js'
import { mcpServersRouter } from './routes/mcp-servers.js'
import { skillsRouter } from './routes/skills.js'
import { sessionsRouter } from './routes/sessions.js'
import { createScheduledTasksRouter } from './routes/scheduled-tasks.js'
import { wikiRouter } from './routes/wiki.js'
import { wecomEventsRouter } from './routes/wecom-events.js'
import { settingsRouter } from './routes/settings.js'
import type { BotConfig } from '@wecom-platform/types'

const PORT = Number(process.env.API_PORT ?? 3000)
const DB_PATH = process.env.DB_PATH ?? './data/wecom-platform.db'

async function main(): Promise<void> {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  let botsToAutoStart: BotConfig[] = []
  try {
    botsToAutoStart = await BotRepository.findByStatus('running')
  } catch {
    // DB may not exist yet on first run — ignore
  }

  await initDb()

  // Initialize TaskScheduler after BotManager (single-direction dependency)
  const taskScheduler = new TaskScheduler(botManager)
  await taskScheduler.loadFromDb()

  const app = express()
  app.use(cors())
  app.use('/api/wecom/events', express.raw({ type: '*/*', limit: '2mb' }), wecomEventsRouter)
  app.use(express.json())

  app.use('/api/auth', authRouter)

  app.use('/api/bots', authMiddleware, botsRouter)
  app.use('/api/bots/:botId/contexts', authMiddleware, contextsRouter)
  app.use('/api/bots/:botId/bindings', authMiddleware, bindingsRouter)
  app.use('/api/bots/:botId/scheduled-tasks', authMiddleware, createScheduledTasksRouter(taskScheduler))
  app.use('/api/mcp-servers', authMiddleware, mcpServersRouter)
  app.use('/api/skills', authMiddleware, skillsRouter)
  app.use('/api/scheduled-tasks', authMiddleware, createScheduledTasksRouter(taskScheduler))
  app.use('/api/sessions', authMiddleware, sessionsRouter)
  app.use('/api/wiki', authMiddleware, wikiRouter)
  app.use('/api/settings', authMiddleware, settingsRouter)

  app.listen(PORT, () => {
    console.log(`[API] Server running on port ${PORT}`)
    autoStartBots(botsToAutoStart)
  })
}

async function autoStartBots(bots: BotConfig[]): Promise<void> {
  if (bots.length === 0) {
    console.log('[API] Ready. No bots to auto-start.')
    return
  }
  console.log(`[API] Auto-starting ${bots.length} bot(s)...`)
  for (const bot of bots) {
    try {
      await botManager.start(bot.id)
      console.log(`[API] Auto-started bot: ${bot.name} (${bot.id})`)
    } catch (err) {
      console.error(`[API] Failed to auto-start bot ${bot.id}:`, err)
    }
  }
}

main().catch((err) => {
  console.error('[API] Fatal startup error:', err)
  process.exit(1)
})
