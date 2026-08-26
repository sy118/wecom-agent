import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-mcp-service-'))
process.env.DB_PATH = join(tempDir, 'mcp-test.db')
process.env.WECOM_CLI_MCP_ENABLED = 'true'
process.env.APPROVAL_GATE_ENABLED = 'true'

const [{ initDb }, { WecomMcpService, __testMaskParams, WECOM_MCP_TOOL_CATALOG }, { WecomMcpToolRepository }] = await Promise.all([
  import('../db/client.js'),
  import('./wecom-mcp-service.js'),
  import('../db/wecom-mcp-tool-repository.js'),
])

before(async () => { await initDb() })
after(async () => { await rm(tempDir, { recursive: true, force: true }).catch(() => {}) })

test('2.1 注册企微模块工具：声明读写类型与审批要求', async () => {
  assert.ok(WECOM_MCP_TOOL_CATALOG.some((t) => t.module === '表格' && t.name === 'sheet.update' && t.write && t.approvalRequired))
  assert.ok(WECOM_MCP_TOOL_CATALOG.some((t) => t.module === '邮件' && t.name === 'mail.draft' && !t.write))
  const service = new WecomMcpService()
  const tools = await service.ensureRegistered('tenant-a')
  assert.ok(tools.some((t) => t.module === '表格' && t.name === 'sheet.update'))
})

test('2.2 未注册工具调用被拒绝并审计', async () => {
  const service = new WecomMcpService()
  const result = await service.checkAndInvoke('客户', 'crm.search', {
    tenantId: 'tenant-b',
    actorUserId: 'u1',
    params: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'denied')
})

test('2.3 写操作审批门：pending 审批创建与通过/拒绝流转', async () => {
  const service = new WecomMcpService()
  await service.ensureRegistered('tenant-c')
  const pending = await service.checkAndInvoke('邮件', 'mail.send', {
    tenantId: 'tenant-c',
    actorUserId: 'u1',
    params: { to: 'x@y.com', subject: '测试' },
  })
  assert.equal(pending.ok, false)
  assert.equal(pending.status, 'pending_approval')
  assert.ok(pending.approvalId)

  const approved = await service.decideApproval(pending.approvalId!, 'approved', 'admin', '同意')
  assert.equal(approved?.status, 'approved')

  const pending2 = await service.checkAndInvoke('日程', 'calendar.remind', {
    tenantId: 'tenant-c',
    actorUserId: 'u1',
    params: { text: '提醒' },
  })
  assert.equal(pending2.status, 'pending_approval')
  const rejected = await service.decideApproval(pending2.approvalId!, 'rejected', 'admin', '拒绝')
  assert.equal(rejected?.status, 'rejected')
  assert.equal(rejected?.reason, '拒绝')
})

test('2.4 授权过期自动失效并拒绝调用', async () => {
  const service = new WecomMcpService()
  await service.ensureRegistered('tenant-d')
  await WecomMcpToolRepository.setExpiresAt('tenant-d', '表格', 'sheet.list', Date.now() - 1000)
  const result = await service.checkAndInvoke('表格', 'sheet.list', {
    tenantId: 'tenant-d',
    actorUserId: 'u1',
    params: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'expired')
})

test('2.5 调用成功并审计脱敏敏感参数', async () => {
  const service = new WecomMcpService(async () => ({ done: true }))
  await service.ensureRegistered('tenant-e')
  const result = await service.checkAndInvoke('文档', 'doc.list', {
    tenantId: 'tenant-e',
    actorUserId: 'u1',
    params: { folder: 'a', token: 'secret-value' },
  })
  assert.equal(result.ok, true)
  const masked = __testMaskParams({ token: 'secret', cookie: 'abc', normal: 1 })
  assert.equal(masked.token, '***')
  assert.equal(masked.cookie, '***')
  assert.equal(masked.normal, 1)
})

test('2.6 未配置 CLI 时返回 not_configured', async () => {
  delete process.env.WECOM_CLI_MCP_COMMAND
  const service = new WecomMcpService()
  await service.ensureRegistered('tenant-f')
  const result = await service.checkAndInvoke('邮件', 'mail.list', {
    tenantId: 'tenant-f',
    actorUserId: 'u1',
    params: {},
  })
  assert.equal(result.ok, false)
  assert.equal(result.status, 'not_configured')
})
