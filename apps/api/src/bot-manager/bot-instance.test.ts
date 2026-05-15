import assert from 'node:assert/strict'
import test from 'node:test'
import { getVisionFallbackSessionMessages, degradeVisionContent, isVisionFallbackError } from './bot-instance.js'

test('Vision fallback retries without prior session history', () => {
  const priorMessages = [
    { role: 'human' as const, content: '上一张图是什么', timestamp: 1 },
    { role: 'ai' as const, content: '这是旧图答案', timestamp: 2 },
  ]

  const fallbackMessages = getVisionFallbackSessionMessages(priorMessages)

  assert.deepEqual(fallbackMessages, [])
  assert.notEqual(fallbackMessages, priorMessages)
})

test('Vision fallback recognizes multimodal rejection status codes', () => {
  assert.equal(isVisionFallbackError({ response: { status: 400 } }), true)
  assert.equal(isVisionFallbackError({ status: 422 }), true)
  assert.equal(isVisionFallbackError({ status: 500 }), false)
})

test('Vision fallback keeps current prompt text and image marker', () => {
  const degraded = degradeVisionContent([
    { type: 'text', text: '识别' },
    { type: 'image', url: 'https://example.invalid/a.jpg' },
  ])

  assert.equal(degraded, '识别\n[图片: https://example.invalid/a.jpg]')
})
