import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-template-service-'))
process.env.DB_PATH = join(tempDir, 'template-test.db')

const [{ initDb }, { TemplateRepository }, {
  validateTemplateManifest,
  validateWizardSubmission,
  seedBuiltinTemplates,
  importTemplateJson,
  exportTemplateJson,
  BUILTIN_TEMPLATES,
  __testSupportedCategories,
}] = await Promise.all([
  import('../db/client.js'),
  import('../db/template-repository.js'),
  import('./template-service.js'),
])

before(async () => { await initDb() })
after(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}) })

test('3.1 模板声明校验：合法通过，非法返回可读错误', () => {
  const ok = validateTemplateManifest({
    name: '测试模板',
    description: '描述',
    category: '通用',
    skills: [],
    tools: [{ module: '表格', name: 'sheet.list' }],
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    triggers: ['测试'],
    policy: {},
  })
  assert.equal(ok.ok, true)
  const bad = validateTemplateManifest({ name: '', description: '', category: '', skills: [], tools: [], triggers: [] })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.length > 0)
})

test('3.2 内置 6 个场景模板齐全', () => {
  assert.equal(BUILTIN_TEMPLATES.length, 6)
  const names = BUILTIN_TEMPLATES.map((t) => t.name)
  assert.ok(names.some((n) => n.includes('订单')))
  assert.ok(names.some((n) => n.includes('会议纪要')))
  assert.ok(names.some((n) => n.includes('日程提醒')))
  assert.ok(names.some((n) => n.includes('邮件草稿')))
  assert.ok(names.some((n) => n.includes('表格汇总')))
  assert.ok(names.some((n) => n.includes('通讯录')))
})

test('3.3 内置模板种子、导入导出与非法导入拒绝', async () => {
  const created = await seedBuiltinTemplates('tenant-t1')
  assert.equal(created.length, 6)
  const seeded = await TemplateRepository.findByTenant('tenant-t1')
  assert.equal(seeded.length, 6)

  const first = await TemplateRepository.findById(seeded[0].id)
  const revisions = await TemplateRepository.listRevisions(first!.id)
  const exported = exportTemplateJson(first!, revisions)
  assert.ok(exported.template)
  assert.equal(exported.format, 'wecom-agent-template')

  await assert.rejects(
    () => importTemplateJson({ template: { name: 'x' } }, 'tenant-t1'),
    /不合法|格式|失败/
  )
})

test('3.4 模板版本管理：发布新版保留旧版', async () => {
  const created = await TemplateRepository.create({
    name: '版本模板',
    description: 'desc',
    category: '通用',
    tenantId: 'tenant-v',
    manifest: {
      name: '版本模板',
      description: 'desc',
      category: '通用',
      skills: [],
      tools: [],
      model: null,
      triggers: ['版本'],
      policy: {},
    },
  })
  assert.equal(created.currentVersion, 1)
  const updated = await TemplateRepository.publishNewVersion(created.id, {
    name: '版本模板',
    description: 'v2',
    category: '通用',
    skills: [],
    tools: [],
    model: null,
    triggers: ['版本', 'v2'],
    policy: {},
  })
  assert.equal(updated.currentVersion, 2)
  const revisions = await TemplateRepository.listRevisions(created.id)
  assert.equal(revisions.length, 2)
  const old = await TemplateRepository.getRevision(created.id, 1)
  assert.equal(old!.manifest.description, 'desc')
})

test('3.7 支持分类集合', () => {
  const categories = __testSupportedCategories()
  assert.ok(categories.includes('通用'))
  assert.ok(categories.includes('办公效率'))
})

test('3.6 向导提交校验：错误可读，合法通过', async () => {
  const bad = await validateWizardSubmission({ name: '', model: null, skills: [], triggers: [] }, 'tenant-w')
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.some((e) => e.includes('名称')))
  assert.ok(bad.errors.some((e) => e.includes('触发词')))

  const ok = await validateWizardSubmission({
    name: '订单助手',
    model: { provider: 'openai-compatible', model: 'MiniMax-M2.5' },
    skills: [],
    triggers: ['查订单'],
  }, 'tenant-w')
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
})
