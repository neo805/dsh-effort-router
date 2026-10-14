/**
 * dsh-effort-router — gzip compression-ratio discount (node side only).
 *
 * The 0.2.8 drift engine measures information VOLUME, not byte volume: a
 * tool result that repeats the same line 6000 times is large but carries
 * almost no information, and absolute token counts cannot tell the two
 * apart (order-0 entropy cannot either — repetition does not skew the
 * symbol distribution; measured on local corpora, loop logs score H0 0.651
 * vs source code 0.620). The gzip ratio measures exactly the dictionary
 * redundancy that "循环重复" is made of.
 *
 * Why a REAL gzip instead of an entropy estimate: zlib is native code.
 * Measured on this project's corpora, level-1 gzip over a 0.6 MB result
 * costs 0.2–1.5 ms — cheaper than the JS token count itself (3.5 ms/MB) —
 * while every pure-JS estimator either misjudged repetition (H0/H1) or
 * saturated on code/prose (TTR16). Level 1 tracks level 6 within ~10%,
 * which is all a ramp needs.
 *
 * Guard rails:
 *   - texts below MIN_BYTES are never discounted (the ~20-byte gzip header
 *     dominates small inputs and makes the ratio noise);
 *   - the ratio is clamped to <= 1 (tiny incompressible inputs can EXPAND
 *     under gzip);
 *   - policy.js stays import-free: this module is wired in from index.js
 *     and injected into the signal collector, so unit tests can substitute
 *     a fake (or no compressor at all — the discount then degrades to
 *     "raw tokens", exactly the pre-0.2.8 behavior).
 */
import { gzipSync } from 'node:zlib'

/** Texts smaller than this are never discounted (header-dominated noise). */
export const COMPRESS_MIN_BYTES = 256

/**
 * Create the compressor.
 * @param opts.level  gzip level (default 1: ratio fidelity is all we need).
 * @returns {{ ratio(pieces: string[]): { bytes: number, gzBytes: number, ratio: number } | null }}
 */
export function createCompressor(opts = {}) {
  const level = Number.isInteger(opts.level) ? opts.level : 1
  const minBytes = Number.isFinite(opts.minBytes) ? opts.minBytes : COMPRESS_MIN_BYTES
  return {
    /**
     * Compression ratio of the given text pieces (zero-copy string refs,
     * concatenated once into the buffer gzip needs). Returns null when the
     * input is too small to measure — callers treat null as ratio 1.
     */
    ratio(pieces) {
      if (!Array.isArray(pieces) || pieces.length === 0) return null
      const buffers = []
      let bytes = 0
      for (const piece of pieces) {
        if (typeof piece !== 'string' || piece === '') continue
        const buf = Buffer.from(piece, 'utf8')
        buffers.push(buf)
        bytes += buf.length
      }
      if (bytes < minBytes) return null
      const gzBytes = gzipSync(Buffer.concat(buffers, bytes), { level }).length
      return { bytes, gzBytes, ratio: Math.min(1, gzBytes / bytes) }
    },
  }
}
