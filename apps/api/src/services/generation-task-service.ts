import { GeneratedFileRepository, GenerationTaskRepository } from '../db/generation-repository.js'
import type { GeneratedFile, GenerationTask, GenerationTaskType, WecomUserRole } from '@wecom-platform/types'

export const SUPPORTED_GENERATION_TASK_TYPES: GenerationTaskType[] = ['image', 'ppt', 'document', 'spreadsheet', 'archive']

export interface GenerationTaskAccess {
  task: GenerationTask | null
  error?: 'not_found' | 'denied'
}

export async function createGenerationTask(data: {
  botId: string
  taskType: GenerationTaskType | string
  ownerUserId: string
  chatKey: string
  chatId: string
  contextId?: string | null
  modelId?: string | null
  inputPayload?: Record<string, any>
  previewSummary?: string | null
}): Promise<GenerationTask> {
  if (!isSupportedTaskType(data.taskType)) throw new Error(`Unsupported generation task type: ${data.taskType}`)
  if (!enabledGenerationTaskTypes().includes(data.taskType)) throw new Error(`Generation task type is not enabled: ${data.taskType}`)
  return GenerationTaskRepository.create({ ...data, taskType: data.taskType })
}

export async function getGenerationTaskForUser(
  botId: string,
  taskId: string,
  wecomUserId: string,
  role: WecomUserRole
): Promise<GenerationTaskAccess> {
  const task = await GenerationTaskRepository.findById(taskId)
  if (!task || task.botId !== botId) return { task: null, error: 'not_found' }
  if (!await GenerationTaskRepository.canAccess(taskId, wecomUserId, role)) return { task, error: 'denied' }
  return { task }
}

export async function listGeneratedFilesForTask(task: GenerationTask): Promise<GeneratedFile[]> {
  const files = await GeneratedFileRepository.listByTask(task.id)
  const allowedIds = new Set(task.outputFileIds)
  return task.outputFileIds.length > 0 ? files.filter((file) => allowedIds.has(file.id)) : files
}

export function formatGenerationTaskStatus(task: GenerationTask): string {
  const lines = [
    `任务：${task.id}`,
    `类型：${task.taskType}`,
    `状态：${task.status}`,
  ]
  if (task.previewSummary) lines.push(`摘要：${task.previewSummary}`)
  if (task.error) lines.push(`错误：${task.error}`)
  if (task.startedAt) lines.push(`开始时间：${new Date(task.startedAt).toLocaleString()}`)
  if (task.finishedAt) lines.push(`完成时间：${new Date(task.finishedAt).toLocaleString()}`)
  return lines.join('\n')
}

export function enabledGenerationTaskTypes(): GenerationTaskType[] {
  const raw = process.env.ENABLED_GENERATION_TASK_TYPES?.trim()
  if (!raw) return SUPPORTED_GENERATION_TASK_TYPES
  const enabled = raw.split(',').map((item) => item.trim()).filter(isSupportedTaskType)
  return enabled.length > 0 ? enabled : []
}

function isSupportedTaskType(value: string): value is GenerationTaskType {
  return SUPPORTED_GENERATION_TASK_TYPES.includes(value as GenerationTaskType)
}

export function formatGenerationTaskResult(task: GenerationTask, files: GeneratedFile[], baseUrl?: string): string {
  if (task.status === 'failed') return `${formatGenerationTaskStatus(task)}\n任务失败，暂无结果。`
  if (task.status !== 'succeeded') return `${formatGenerationTaskStatus(task)}\n任务尚未完成。`
  if (files.length === 0) return `${formatGenerationTaskStatus(task)}\n任务已完成，但没有可下载文件。`
  const normalizedBaseUrl = baseUrl?.replace(/\/+$/, '')
  if (!normalizedBaseUrl) {
    return [
      `${formatGenerationTaskStatus(task)}`,
      `结果文件：${files.length} 个`,
      '文件已生成，但当前未配置可外部访问的 PUBLIC_BASE_URL，无法生成可点击下载链接。',
      '在企业微信中请点击任务卡片“取结果”重新发送文件；如果仍失败，请联系管理员检查企微媒体上传配置。',
    ].join('\n')
  }
  const links = files.map((file, index) => {
    const path = `/api/generated-files/${encodeURIComponent(file.accessToken)}`
    const url = `${normalizedBaseUrl}${path}`
    return `${index + 1}. ${file.fileType}：${url}`
  })
  return [`${formatGenerationTaskStatus(task)}`, '结果文件：', ...links].join('\n')
}
