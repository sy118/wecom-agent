import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import test, { after, before } from 'node:test'
import express from 'express'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-generation-service-'))
process.env.DB_PATH = join(tempDir, 'api-test.db')
process.env.GENERATED_FILE_STORAGE_ROOT = join(tempDir, 'files')
process.env.DEFAULT_SESSION_TTL_MIN = '30'

const [
  { db, initDb },
  { BotRepository },
  { GenerationTaskRepository, ModelConfigRepository },
  { createGeneratedFileFromBuffer },
  { GenerationTaskRunner },
  { createGenerationTask },
  { executeImageGenerationTask, ensureImageGenerationProcessorRegistered },
  { generatedFilesRouter },
] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-repository.js'),
  import('../db/generation-repository.js'),
  import('./generated-file-service.js'),
  import('./generation-task-runner.js'),
  import('./generation-task-service.js'),
  import('./image-generation-service.js'),
  import('../routes/generated-files.js'),
])

let server: Server
let baseUrl = ''
let modelServer: Server
let modelBaseUrl = ''
let modelMode: 'success' | 'failure' | 'rate_limit' | 'timeout' = 'success'

before(async () => {
  await initDb()
  const app = express()
  app.use('/api/generated-files', generatedFilesRouter)
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`

  const modelApp = express()
  modelApp.use(express.json())
  modelApp.post('/images/generations', async (_req, res) => {
    if (modelMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 120))
      res.json({ data: [{ b64_json: Buffer.from('late').toString('base64') }] })
      return
    }
    if (modelMode === 'rate_limit') {
      res.status(429).json({ error: { message: 'rate limited' } })
      return
    }
    if (modelMode === 'failure') {
      res.status(400).json({ error: { message: 'content policy rejected' } })
      return
    }
    res.json({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64'), mime_type: 'image/png' }], usage: { cost: 0.2 } })
  })
  await new Promise<void>((resolve) => {
    modelServer = modelApp.listen(0, '127.0.0.1', () => resolve())
  })
  const modelAddress = modelServer.address() as AddressInfo
  modelBaseUrl = `http://127.0.0.1:${modelAddress.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve())
  })
  await new Promise<void>((resolve, reject) => {
    modelServer.close((err) => err ? reject(err) : resolve())
  })
  ;(db as any).close?.()
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

async function createBot(name: string) {
  return BotRepository.create({
    name,
    wecomBotId: `${name}-wecom-id`,
    wecomBotSecret: 'wecom-secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'llm-key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'test-model',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
}

async function waitFor(assertion: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(await assertion(), true)
}

test('generated file route returns token files and rejects expired files', async () => {
  const bot = await createBot('file-bot')
  const task = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'image',
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    chatId: 'chat-id',
  })
  const file = await createGeneratedFileFromBuffer({
    taskId: task.id,
    botId: bot.id,
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    fileType: 'image',
    bytes: Buffer.from('image-bytes'),
    extension: '.txt',
    mimeType: 'text/plain',
    expiresAt: Date.now() + 60_000,
  })
  const response = await fetch(`${baseUrl}/api/generated-files/${file.accessToken}`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'image-bytes')

  const expired = await createGeneratedFileFromBuffer({
    botId: bot.id,
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    fileType: 'image',
    bytes: Buffer.from('expired'),
    extension: '.txt',
    expiresAt: Date.now() - 1000,
  })
  assert.equal((await fetch(`${baseUrl}/api/generated-files/${expired.accessToken}`)).status, 404)
})

test('GenerationTaskRunner executes tasks asynchronously and fails disabled task types', async () => {
  const bot = await createBot('runner-bot')
  const runner = new GenerationTaskRunner(1)
  const imageTask = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'image',
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    chatId: 'chat-id',
  })
  runner.register('image', async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { outputFileIds: [], cost: 0.01 }
  })

  const startedAt = Date.now()
  runner.enqueue(imageTask.id)
  assert.equal(Date.now() - startedAt < 20, true)
  await waitFor(async () => (await GenerationTaskRepository.findById(imageTask.id))?.status === 'succeeded')
  assert.equal((await GenerationTaskRepository.findById(imageTask.id))?.cost, 0.01)

  const pptTask = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'ppt',
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    chatId: 'chat-id',
  })
  runner.enqueue(pptTask.id)
  await waitFor(async () => (await GenerationTaskRepository.findById(pptTask.id))?.status === 'failed')
  assert.match((await GenerationTaskRepository.findById(pptTask.id))?.error ?? '', /not enabled/)
})

test('image generation processor saves files on success', async () => {
  modelMode = 'success'
  const bot = await createBot('image-success-bot')
  const model = await ModelConfigRepository.create({
    botId: bot.id,
    name: 'Mock image model',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    baseUrl: modelBaseUrl,
    apiKey: 'test-key',
    timeoutMs: 1000,
  })
  const task = await GenerationTaskRepository.create({
    botId: bot.id,
    taskType: 'image',
    ownerUserId: 'user-a',
    chatKey: 'chat-1',
    chatId: 'chat-id',
    modelId: model.id,
    inputPayload: { prompt: 'draw a launch chart' },
  })

  const result = await executeImageGenerationTask(task)
  assert.equal(result.outputFileIds.length, 1)
  assert.equal(result.cost, 0.2)
})

test('image generation runner records model failures, timeouts, and rate limits on tasks', async () => {
  const bot = await createBot('image-failure-bot')
  const model = await ModelConfigRepository.create({
    botId: bot.id,
    name: 'Mock image model failures',
    provider: 'openai-compatible-image',
    modelName: 'gpt-image2',
    capability: 'image_generation',
    baseUrl: modelBaseUrl,
    apiKey: 'test-key',
    timeoutMs: 20,
  })
  ensureImageGenerationProcessorRegistered()

  for (const [mode, expected] of [
    ['failure', /content policy/i],
    ['rate_limit', /rate limited/i],
    ['timeout', /timed out/i],
  ] as const) {
    modelMode = mode
    const task = await GenerationTaskRepository.create({
      botId: bot.id,
      taskType: 'image',
      ownerUserId: 'user-a',
      chatKey: 'chat-1',
      chatId: 'chat-id',
      modelId: model.id,
      inputPayload: { prompt: 'draw a blocked image' },
    })
    const { generationTaskRunner } = await import('./generation-task-runner.js')
    generationTaskRunner.enqueue(task.id)
    await waitFor(async () => (await GenerationTaskRepository.findById(task.id))?.status === 'failed')
    assert.match((await GenerationTaskRepository.findById(task.id))?.error ?? '', expected)
  }
})

test('createGenerationTask rejects unknown and disabled task types', async () => {
  const bot = await createBot('task-type-bot')
  await assert.rejects(
    () => createGenerationTask({
      botId: bot.id,
      taskType: 'unknown' as any,
      ownerUserId: 'user-a',
      chatKey: 'chat-1',
      chatId: 'chat-id',
    }),
    /Unsupported generation task type/
  )

  const original = process.env.ENABLED_GENERATION_TASK_TYPES
  process.env.ENABLED_GENERATION_TASK_TYPES = 'image'
  try {
    await assert.rejects(
      () => createGenerationTask({
        botId: bot.id,
        taskType: 'ppt',
        ownerUserId: 'user-a',
        chatKey: 'chat-1',
        chatId: 'chat-id',
      }),
      /not enabled/
    )
  } finally {
    if (original === undefined) delete process.env.ENABLED_GENERATION_TASK_TYPES
    else process.env.ENABLED_GENERATION_TASK_TYPES = original
  }
})
