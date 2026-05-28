import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWecomCommand, splitCommandArgs } from './wecom-command-parser.js'

test('splitCommandArgs preserves quoted values', () => {
  assert.deepEqual(splitCommandArgs('image "blue sky" size=1024\\ x\\ 1024'), ['image', 'blue sky', 'size=1024 x 1024'])
})

test('parseWecomCommand ignores ordinary messages', () => {
  assert.equal(parseWecomCommand('hello /ctx current'), null)
})

test('parseWecomCommand parses context commands', () => {
  assert.deepEqual(parseWecomCommand('/ctx current'), {
    raw: '/ctx current',
    commandText: 'ctx current',
    commandKey: 'ctx.current',
    base: 'ctx',
    subcommand: 'current',
    args: [],
    isKnown: true,
  })
  assert.equal(parseWecomCommand('/ctx')?.commandKey, 'ctx.current')
  assert.deepEqual(parseWecomCommand('/ctx use "Sales Ops"')?.args, ['Sales Ops'])
})

test('parseWecomCommand parses task, image, admin, confirm, and unknown commands', () => {
  assert.deepEqual(parseWecomCommand('/image a red poster')?.args, ['a', 'red', 'poster'])
  assert.equal(parseWecomCommand('/task status task-1')?.commandKey, 'task.status')
  assert.equal(parseWecomCommand('/task result task-1')?.commandKey, 'task.result')
  assert.equal(parseWecomCommand('/admin ctx grant user-a ctx-a')?.commandKey, 'admin.ctx.grant')
  assert.equal(parseWecomCommand('/admin ctx delete user-a ctx-a')?.commandKey, 'admin.ctx.revoke')
  assert.equal(parseWecomCommand('/confirm abc123')?.commandKey, 'confirm')
  assert.equal(parseWecomCommand('/unknown')?.isKnown, false)
})

test('parseWecomCommand reads the first text item from mixed content', () => {
  const parsed = parseWecomCommand([
    { type: 'image', url: 'https://example.invalid/a.png' },
    { type: 'text', text: '/help' },
  ])

  assert.equal(parsed?.commandKey, 'help')
})
