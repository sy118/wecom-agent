import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseDndWindows,
  isInDoNotDisturb,
  contentMentionsBot,
  GroupThrottleGuard,
  makeDisturbanceDecision,
  __testMinutesOfDay,
} from '../services/disturbance-policy.js'

test('parseDndWindows parses multi-window and cross-midnight ranges', () => {
  const windows = parseDndWindows('22:00-07:00,12:00-13:30')
  assert.equal(windows.length, 2)
  assert.deepEqual(windows[0], { fromMinutes: 22 * 60, toMinutes: 7 * 60 })
  assert.equal(__testMinutesOfDay('25:00'), null)
  assert.equal(__testMinutesOfDay('12:61'), null)
  assert.equal(__testMinutesOfDay('09:05'), 545)
})

test('isInDoNotDisturb detects inside and outside windows', () => {
  const windows = parseDndWindows('00:00-23:59')
  assert.equal(isInDoNotDisturb(new Date(2026, 7, 24, 10, 0), windows), true)
  assert.equal(isInDoNotDisturb(new Date(2026, 7, 24, 10, 0), []), false)
})

test('contentMentionsBot detects @mention and bot name', () => {
  assert.equal(contentMentionsBot('@机器人 查一下', '机器人'), true)
  assert.equal(contentMentionsBot('查一下', '机器人'), false)
  assert.equal(contentMentionsBot(undefined, '机器人'), false)
})

test('makeDisturbanceDecision enforces mention-only and DND', () => {
  const decision = makeDisturbanceDecision({
    chatType: 'group', rawText: '普通消息', botName: '机器人',
    mentionOnly: true, dndWindows: [], groupThrottle: null, chatKey: 'wecom:group:g1',
  })
  assert.equal(decision.reply, false)
  assert.equal(decision.reason, 'mention_only')

  const mentioned = makeDisturbanceDecision({
    chatType: 'group', rawText: '@机器人 你好', botName: '机器人',
    mentionOnly: true, dndWindows: [], groupThrottle: null, chatKey: 'wecom:group:g1',
  })
  assert.equal(mentioned.reply, true)

  const dnd = makeDisturbanceDecision({
    chatType: 'single', rawText: '消息', botName: '机器人',
    mentionOnly: false, dndWindows: parseDndWindows('00:00-23:59'), groupThrottle: null, chatKey: 'wecom:user:u1',
  })
  assert.equal(dnd.reply, false)
  assert.equal(dnd.reason, 'do_not_disturb')
})

test('GroupThrottleGuard throttles burst messages in group', () => {
  const guard = new GroupThrottleGuard(10_000, 2)
  const key = 'wecom:group:g2'
  assert.equal(guard.shouldThrottle(key, 1000), false)
  assert.equal(guard.shouldThrottle(key, 1100), false)
  assert.equal(guard.shouldThrottle(key, 1200), true)
  assert.equal(guard.shouldThrottle(key, 12_000), false) // 窗口外恢复
})