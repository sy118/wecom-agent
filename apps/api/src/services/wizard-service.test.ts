import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-wizard-'))
process.env.DB_PATH = join(tempDir, 'wizard-test.db')

const [{ initDb }, { BotTriggerRepository }, { BotRepository }, { WizardService, simulateTestRun }] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-trigger-repository.js'),
  import('../db/bot-repository.js'),
  import('./wizard-service.js'),
])

const service = new WizardService()
await initDb()

after(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}) })

test('3.5 向导草稿可保存与续写', async () => {
  const draft = await service.saveDraft('tenant-w1', {
    step: 2,
    draft: { name: '测试 Bot', model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' } },
  })
  assert.equal(draft.step, 2)
  const resumed = await service.getDraft('tenant-w1')
  assert.equal(resumed?.id, draft.id)
  assert.equal(resumed?.data.name, '测试 Bot')
})

test('3.6 提交校验：名称/模型/触发词错误可读', async () => {
  const result = await service.validate({
    tenantId: 'tenant-w2',
    name: '',
    model: null,
    skills: [],
    triggers: [],
    templateId: null,
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((e) => e.field === 'name'))
  assert.ok(result.errors.some((e) => e.field === 'model'))
  assert.ok(result.errors.some((e) => e.field === 'triggers'))
})

test('3.6b 合法提交通过且不存在的模板被拒绝', async () => {
  const ok = await service.validate({
    tenantId: 'tenant-w3',
    name: '订单助手',
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    skills: [],
    triggers: ['查订单'],
    templateId: null,
  })
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
  const badTemplate = await service.validate({
    tenantId: 'tenant-w3',
    name: '订单助手',
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    skills: [],
    triggers: ['查订单'],
    templateId: 'not-exist',
  })
  assert.equal(badTemplate.ok, false)
  assert.ok(badTemplate.errors.some((e) => e.field === 'templateId'))
})

test('3.6c 触发词冲突被拒绝', async () => {
  const bot = await BotRepository.create({
    name: '已有 Bot',
    wecomBotId: 'wizard-wecom-existing',
    wecomBotSecret: 'secret',
    wecomWsUrl: 'wss://example.invalid/ws',
    llmApiKey: 'key',
    llmBaseUrl: 'https://llm.example.invalid/v1',
    llmModel: 'MiniMax-M2.5',
    provider: 'openai-compatible',
    streamingMode: 'none',
    difyBaseUrl: null,
    difyApiKey: null,
    difyAppId: null,
    visionEnabled: false,
  })
  await BotTriggerRepository.replaceForBot(bot.id, 'tenant-w4', ['查订单'])
  const conflict = await service.validate({
    tenantId: 'tenant-w4',
    name: '新 Bot',
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    skills: [],
    triggers: ['查订单'],
    templateId: null,
  })
  assert.equal(conflict.ok, false)
  assert.ok(conflict.errors.some((e) => e.field === 'triggers' && e.message.includes('触发词已被其他 Bot 占用')))
})

test('3.6d buildBotConfig 生成标准配置与清单', async () => {
  const built = await service.buildBotConfig({
    tenantId: 'tenant-w5',
    name: '订单助手',
    description: '描述',
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    skills: ['order'],
    triggers: ['查订单'],
    templateId: null,
  })
  assert.equal(built.config.name, '订单助手')
  assert.deepEqual(built.config.triggers, ['查订单'])
  assert.equal(built.manifest.tools.length, 0)
  const run = simulateTestRun('帮我查订单', ['查订单'])
  assert.equal(run.reply.includes('测试通过'), true)
  assert.ok(run.stages.includes('queued'))
  const miss = simulateTestRun('随便聊聊', ['查订单'])
  assert.equal(miss.reply.includes('未匹配'), true)
})
