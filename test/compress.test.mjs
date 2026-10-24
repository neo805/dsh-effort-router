/**
 * compress.js tests — the gzip-ratio discount: small-text guard, the ratio
 * clamp, and the repetition sensitivity the token count is blind to.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCompressor, COMPRESS_MIN_BYTES } from '../lib/compress.js'

test('texts below the byte floor are never measured (null = ratio 1)', () => {
  const c = createCompressor()
  assert.equal(c.ratio(['tiny']), null)
  assert.equal(c.ratio([]), null)
  assert.equal(c.ratio(undefined), null)
  assert.equal(c.ratio(['', '']), null)
})

test('repetition compresses away; varied prose does not', () => {
  const c = createCompressor()
  const loop = Array.from({ length: 8 }, () => '2026-10-10 INFO worker heartbeat ok').join('\n').repeat(10)
  const measured = c.ratio([loop])
  assert.ok(measured, 'the loop is above the floor')
  assert.ok(measured.ratio < 0.1, 'a loop log is almost all redundancy: ' + measured.ratio)
  // Genuinely varied tokens (no template for gzip to latch onto).
  const prose = Array.from({ length: 200 }, (_, i) => (Math.imul(i + 1, 2654435761) >>> 0).toString(36)).join(' ')
  const varied = c.ratio([prose])
  assert.ok(varied.ratio > 0.45, 'varied text keeps most of its volume: ' + varied.ratio)
  assert.ok(varied.ratio > measured.ratio * 4, 'the two regimes are an order of magnitude apart')
})

test('the ratio is clamped to 1 even when gzip expands the input', () => {
  // One byte is dominated by the gzip header; minBytes:0 forces measurement
  // and guarantees the expansion branch is actually exercised.
  const c = createCompressor({ minBytes: 0 })
  const measured = c.ratio(['x'])
  assert.ok(measured.gzBytes > measured.bytes, 'the fixture must really expand')
  assert.equal(measured.ratio, 1, 'never a negative discount')
  // The shipped threshold still refuses to measure small text.
  assert.equal(createCompressor().ratio(['x']), null)
  assert.equal(typeof COMPRESS_MIN_BYTES, 'number')
})

test('several pieces measure as one concatenated stream', () => {
  const c = createCompressor()
  const piece = 'the same block repeated over and over '
  const joined = c.ratio([piece.repeat(20)])
  const pieces = c.ratio(Array.from({ length: 20 }, () => piece))
  assert.ok(joined && pieces)
  assert.equal(pieces.bytes, joined.bytes)
  assert.equal(pieces.gzBytes, joined.gzBytes)
})
