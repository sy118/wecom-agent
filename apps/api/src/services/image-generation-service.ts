import { GenerationTaskRepository, ModelConfigRepository } from '../db/generation-repository.js'
import { createGeneratedFileFromBuffer } from './generated-file-service.js'
import { generateImageWithModel } from './image-generation-adapter.js'
import { generationTaskRunner } from './generation-task-runner.js'
import type { GenerationTask } from '@wecom-platform/types'

let registered = false

export function ensureImageGenerationProcessorRegistered(): void {
  if (registered) return
  generationTaskRunner.register('image', executeImageGenerationTask)
  registered = true
}

export async function executeImageGenerationTask(task: GenerationTask): Promise<{ outputFileIds: string[]; cost?: number | null }> {
  if (!task.modelId) throw new Error('Image task has no modelId')
  const model = await ModelConfigRepository.findById(task.modelId)
  if (!model || !model.enabled || model.capability !== 'image_generation') {
    throw new Error('Image generation model is not configured or disabled')
  }
  const prompt = String(task.inputPayload.prompt ?? '').trim()
  if (!prompt) throw new Error('Image prompt is empty')
  const result = await generateImageWithModel(model, prompt)
  const file = await createGeneratedFileFromBuffer({
    taskId: task.id,
    botId: task.botId,
    ownerUserId: task.ownerUserId,
    chatKey: task.chatKey,
    fileType: 'image',
    bytes: result.bytes,
    extension: result.extension,
    mimeType: result.mimeType,
    expiresAt: Date.now() + Number(process.env.GENERATED_FILE_TTL_MS ?? 7 * 24 * 60 * 60_000),
  })
  return { outputFileIds: [file.id], cost: result.cost ?? null }
}

export async function assertImageGenerationCapacity(botId: string, ownerUserId: string, modelId: string, quotaPerUserDaily: number | null, maxConcurrent: number | null): Promise<string | null> {
  if (quotaPerUserDaily !== null) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const used = await GenerationTaskRepository.countByOwnerSince(botId, ownerUserId, 'image', today.getTime())
    if (used >= quotaPerUserDaily) return '今日图片生成额度已用完。'
  }
  if (maxConcurrent !== null) {
    const running = await GenerationTaskRepository.countRunningByModel(botId, modelId)
    if (running >= maxConcurrent) return '图片生成并发已达上限，请稍后重试。'
  }
  return null
}
