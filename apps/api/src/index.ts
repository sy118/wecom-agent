import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { initDb } from './db/client.js'
import { BotRepository } from './db/bot-repository.js'
import { botManager } from './bot-manager/bot-manager.js'
import { TaskScheduler } from './scheduler/task-scheduler.js'
import { generationTaskRunner } from './services/generation-task-runner.js'
import { formatGenerationTaskResult, listGeneratedFilesForTask } from './services/generation-task-service.js'
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
import { wecomCommandConfigRouter } from './routes/wecom-command-config.js'
import { generatedFilesRouter } from './routes/generated-files.js'
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
  app.use('/api/generated-files', generatedFilesRouter)

  app.use('/api/bots', authMiddleware, botsRouter)
  app.use('/api/bots/:botId/contexts', authMiddleware, contextsRouter)
  app.use('/api/bots/:botId/bindings', authMiddleware, bindingsRouter)
  app.use('/api/bots/:botId/wecom-command-config', authMiddleware, wecomCommandConfigRouter)
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

generationTaskRunner.on('finished', async ({ task }) => {
  if (!task.chatId) return
  try {
    const files = await listGeneratedFilesForTask(task)
    const taskName = task.taskType === 'image' ? '图片生成' : '生成任务'
    if (task.status === 'succeeded' && files.length > 0) {
      const sentCount = await botManager.sendGeneratedFilesForTask(task.botId, task.chatId, files)
      if (sentCount > 0) {
        await botManager.sendMessageForTask(
          task.botId,
          task.chatId,
          sentCount === files.length
            ? `${taskName}已完成，已发送 ${sentCount} 个结果文件。`
            : `${taskName}已完成，已发送 ${sentCount}/${files.length} 个结果文件，其余文件发送失败，可点击任务卡片“取结果”重试。`
        )
        return
      }
    }
    const prefix = task.status === 'succeeded'
      ? `${taskName}已完成，结果如下：`
      : `${taskName}失败，详情如下：`
    await botManager.sendMessageForTask(
      task.botId,
      task.chatId,
      `${prefix}\n${formatGenerationTaskResult(task, files, process.env.PUBLIC_BASE_URL)}`
    )
  } catch (err) {
    console.error(`[GenerationTaskRunner] Failed to push task result ${task.id}:`, err)
  }
})

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
