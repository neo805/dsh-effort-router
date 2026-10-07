/**
 * dsh-effort-router — post-restart live verification.
 *
 * Scans the newest session logs under the DSH home for request/header efforts.
 * After running a real task with the selector on Auto, the header history
 * should show VARIETY (low on cheap steps, high on engineering steps) instead
 * of a constant value.
 *
 *   node scripts/verify-live.mjs            # newest 5 sessions
 *   node scripts/verify-live.mjs 10         # newest 10
 *
 * The sessions root resolves from DSH_HOME (else ~/.dsh). Header caveat:
 * request/header is written only when the envelope changes, so it is a lower
 * bound of the levels actually used.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// DSH stores session logs as concatenated zstd frames (one per append batch);
// Node's zstd API decodes one frame, so split on the frame magic first.
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function decodeZstdFile(file) {
  const buf = fs.readFileSync(file)
  const offsets = []
  let i = 0
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) { offsets.push(i); i += 4 }
  if (!offsets.length || offsets[0] !== 0) throw new Error('not a zstd frame stream: ' + file)
  offsets.push(buf.length)
  const parts = []
  for (let k = 0; k < offsets.length - 1; k += 1) {
    parts.push(zlib.zstdDecompressSync(buf.subarray(offsets[k], offsets[k + 1])))
  }
  return Buffer.concat(parts)
}

const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 5
const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const root = path.join(home, 'sessions')
const files = []
function walk(dir, depth = 0) {
  if (depth > 4) return
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, depth + 1)
    else if (e.name.endsWith('.jsonl.zstd') || e.name.endsWith('.jsonl')) files.push(p)
  }
}
walk(root)
if (files.length === 0) {
  console.log('no session logs found under ' + root)
  process.exit(0)
}
files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

for (const f of files.slice(0, limit)) {
  let text
  try {
    text = f.endsWith('.zstd') ? decodeZstdFile(f).toString('utf8') : fs.readFileSync(f, 'utf8')
  } catch (error) {
    console.log(path.basename(f), 'ERROR', String(error.message).slice(0, 60))
    continue
  }
  let id = null
  const headers = []
  const selections = []
  let steps = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'session') id = o.id
    else if (o.type === 'request/header') {
      const cfg = o.data?.header?.config ?? {}
      headers.push({ seq: o.seq, effort: cfg.reasoningEffort ?? null, model: cfg.model, reason: o.data?.reason })
    } else if (o.type === 'model/selection') selections.push(o.data?.reasoningEffort ?? null)
    else if (o.type === 'step/start') steps += 1
  }
  const efforts = headers.map((h) => h.effort)
  const distinct = [...new Set(efforts)]
  console.log(`\n${id}  steps=${steps}  (file ${path.basename(f)})`)
  console.log(`  selections: ${JSON.stringify([...new Set(selections)])}`)
  console.log(`  headers   : ${JSON.stringify(efforts)}`)
  console.log(`  verdict   : ${distinct.length > 1 ? 'VARIED (scheduler active)' : distinct.length === 1 ? 'constant ' + distinct[0] : 'no headers yet'}`)
  for (const h of headers) console.log(`    seq=${h.seq} effort=${h.effort} model=${h.model} reason=${h.reason}`)
}
