import assert from 'node:assert/strict'
import test from 'node:test'
import { DoNotDisturbService } from './do-not-disturb-service.js'

test('4.3f 私聊始终回复', () => {
  const service = new DoNotDisturbService()
  const decision = service.decide({ chatType: 'user', message: '你好', botName: '小助手' })
  assert.equal(decision.shouldReply, true)
  assert.equal(decision.reason, 'private')
})

test('4.3g 点名才回：未点名群消息跳过，点名回复', () => {
  const service = new DoNotDisturbService()
  process.env.WECOM_DND_MENTION_ONLY = 'true'
  try {
    const skipped = service.decide({ chatType: 'group', message: '随便聊聊', botName: '小助手', mentioned: false })
    assert.equal(skipped.shouldReply, false)
    assert.equal(skipped.reason, 'mention')
    const replied = service.decide({ chatType: 'group', message: '@小助手 查订单', botName: '小助手', mentioned: true })
    assert.equal(replied.shouldReply, true)
  } finally {
    delete process.env.WECOM_DND_MENTION_ONLY
  }
})

test('4.3h 免打扰时段：未点名跳过，点名仍回复', () => {
  const service = new DoNotDisturbService()
  const quietWindowsRaw = '00:00-23:59'
  const quiet = service.decide({
    chatType: 'group', message: '下午好', botName: '小助手',
    mentioned: false, quietWindowsRaw, now: new Date(2026, 0, 1, 12, 0).getTime(),
  })
  assert.equal(quiet.shouldReply, false)
  assert.equal(quiet.reason, 'quiet_hours')
  const mentioned = service.decide({
    chatType: 'group', message: '@小助手 查订单', botName: '小助手',
    mentioned: true, quietWindowsRaw, now: new Date(2026, 0, 1, 12, 0).getTime(),
  })
  assert.equal(mentioned.shouldReply, true)
})

test('4.3i 群消息节流：第 1 条回复、第 2 条丢弃、第 3 条合并摘要', () => {
  const service = new DoNotDisturbService()
  const now = Date.now()
  const input = { chatType: 'group' as const, message: '消息', botName: '小助手', mentioned: true, throttleWindowMs: 10_000, throttleMaxMessages: 3, chatKey: 'g-throttle' }
  assert.equal(service.decide({ ...input, now }).shouldReply, true)
  assert.equal(service.decide({ ...input, now: now + 100 }).shouldReply, false)
  const merged = service.decide({ ...input, now: now + 200 })
  assert.equal(merged.shouldReply, true)
  assert.equal(merged.merged, true)
  assert.equal(service.decide({ ...input, now: now + 300 }).shouldReply, false)
})

test('4.3j buildSummary 生成可读群消息摘要', () => {
  const service = new DoNotDisturbService()
  const summary = service.buildSummary([
    { sender: '张三', text: '第一问' },
    { text: '匿名消息' },
  ])
  assert.equal(summary.includes('2 条消息'), true)
  assert.equal(summary.includes('张三'), true)
  assert.equal(summary.includes('第一问'), true)
})
