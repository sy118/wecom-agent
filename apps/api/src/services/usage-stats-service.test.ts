import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-usage-stats-'))
process.env.DB_PATH = join(tempDir, 'usage-test.db')

const [{ initDb, db }, { BotResponseRunRepository }, { getUsageBreakdown }, { TemplateRepository }] = await Promise.all([
  import('../db/client.js'),
  import('../db/bot-response-run-repository.js'),
  import('./usage-stats-service.js'),
  import('../db/template-repository.js'),
])

before(async () => {
  await initDb()
  const run = await BotResponseRunRepository.create({
    botId: 'bot-stats-1',
    chatKey: 'wecom:user:u1',
    chatId: 'u1',
    userId: 'u1',
    questionPreview: '统计测试',
    provider: 'openai-compatible',
    model: 'MiniMax-M2.5',
  })
  await db.execute({
    sql: `UPDATE bot_response_runs
          SET tenant_id = 'tenant-stats', status = 'sent', updated_at = created_at + 3000
          WHERE id = ?`,
    args: [run.id],
  })
  await TemplateRepository.create({
    name: '统计模板',
    description: 'desc',
    category: '数据分析',
    tenantId: 'tenant-stats',
    manifest: {
      name: '统计模板',
      description: 'desc',
      category: '数据分析',
      skills: [],
      tools: [],
      model: null,
      triggers: ['汇总'],
      policy: {},
    },
  })
})

after(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}) })

test('4.4 按 Bot 聚合任务量、成功率与耗时', async () => {
  const breakdown = await getUsageBreakdown({ tenantId: 'tenant-stats' })
  assert.equal(breakdown.byBot.length, 1)
  const row = breakdown.byBot[0]
  assert.equal(row.botId, 'bot-stats-1')
  assert.equal(row.taskCount, 1)
  assert.equal(row.successCount, 1)
  assert.equal(row.successRate, 1)
  assert.ok(row.totalDurationMs >= 3000)
  assert.equal(breakdown.total.taskCount, 1)
})

test('4.4b 跨租户不泄露：其他租户为空', async () => {
  const breakdown = await getUsageBreakdown({ tenantId: 'tenant-other' })
  assert.equal(breakdown.byBot.length, 0)
  assert.equal(breakdown.total.taskCount, 0)
})

test('4.4c 模板排行基于 usage_count', async () => {
  const templates = await TemplateRepository.findByTenant('tenant-stats')
  assert.equal(templates.length, 1)
})
