import { randomUUID } from 'crypto'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, extname, join, resolve } from 'path'
import { GeneratedFileRepository } from '../db/generation-repository.js'
import type { GeneratedFile } from '@wecom-platform/types'

const STORAGE_ROOT = resolve(process.env.GENERATED_FILE_STORAGE_ROOT ?? './data/generated-files')

export async function createGeneratedFileFromBuffer(data: {
  taskId?: string | null
  botId?: string | null
  ownerUserId?: string | null
  chatKey?: string | null
  fileType: string
  bytes: Buffer
  extension?: string
  mimeType?: string | null
  expiresAt?: number | null
}): Promise<GeneratedFile> {
  const extension = normalizeExtension(data.extension ?? mimeExtension(data.mimeType) ?? '.bin')
  const storagePath = join(STORAGE_ROOT, `${data.botId ?? 'global'}`, `${randomUUID()}${extension}`)
  await mkdir(dirname(storagePath), { recursive: true })
  await writeFile(storagePath, data.bytes)
  return GeneratedFileRepository.create({
    taskId: data.taskId ?? null,
    botId: data.botId ?? null,
    ownerUserId: data.ownerUserId ?? null,
    chatKey: data.chatKey ?? null,
    fileType: data.fileType,
    storagePath,
    mimeType: data.mimeType ?? null,
    sizeBytes: data.bytes.byteLength,
    expiresAt: data.expiresAt ?? null,
  })
}

export async function getGeneratedFileDownload(accessToken: string): Promise<{ file: GeneratedFile; bytes: Buffer } | null> {
  const file = await GeneratedFileRepository.findByAccessToken(accessToken)
  if (!file) return null
  await stat(file.storagePath)
  return { file, bytes: await readFile(file.storagePath) }
}

export function generatedFileName(file: GeneratedFile): string {
  const ext = extname(file.storagePath) || '.bin'
  return `${file.fileType}-${file.id}${ext}`
}

function normalizeExtension(extension: string): string {
  return extension.startsWith('.') ? extension : `.${extension}`
}

function mimeExtension(mimeType?: string | null): string | null {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'application/pdf') return '.pdf'
  if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return '.pptx'
  return null
}
