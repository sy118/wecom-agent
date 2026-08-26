import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageQueue } from './message-queue.js'
import { AsyncLimiter } from './async-limiter.js'

test('MessageQueue exposes queue size including running task', async () => {
  const queue = new MessageQueue()
  assert.equal(queue.size, 0)
  assert.equal(queue.isRunning, false)

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  queue.enqueue(async () => { await gate })
  assert.equal(queue.size, 1)
  assert.equal(queue.isRunning, true)

  queue.enqueue(async () => {})
  assert.equal(queue.size, 2)

  release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(queue.size, 0)
})

test('AsyncLimiter exposes active and pending counts', async () => {
  const limiter = new AsyncLimiter(1)
  assert.equal(limiter.activeCount, 0)
  assert.equal(limiter.pendingCount, 0)

  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const first = limiter.run(async () => { await gate })
  assert.equal(limiter.activeCount, 1)
  assert.equal(limiter.pendingCount, 0)

  const second = limiter.run(async () => {})
  assert.equal(limiter.activeCount, 1)
  assert.equal(limiter.pendingCount, 1)

  release()
  await first
  await second
  assert.equal(limiter.activeCount, 0)
  assert.equal(limiter.pendingCount, 0)
})