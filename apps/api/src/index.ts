import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { existsSync, mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
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
import { wecomEventsRouter } from './routes/wecom-events.js'
import { settingsRouter } from './routes/settings.js'
import { wecomCommandConfigRouter } from './routes/wecom-command-config.js'
import { generatedFilesRouter } from './routes/generated-files.js'
import { runsRouter } from './routes/runs.js'
import { mediaRouter } from './routes/media.js'
import { migrateHistoricalMedia, cleanupExpiredMedia } from './services/media-maintenance-service.js'
import { wecomMcpRouter } from './routes/wecom-mcp.js'
import { agentTemplatesRouter } from './routes/agent-templates.js'
import { onboardingRouter } from './routes/onboarding.js'
import { governanceRouter } from './routes/governance.js'
import { TenantRepository } from './db/tenant-repository.js'
import { seedBuiltinTemplates } from './services/template-service.js'
import { AsyncLimiter } from '@wecom-platform/core'
import type { BotConfig } from '@wecom-platform/types'

const PORT = Number(process.env.API_PORT ?? 3000)
const DB_PATH = process.env.DB_PATH ?? './data/wecom-platform.db'
const WEB_DIST_DIR = process.env.WEB_DIST_DIR
  ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
const WEB_INDEX_FILE = resolve(WEB_DIST_DIR, 'index.html')

function configuredPositiveInt(envKey: string, fallback: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function main(): Promise<void> {
  mkdirSync(dirname(DB_PATH), { recursive: true })

  let botsToAutoStart: BotConfig[] = []
  try {
    botsToAutoStart = await BotRepository.findByStatus('running')
  } catch {
    // DB may not exist yet on first run — ignore
  }

  await initDb()
  await TenantRepository.ensureDefaultTenant()
  void seedBuiltinTemplates('default').then((created) => {
    console.log(`[Templates] Seeded ${created.length} builtin template(s)`)
  }).catch((err) => console.error('[Templates] Seed failed:', err))

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
  app.use('/api/settings', authMiddleware, settingsRouter)
  app.use('/api/runs', authMiddleware, runsRouter)
  app.use('/api/wecom-mcp', authMiddleware, wecomMcpRouter)
  app.use('/api/media', authMiddleware, mediaRouter)
  app.use('/api/agent-templates', authMiddleware, agentTemplatesRouter)
  app.use('/api/onboarding', authMiddleware, onboardingRouter)
  app.use('/api/governance', authMiddleware, governanceRouter)

  // 媒体历史迁移（启动后台执行）+ 每日清理
  void migrateHistoricalMedia().then((report) => {
    console.log(`[Media] Historical migration complete: scanned=${report.scanned}, migrated=${report.migrated}, expired=${report.expired}, skipped=${report.skipped}`)
  }).catch((err) => console.error('[Media] Historical migration failed:', err))

  const MEDIA_CLEANUP_INTERVAL_MS = configuredPositiveInt('WECOM_MEDIA_CLEANUP_INTERVAL_MS', 24 * 60 * 60 * 1000)
  setInterval(() => {
    void cleanupExpiredMedia().then((report) => {
      console.log(`[Media] Cleanup complete: expired=${report.expired}, deleted=${report.deleted}, freedBytes=${report.freedBytes}`)
    }).catch((err) => console.error('[Media] Cleanup failed:', err))
  }, MEDIA_CLEANUP_INTERVAL_MS)

  if (existsSync(WEB_INDEX_FILE)) {
    app.use(express.static(WEB_DIST_DIR))
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(WEB_INDEX_FILE)
    })
    console.log(`[API] Serving web assets from ${WEB_DIST_DIR}`)
  } else {
    console.warn(`[API] Web assets not found at ${WEB_DIST_DIR}; serving API only.`)
  }

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
  const limiter = new AsyncLimiter(configuredPositiveInt('BOT_AUTO_START_CONCURRENCY', 3))
  await Promise.all(bots.map((bot) => limiter.run(async () => {
    try {
      await botManager.start(bot.id)
      console.log(`[API] Auto-started bot: ${bot.name} (${bot.id})`)
    } catch (err) {
      console.error(`[API] Failed to auto-start bot ${bot.id}:`, err)
    }
  })))
}

main().catch((err) => {
  console.error('[API] Fatal startup error:', err)
  process.exit(1)
})
