import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'
import { LocalMediaStore, generateMediaId, mediaExtension } from './media-store.js'

const tempDir = await mkdtemp(join(tmpdir(), 'wecom-media-'))

after(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {})
})

test('generateMediaId is deterministic for sha256 prefix and unique by timestamp', () => {
  const bytes = new Uint8Array([1, 2, 3])
  const a = generateMediaId(bytes)
  const b = generateMediaId(bytes)
  assert.ok(a.startsWith('wecom_'))
  assert.match(a, /^wecom_[0-9a-f]{16}_\d+$/)
  assert.notEqual(a, b) // different timestamps
})

test('mediaExtension maps mime types', () => {
  assert.equal(mediaExtension('image', 'image/png'), '.png')
  assert.equal(mediaExtension('video', 'video/mp4'), '.mp4')
  assert.equal(mediaExtension('file', null), '.bin')
})

test('LocalMediaStore put/get/stat/exists roundtrip', async () => {
  const store = new LocalMediaStore(join(tempDir, 'root'))
  const bytes = new Uint8Array([10, 20, 30, 40])
  const statResult = await store.put('a/b/file.jpg', bytes, { mime: 'image/jpeg' })
  assert.equal(statResult.sizeBytes, 4)
  assert.equal(statResult.mime, 'image/jpeg')

  assert.equal(await store.exists('a/b/file.jpg'), true)
  const read = await store.get('a/b/file.jpg')
  assert.deepEqual([...read!], [10, 20, 30, 40])
  const statAgain = await store.stat('a/b/file.jpg')
  assert.equal(statAgain?.sizeBytes, 4)
  await store.delete('a/b/file.jpg')
  assert.equal(await store.exists('a/b/file.jpg'), false)
})

test('LocalMediaStore rejects path traversal and empty keys', async () => {
  const store = new LocalMediaStore(join(tempDir, 'root2'))
  await assert.rejects(() => store.put('../evil.jpg', new Uint8Array(1)))
  await assert.rejects(() => store.put('', new Uint8Array(1)))
  await assert.rejects(() => store.get('../evil.jpg'))
  await assert.rejects(() => store.get(''))
})