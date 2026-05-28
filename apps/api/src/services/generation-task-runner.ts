import { GenerationTaskRepository } from '../db/generation-repository.js'
import { AuditLogRepository } from '../db/wecom-access-repository.js'
import { logStructured } from './observability.js'
import type { GenerationTask, GenerationTaskType } from '@wecom-platform/types'

export interface GenerationTaskProcessorResult {
  outputFileIds?: string[]
  cost?: number | null
}

export type GenerationTaskProcessor = (task: GenerationTask) => Promise<GenerationTaskProcessorResult>

export class GenerationTaskRunner {
  private processors = new Map<GenerationTaskType, GenerationTaskProcessor>()
  private queue: string[] = []
  private running = 0

  constructor(private maxConcurrent = Number(process.env.GENERATION_TASK_CONCURRENCY ?? 1)) {}

  register(taskType: GenerationTaskType, processor: GenerationTaskProcessor): void {
    this.processors.set(taskType, processor)
  }

  enqueue(taskId: string): void {
    this.queue.push(taskId)
    void this.drain()
  }

  get size(): number {
    return this.queue.length + this.running
  }

  private async drain(): Promise<void> {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const taskId = this.queue.shift()!
      this.running++
      void this.runOne(taskId).finally(() => {
        this.running--
        void this.drain()
      })
    }
  }

  private async runOne(taskId: string): Promise<void> {
    const task = await GenerationTaskRepository.findById(taskId)
    if (!task) return
    const processor = this.processors.get(task.taskType)
    if (!processor) {
      await GenerationTaskRepository.markFailed(task.id, `Task type is not enabled: ${task.taskType}`)
      await this.audit(task, 'failure', `Task type is not enabled: ${task.taskType}`)
      return
    }
    const runningTask = await GenerationTaskRepository.markRunning(task.id)
    if (!runningTask || runningTask.status !== 'running') return
    try {
      const result = await processor(runningTask)
      await GenerationTaskRepository.markSucceeded(task.id, result.outputFileIds ?? [], result.cost ?? null)
      await this.audit(task, 'success', null, { outputFileIds: result.outputFileIds ?? [], cost: result.cost ?? null })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      await GenerationTaskRepository.markFailed(task.id, reason)
      await this.audit(task, 'failure', reason)
    }
  }

  private async audit(task: GenerationTask, result: 'success' | 'failure', reason: string | null, payload: Record<string, any> = {}): Promise<void> {
    logStructured('generation.task', {
      botId: task.botId,
      taskId: task.id,
      taskType: task.taskType,
      ownerUserId: task.ownerUserId,
      result,
      reason,
      ...payload,
    })
    await AuditLogRepository.create({
      botId: task.botId,
      actorUserId: task.ownerUserId,
      chatKey: task.chatKey,
      action: `generation.${task.taskType}`,
      targetType: 'generation_task',
      targetId: task.id,
      result,
      reason,
      payload,
    }).catch(() => {})
  }
}

export const generationTaskRunner = new GenerationTaskRunner()
