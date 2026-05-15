import cron from 'node-cron'
import { CronExpressionParser } from 'cron-parser'
import type { ScheduledTask } from '@wecom-platform/types'
import { ScheduledTaskRepository } from '../db/scheduled-task-repository.js'
import { ContextRepository } from '../db/context-repository.js'
import type { BotManager } from '../bot-manager/bot-manager.js'

export class TaskScheduler {
  private jobs = new Map<string, cron.ScheduledTask>()

  constructor(private botManager: BotManager) {}

  async loadFromDb(): Promise<void> {
    const tasks = await ScheduledTaskRepository.findAllEnabled()
    for (const task of tasks) {
      this.registerTask(task)
    }
    console.log(`[TaskScheduler] Loaded ${tasks.length} scheduled task(s)`)
  }

  registerTask(task: ScheduledTask): void {
    this.unregisterTask(task.id)
    if (!task.enabled) return
    if (!cron.validate(task.cronExpr)) {
      console.warn(`[TaskScheduler] Invalid cron expression for task ${task.id}: ${task.cronExpr}`)
      return
    }

    const job = cron.schedule(task.cronExpr, () => {
      this.runTask(task).catch((err) => {
        console.error(`[TaskScheduler] Uncaught error in task ${task.id}:`, err)
      })
    })
    this.jobs.set(task.id, job)
  }

  unregisterTask(taskId: string): void {
    const job = this.jobs.get(taskId)
    if (job) {
      job.stop()
      this.jobs.delete(taskId)
    }
  }

  computeNextRunAt(cronExpr: string): number | null {
    try {
      const interval = CronExpressionParser.parse(cronExpr)
      return interval.next().getTime()
    } catch {
      return null
    }
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    const botStatus = this.botManager.getStatus(task.botId)
    if (botStatus !== 'running') {
      console.log(`[TaskScheduler] Skipping task ${task.id}: bot ${task.botId} is ${botStatus}`)
      await this.updateRunTimestamps(task)
      return
    }

    try {
      let systemPrompt = ''
      if (task.contextId) {
        const ctx = await ContextRepository.findById(task.contextId)
        systemPrompt = ctx?.systemPrompt ?? ''
      } else {
        const ctx = await ContextRepository.findDefault(task.botId)
        systemPrompt = ctx?.systemPrompt ?? ''
      }

      const response = await this.botManager.invokeForTask(task.botId, task.promptTemplate, systemPrompt, task.targetChatId)
      await this.botManager.sendMessageForTask(task.botId, task.targetChatId, response)
      console.log(`[TaskScheduler] Task ${task.name} (${task.id}) executed successfully`)
    } catch (err) {
      console.error(`[TaskScheduler] Task ${task.id} failed:`, err)
    } finally {
      await this.updateRunTimestamps(task)
    }
  }

  private async updateRunTimestamps(task: ScheduledTask): Promise<void> {
    const nextRunAt = this.computeNextRunAt(task.cronExpr)
    await ScheduledTaskRepository.update(task.id, {
      lastRunAt: Date.now(),
      nextRunAt: nextRunAt ?? undefined,
    }).catch(() => {})
  }
}
